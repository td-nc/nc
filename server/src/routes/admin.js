import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireAdmin, requireQualita, requireInternal } from '../lib/access.js';
import { getSettings, setSettings, SETTING_KEYS } from '../lib/settings.js';
import * as mail from '../lib/mail.js';
import * as lis from '../lib/lis.js';
import { runSlaCheck } from '../lib/nc.js';

const r = Router();

// ---- catalogo tipologie (lettura per tutti gli interni e le sedi; modifica Qualità)
r.get('/tipi', ah(async (req, res) => {
  const tutti = req.query.tutti === '1';
  res.json(await many(`SELECT t.*, (SELECT count(*)::int FROM nc n WHERE n.tipo_id=t.id) AS n_nc FROM nc_tipi t ${tutti ? '' : 'WHERE t.attivo'} ORDER BY t.macro, t.posizione, t.label`));
}));
const tipoSchema = z.object({
  macro: z.enum(['FISICA', 'INFORMATICA', 'DOCUMENTALE']), codice: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/, 'solo maiuscole, numeri e _'), label: z.string().min(2).max(120),
  descrizione: z.string().max(1000).nullable().optional(), gravita_default: z.enum(['MINORE', 'MAGGIORE', 'CRITICA']).default('MINORE'),
  azione_attesa: z.string().max(1000).nullable().optional(), richiede_nuovo_campione: z.boolean().default(false), lis_tipo: z.number().int().nullable().optional(), posizione: z.number().int().default(50), attivo: z.boolean().default(true),
});
r.post('/tipi', requireQualita, ah(async (req, res) => {
  const b = parse(tipoSchema, req.body);
  if (await one('SELECT 1 FROM nc_tipi WHERE macro=$1 AND codice=$2', [b.macro, b.codice])) throw bad('Codice già presente in questa macro-area');
  const t = await one(`INSERT INTO nc_tipi (macro, codice, label, descrizione, gravita_default, azione_attesa, richiede_nuovo_campione, lis_tipo, posizione, attivo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.macro, b.codice, b.label, b.descrizione || null, b.gravita_default, b.azione_attesa || null, b.richiede_nuovo_campione, b.lis_tipo ?? null, b.posizione, b.attivo]);
  await audit(req, 'TIPO_CREATED', { entity: 'nc_tipo', entityId: t.id, label: `${t.macro} · ${t.label}` });
  res.status(201).json(t);
}));
r.put('/tipi/:id', requireQualita, ah(async (req, res) => {
  const b = parse(tipoSchema.partial(), req.body);
  const cur = await one('SELECT * FROM nc_tipi WHERE id=$1', [Number(req.params.id)]);
  if (!cur) throw notFound('Tipologia non trovata');
  const t = await one(`UPDATE nc_tipi SET label=coalesce($2,label), descrizione=coalesce($3,descrizione), gravita_default=coalesce($4,gravita_default), azione_attesa=coalesce($5,azione_attesa), richiede_nuovo_campione=coalesce($6,richiede_nuovo_campione), lis_tipo=coalesce($7,lis_tipo), posizione=coalesce($8,posizione), attivo=coalesce($9,attivo) WHERE id=$1 RETURNING *`,
    [cur.id, b.label ?? null, b.descrizione ?? null, b.gravita_default ?? null, b.azione_attesa ?? null, b.richiede_nuovo_campione ?? null, b.lis_tipo ?? null, b.posizione ?? null, b.attivo ?? null]);
  await audit(req, 'TIPO_UPDATED', { entity: 'nc_tipo', entityId: t.id, label: `${t.macro} · ${t.label}`, data: b });
  res.json(t);
}));

// ---- impostazioni
r.get('/settings', requireInternal, ah(async (_req, res) => {
  res.json({ settings: await getSettings(true), keys: SETTING_KEYS, lis: { enabled: config.lis.enabled, baseUrl: config.lis.baseUrl, writeBack: config.lis.writeBack, pushConfigured: Boolean(config.lis.pushSecret) }, mail: { provider: config.mail.provider, from: config.mail.from, labNotify: config.mail.labNotify }, baseUrl: config.baseUrl });
}));
r.put('/settings', requireQualita, ah(async (req, res) => {
  const b = parse(z.record(z.string(), z.string().max(500)), req.body);
  const s = await setSettings(b);
  await audit(req, 'SETTINGS_UPDATED', { entity: 'settings', label: Object.keys(b).join(', '), data: b });
  res.json(s);
}));

// ---- email
r.get('/email', requireQualita, ah(async (req, res) => {
  res.json(await many(`SELECT e.id, e.nc_id, n.codice, e.tipo, e.destinatari, e.cc, e.oggetto, e.stato, e.errore, e.tentativi, e.sent_at, e.created_at FROM email_log e LEFT JOIN nc n ON n.id=e.nc_id ORDER BY e.created_at DESC LIMIT ${Math.min(Number(req.query.limit) || 200, 1000)}`));
}));
r.get('/email/:id', requireQualita, ah(async (req, res) => {
  const e = await one('SELECT * FROM email_log WHERE id=$1', [Number(req.params.id)]); if (!e) throw notFound(); res.json(e);
}));
r.post('/email/:id/retry', requireQualita, ah(async (req, res) => {
  const e = await one('SELECT * FROM email_log WHERE id=$1', [Number(req.params.id)]); if (!e) throw notFound();
  res.json(await mail.deliver(e));
}));
r.post('/email/test', requireAdmin, ah(async (req, res) => {
  const { to } = parse(z.object({ to: z.string().email() }), req.body);
  const tpl = mail.tplTest(to);
  res.json(await mail.enqueue({ tipo: 'TEST', to: [to], subject: tpl.subject, html: tpl.html }));
}));

// ---- LIS
r.get('/lis/status', requireInternal, ah(async (_req, res) => {
  const out = { enabled: config.lis.enabled, baseUrl: config.lis.baseUrl, writeBack: config.lis.writeBack, push: Boolean(config.lis.pushSecret), ok: null, whoami: null, error: null };
  if (config.lis.enabled) {
    try { out.whoami = await lis.whoami(); out.ok = true; } catch (e) { out.ok = false; out.error = e.message; }
  }
  const last = await many('SELECT * FROM lis_eventi ORDER BY created_at DESC LIMIT 50');
  const stats = await one(`SELECT count(*) FILTER (WHERE canale='HL7')::int AS hl7, count(*) FILTER (WHERE canale='PUSH')::int AS push, count(*) FILTER (WHERE canale='API')::int AS api, count(*) FILTER (WHERE esito='ERRORE' AND created_at > now() - interval '24 hours')::int AS errori_24h FROM lis_eventi`);
  res.json({ ...out, eventi: last, stats });
}));

// ---- registro attività
r.get('/audit', requireQualita, ah(async (req, res) => {
  const { action, nc, user, limit } = req.query;
  const w = [], p = [];
  if (action) { p.push(action); w.push(`a.action = $${p.length}`); }
  if (nc) { p.push(Number(nc)); w.push(`a.nc_id = $${p.length}`); }
  if (user) { p.push(Number(user)); w.push(`a.user_id = $${p.length}`); }
  res.json(await many(`SELECT a.*, u.full_name, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY a.at DESC LIMIT ${Math.min(Number(limit) || 300, 2000)}`, p));
}));

// ---- scheduler manuale (per collaudo)
r.post('/scheduler/run', requireAdmin, ah(async (req, res) => {
  const out = await runSlaCheck();
  await audit(req, 'SCHEDULER_RUN', { entity: 'system', label: JSON.stringify(out) });
  res.json(out);
}));

export default r;
