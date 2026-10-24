import { Router } from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { config } from '../config.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireLab, isSede, canSeeSede } from '../lib/access.js';
import * as lis from '../lib/lis.js';
import { NC_COLS, NC_FROM, viewFor } from '../lib/nc.js';

const r = Router();
const ACC_COLS = `a.*, s.nome AS sede_nome, s.codice AS sede_codice, s.tipo AS sede_tipo, coalesce(s.email_nc_override, s.email_nc) AS sede_email,
  (SELECT count(*)::int FROM nc n WHERE n.accettazione_id=a.id AND n.stato <> 'ANNULLATA') AS n_nc`;

// Elenco accettazioni in cache (ultime ricevute) con filtri
r.get('/accettazioni', ah(async (req, res) => {
  const { sede, q: text, from, to, solo_nc, limit } = req.query;
  const w = [], p = [];
  if (isSede(req.user)) { p.push(req.user.sedi || []); w.push(`a.sede_id = ANY($${p.length}::int[])`); }
  if (sede) { p.push(Number(sede)); w.push(`a.sede_id = $${p.length}`); }
  if (text) { p.push(`%${String(text).trim()}%`); w.push(`(a.id ILIKE $${p.length} OR a.paziente_cognome ILIKE $${p.length} OR a.id_richiesta_cliente ILIKE $${p.length})`); }
  if (from) { p.push(from); w.push(`coalesce(a.data_accettazione, a.created_at) >= $${p.length}::date`); }
  if (to) { p.push(to); w.push(`coalesce(a.data_accettazione, a.created_at) < ($${p.length}::date + 1)`); }
  if (solo_nc === '1') w.push(`EXISTS (SELECT 1 FROM nc n WHERE n.accettazione_id=a.id AND n.stato <> 'ANNULLATA'${isSede(req.user) ? ' AND n.sent_at IS NOT NULL' : ''})`);
  p.push(Math.min(Number(limit) || 100, 500));
  const rows = await many(`SELECT ${ACC_COLS} FROM accettazioni a LEFT JOIN sedi s ON s.id=a.sede_id ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY coalesce(a.data_accettazione, a.created_at) DESC LIMIT $${p.length}`, p);
  res.json(rows);
}));

// Richiamo per numero di accettazione: cache locale + aggiornamento dal LIS se configurato
r.get('/accettazioni/:id', ah(async (req, res) => {
  const id = String(req.params.id).trim();
  let acc = await one(`SELECT ${ACC_COLS} FROM accettazioni a LEFT JOIN sedi s ON s.id=a.sede_id WHERE a.id=$1`, [id]);
  let lisError = null;
  if (config.lis.enabled && (!acc || req.query.refresh === '1' || !acc.fetched_at || Date.now() - new Date(acc.fetched_at).getTime() > 10 * 60 * 1000)) {
    try {
      const row = await lis.refreshFromLis(id);
      if (row) acc = await one(`SELECT ${ACC_COLS} FROM accettazioni a LEFT JOIN sedi s ON s.id=a.sede_id WHERE a.id=$1`, [id]);
    } catch (e) { lisError = e.message; }
  }
  if (!acc) {
    const e = notFound(config.lis.enabled ? `Accettazione ${id} non trovata su StudioLAB né in archivio locale` : `Accettazione ${id} non presente in archivio: il LIS non è collegato, puoi registrarla manualmente`);
    e.code = 'ACC_NOT_FOUND'; e.details = { canCreateManual: true, lisError }; throw e;
  }
  if (!canSeeSede(req.user, acc.sede_id)) throw notFound('Accettazione non trovata');
  const ncs = await many(`SELECT ${NC_COLS} ${NC_FROM} WHERE n.accettazione_id=$1 ${isSede(req.user) ? "AND n.sent_at IS NOT NULL AND n.stato <> 'ANNULLATA'" : ''} ORDER BY n.opened_at DESC`, [id]);
  res.json({ ...acc, lisError, lisStatoLabel: lis.STATO_LIS[acc.stato_lis] || null, nc: ncs.map((n) => viewFor(n, req.user)) });
}));

