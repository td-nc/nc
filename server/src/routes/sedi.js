import { Router } from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireQualita, isSede } from '../lib/access.js';

const r = Router();
const TIPI = ['PUNTO_PRELIEVO', 'CENTRO_MEDICO', 'SERVICE', 'LABORATORIO', 'ALTRO'];
const cols = `s.*, coalesce(s.email_nc_override, s.email_nc) AS email_effettiva,
  (SELECT count(*)::int FROM nc n WHERE n.sede_id=s.id AND n.stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO')) AS nc_aperte,
  (SELECT count(*)::int FROM nc n WHERE n.sede_id=s.id AND n.opened_at > now() - interval '90 days' AND n.stato <> 'ANNULLATA') AS nc_90gg,
  (SELECT count(*)::int FROM users_sedi us JOIN users u ON u.id=us.user_id WHERE us.sede_id=s.id AND u.status='ACTIVE') AS n_utenti`;

// Elenco: interno completo; utente SEDE solo le proprie
r.get('/sedi', ah(async (req, res) => {
  if (isSede(req.user)) return res.json(await many(`SELECT ${cols} FROM sedi s WHERE s.id = ANY($1::int[]) ORDER BY s.nome`, [req.user.sedi || []]));
  const attive = req.query.tutte === '1' ? '' : 'WHERE s.attiva';
  res.json(await many(`SELECT ${cols} FROM sedi s ${attive} ORDER BY s.attiva DESC, s.tipo, s.nome`));
}));

const schema = z.object({
  codice: z.string().min(1).max(40), nome: z.string().min(2).max(200), tipo: z.enum(TIPI).default('SERVICE'),
  email_nc_override: z.string().max(400).nullable().optional(), email_cc: z.string().max(400).nullable().optional(),
  telefono: z.string().max(60).nullable().optional(), referente: z.string().max(160).nullable().optional(),
  indirizzo: z.string().max(200).nullable().optional(), citta: z.string().max(120).nullable().optional(),
  sla_ore: z.number().int().min(1).max(240).nullable().optional(), attiva: z.boolean().optional(), note: z.string().max(2000).nullable().optional(),
});

r.post('/sedi', requireQualita, ah(async (req, res) => {
  const b = parse(schema, req.body);
  if (await one('SELECT 1 FROM sedi WHERE lower(codice)=lower($1)', [b.codice])) throw bad('Esiste già una sede con questo codice');
  const s = await one(
    `INSERT INTO sedi (codice, nome, tipo, email_nc_override, email_cc, telefono, referente, indirizzo, citta, sla_ore, attiva, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [b.codice.trim(), b.nome, b.tipo, b.email_nc_override || null, b.email_cc || null, b.telefono || null, b.referente || null, b.indirizzo || null, b.citta || null, b.sla_ore ?? null, b.attiva ?? true, b.note || null]);
  await audit(req, 'SEDE_CREATED', { entity: 'sede', entityId: s.id, label: `${s.nome} (${s.codice})` });
  res.status(201).json(s);
}));

r.put('/sedi/:id', requireQualita, ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(schema.partial(), req.body);
  const cur = await one('SELECT * FROM sedi WHERE id=$1', [id]);
  if (!cur) throw notFound('Sede non trovata');
  if (b.codice && b.codice.toLowerCase() !== cur.codice.toLowerCase() && await one('SELECT 1 FROM sedi WHERE lower(codice)=lower($1)', [b.codice])) throw bad('Codice già in uso');
  const s = await one(
    `UPDATE sedi SET codice=coalesce($2,codice), nome=coalesce($3,nome), tipo=coalesce($4,tipo), email_nc_override=$5, email_cc=$6, telefono=$7, referente=$8, indirizzo=$9, citta=$10, sla_ore=$11, attiva=coalesce($12,attiva), note=$13, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, b.codice?.trim() ?? null, b.nome ?? null, b.tipo ?? null, 'email_nc_override' in b ? (b.email_nc_override || null) : cur.email_nc_override, 'email_cc' in b ? (b.email_cc || null) : cur.email_cc,
      'telefono' in b ? (b.telefono || null) : cur.telefono, 'referente' in b ? (b.referente || null) : cur.referente, 'indirizzo' in b ? (b.indirizzo || null) : cur.indirizzo, 'citta' in b ? (b.citta || null) : cur.citta,
      'sla_ore' in b ? (b.sla_ore ?? null) : cur.sla_ore, b.attiva ?? null, 'note' in b ? (b.note || null) : cur.note]);
  await audit(req, 'SEDE_UPDATED', { entity: 'sede', entityId: id, label: `${s.nome} (${s.codice})`, data: b });
  res.json(s);
}));

export default r;
