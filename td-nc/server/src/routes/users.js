import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, parse, forbidden } from '../lib/util.js';
import { requireAdmin, requireQualita, ROLES } from '../lib/access.js';

const r = Router();
const cols = `u.id, u.email, u.full_name, u.role, u.status, u.auth_provider, u.organization, u.telefono, u.entra_tid, u.must_change_password, u.notify_email, u.last_login_at, u.created_at,
  coalesce((SELECT json_agg(json_build_object('id', s.id, 'nome', s.nome, 'codice', s.codice) ORDER BY s.nome) FROM users_sedi us JOIN sedi s ON s.id=us.sede_id WHERE us.user_id=u.id), '[]'::json) AS sedi`;
const tempPwd = () => `Td-${crypto.randomBytes(9).toString('base64url')}1`;

// Qualità e Admin vedono gli utenti; solo Admin modifica i profili interni. La Qualità può creare/gestire gli accessi delle sedi.
r.get('/users', requireQualita, ah(async (req, res) => {
  const sede = req.query.sede ? Number(req.query.sede) : null;
  res.json(await many(`SELECT ${cols} FROM users u ${sede ? 'WHERE EXISTS (SELECT 1 FROM users_sedi x WHERE x.user_id=u.id AND x.sede_id=$1)' : ''} ORDER BY u.status = 'PENDING' DESC, u.role, lower(u.full_name)`, sede ? [sede] : []));
}));

const createSchema = z.object({
  email: z.string().email(), full_name: z.string().min(2).max(160), role: z.enum(ROLES),
  organization: z.string().max(160).optional().default(''), telefono: z.string().max(40).optional().default(''),
  auth_provider: z.enum(['ENTRA', 'LOCAL', 'BOTH']).default('ENTRA'), sedi: z.array(z.number().int()).optional().default([]),
});
r.post('/users', requireQualita, ah(async (req, res) => {
  const b = parse(createSchema, req.body);
  if (req.user.role !== 'ADMIN' && b.role !== 'SEDE') throw forbidden('Solo un amministratore può creare utenti interni');
  if (await one('SELECT 1 FROM users WHERE lower(email)=lower($1)', [b.email])) throw bad('Esiste già un utente con questa email');
  if (b.role === 'SEDE' && !b.sedi.length) throw bad('Un utente di sede deve essere associato ad almeno una sede');
  let tempPassword = null, hash = null;
  if (b.auth_provider !== 'ENTRA') {
    tempPassword = tempPwd(); hash = await bcrypt.hash(tempPassword, 12);   // anche gli amministratori possono avere credenziali locali (utenti fuori dal tenant Microsoft)
  }
  const u = await tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO users (email, full_name, role, status, auth_provider, organization, telefono, password_hash, must_change_password)
       VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8) RETURNING id`,
      [b.email.toLowerCase(), b.full_name, b.role, b.auth_provider, b.organization || null, b.telefono || null, hash, Boolean(hash)]);
    for (const sid of b.sedi) await c.query('INSERT INTO users_sedi (user_id, sede_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ins.rows[0].id, sid]);
    return (await c.query(`SELECT ${cols} FROM users u WHERE u.id=$1`, [ins.rows[0].id])).rows[0];
  });
  await audit(req, 'USER_CREATED', { entity: 'user', entityId: u.id, label: `${u.email} · ${u.role}` });
  res.status(201).json({ ...u, tempPassword });
}));

const updateSchema = z.object({
  full_name: z.string().min(2).max(160).optional(), role: z.enum(ROLES).optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'DISABLED']).optional(), organization: z.string().max(160).nullable().optional(),
  telefono: z.string().max(40).nullable().optional(), notify_email: z.boolean().optional(), sedi: z.array(z.number().int()).optional(),
});
r.put('/users/:id', requireQualita, ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(updateSchema, req.body);
  const cur = await one('SELECT * FROM users WHERE id=$1', [id]);
  if (!cur) throw notFound('Utente non trovato');
  if (req.user.role !== 'ADMIN' && (cur.role !== 'SEDE' || (b.role && b.role !== 'SEDE'))) throw forbidden('Solo un amministratore può modificare utenti interni');
  if (cur.id === req.user.id && ((b.role && b.role !== 'ADMIN') || (b.status && b.status !== 'ACTIVE'))) throw forbidden('Non puoi declassare o disabilitare il tuo stesso account');
  const u = await tx(async (c) => {
    await c.query(
      `UPDATE users SET full_name=coalesce($2,full_name), role=coalesce($3,role), status=coalesce($4,status), organization=coalesce($5,organization), telefono=coalesce($6,telefono), notify_email=coalesce($7,notify_email), updated_at=now() WHERE id=$1`,
      [id, b.full_name ?? null, b.role ?? null, b.status ?? null, b.organization ?? null, b.telefono ?? null, b.notify_email ?? null]);
    if (b.sedi) {
      await c.query('DELETE FROM users_sedi WHERE user_id=$1', [id]);
      for (const sid of b.sedi) await c.query('INSERT INTO users_sedi (user_id, sede_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, sid]);
    }
    return (await c.query(`SELECT ${cols} FROM users u WHERE u.id=$1`, [id])).rows[0];
  });
  if (b.status && b.status !== 'ACTIVE') await q(`DELETE FROM "session" WHERE (sess->>'userId')::int = $1`, [id]);
  await audit(req, 'USER_UPDATED', { entity: 'user', entityId: id, label: `${u.email} · ${u.role} · ${u.status}`, data: b });
  res.json(u);
}));

r.post('/users/:id/reset-password', requireQualita, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one('SELECT * FROM users WHERE id=$1', [id]);
  if (!cur) throw notFound('Utente non trovato');
  if (req.user.role !== 'ADMIN' && cur.role !== 'SEDE') throw forbidden();
  if (cur.auth_provider === 'ENTRA') throw bad("L'utente accede con Microsoft 365: nessuna password da reimpostare");
  const tempPassword = tempPwd();
  await q('UPDATE users SET password_hash=$2, must_change_password=TRUE, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1', [id, await bcrypt.hash(tempPassword, 12)]);
  await audit(req, 'USER_PASSWORD_RESET', { entity: 'user', entityId: id, label: cur.email });
  res.json({ tempPassword });
}));

export default r;
export { requireAdmin };