// Registrazione manuale (LIS non raggiungibile, accettazione non trasmessa, campione senza ordine informatico)
const manualSchema = z.object({
  id: z.string().min(1).max(60).regex(/^[A-Za-z0-9/_.-]+$/, 'numero accettazione non valido'),
  sede_id: z.number().int(),
  data_accettazione: z.string().optional().nullable(),
  id_richiesta_cliente: z.string().max(80).optional().nullable(),
  paziente_cognome: z.string().max(120).optional().nullable(), paziente_nome: z.string().max(120).optional().nullable(),
  paziente_nascita: z.string().optional().nullable(), paziente_sesso: z.enum(['M', 'F', 'X']).optional().nullable(),
  esami: z.array(z.object({ cod: z.string().min(1).max(40), descrizione: z.string().max(200).optional().default('') })).optional().default([]),
});
r.post('/accettazioni', requireLab, ah(async (req, res) => {
  const b = parse(manualSchema, req.body);
  const sede = await one('SELECT * FROM sedi WHERE id=$1', [b.sede_id]);
  if (!sede) throw bad('Sede inviante non valida');
  const existing = await one('SELECT id FROM accettazioni WHERE id=$1', [b.id]);
  const row = await lis.upsertAccettazione({
    id: b.id, sede_id: b.sede_id, data_accettazione: b.data_accettazione || new Date().toISOString(), id_richiesta_cliente: b.id_richiesta_cliente || null,
    paziente_cognome: b.paziente_cognome || null, paziente_nome: b.paziente_nome || null, paziente_nascita: b.paziente_nascita || null, paziente_sesso: b.paziente_sesso || null,
    esami: b.esami.map((e) => ({ cod: e.cod.trim().toUpperCase(), descrizione: e.descrizione || '', stato: null, bloccato: false })),
  }, 'MANUALE');
  await audit(req, existing ? 'ACC_UPDATED' : 'ACC_CREATED', { entity: 'accettazione', entityId: b.id, label: `${b.id} · ${sede.nome} (manuale)` });
  res.status(existing ? 200 : 201).json(row);
}));

// Associa (o corregge) la sede inviante di un'accettazione già in cache
r.patch('/accettazioni/:id/sede', requireLab, ah(async (req, res) => {
  const { sede_id } = parse(z.object({ sede_id: z.number().int() }), req.body);
  const acc = await one('SELECT * FROM accettazioni WHERE id=$1', [req.params.id]);
  if (!acc) throw notFound();
  if (!(await one('SELECT 1 FROM sedi WHERE id=$1', [sede_id]))) throw bad('Sede non valida');
  await one('UPDATE accettazioni SET sede_id=$2, updated_at=now() WHERE id=$1 RETURNING *', [acc.id, sede_id]);
  await audit(req, 'ACC_UPDATED', { entity: 'accettazione', entityId: acc.id, label: `${acc.id} · sede corretta` });
  res.json({ ok: true });
}));

// Eliminazione: solo accettazioni registrate a mano, senza non conformità. Quelle arrivate dal LIS (API, HL7, push) non si eliminano:
// sono la copia di un dato che esiste in StudioLAB e verrebbero comunque ricreate alla prossima notifica.
r.delete('/accettazioni/:id', requireLab, ah(async (req, res) => {
  const acc = await one('SELECT * FROM accettazioni WHERE id=$1', [req.params.id]);
  if (!acc) throw notFound('Accettazione non trovata');
  if (acc.origine !== 'MANUALE') throw bad(`L'accettazione proviene da StudioLAB (${acc.origine}) e non si può eliminare`);
  const n = await one('SELECT count(*)::int AS n FROM nc WHERE accettazione_id=$1', [acc.id]);
  if (n.n > 0) throw bad(`L'accettazione ha ${n.n} non conformità collegate: annullale prima di eliminarla`);
  await one('DELETE FROM accettazioni WHERE id=$1 RETURNING id', [acc.id]);
  await audit(req, 'ACC_DELETED', { entity: 'accettazione', entityId: acc.id, label: `${acc.id} · registrata manualmente, eliminata` });
  res.json({ ok: true });
}));

export default r;
