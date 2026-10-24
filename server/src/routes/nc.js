import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { ah, bad, notFound, audit, parse, forbidden, HttpError, diff } from '../lib/util.js';
import { requireLab, requireQualita, isSede, isLab, isQualita, canSeeSede } from '../lib/access.js';
import { getSettings } from '../lib/settings.js';
import { NC_COLS, NC_FROM, loadNc, viewFor, nextCodice, slaDue, checkRicorrenza, addMessaggio, assertVersion, emit, inviaAllaSede, bloccaSuLis, sbloccaSuLis, apriSegnalazioneLis, commentaSegnalazioneLis, risolviSegnalazioneLis, APERTE, STATO_LABEL } from '../lib/nc.js';
import * as mail from '../lib/mail.js';
import * as lis from '../lib/lis.js';
import { rapportoPdf, exportXlsx, listForExport } from '../lib/report.js';

const r = Router();
const MAX_FILE = 6 * 1024 * 1024;
const allegatoSchema = z.object({ nome: z.string().min(1).max(200), mime: z.string().min(3).max(100), base64: z.string().min(1) });

async function getVisible(req, id) {
  const nc = await loadNc(Number(id));
  if (!nc || !canSeeSede(req.user, nc.sede_id)) throw notFound('Non conformità non trovata');
  if (isSede(req.user) && (!nc.sent_at || nc.stato === 'ANNULLATA')) throw notFound('Non conformità non trovata');
  return nc;
}
const who = (req) => req.user?.full_name || req.user?.email;

// Filtri comuni per elenco ed export
function buildWhere(req) {
  const { stato, sede, macro, tipo, gravita, from, to, q: text, ricorrenti, scadute, aperte } = req.query;
  const w = [], p = [];
  if (isSede(req.user)) { p.push(req.user.sedi || []); w.push(`n.sede_id = ANY($${p.length}::int[])`); w.push(`n.stato <> 'ANNULLATA'`); w.push('n.sent_at IS NOT NULL'); }   // la sede vede solo le NC che le sono state comunicate
  if (stato) { p.push(String(stato).split(',')); w.push(`n.stato = ANY($${p.length}::text[])`); }
  if (aperte === '1') { p.push(APERTE); w.push(`n.stato = ANY($${p.length}::text[])`); }
  if (sede) { p.push(Number(sede)); w.push(`n.sede_id = $${p.length}`); }
  if (macro) { p.push(macro); w.push(`n.macro = $${p.length}`); }
  if (tipo) { p.push(Number(tipo)); w.push(`n.tipo_id = $${p.length}`); }
  if (gravita) { p.push(gravita); w.push(`n.gravita = $${p.length}`); }
  if (from) { p.push(from); w.push(`n.opened_at >= $${p.length}::date`); }
  if (to) { p.push(to); w.push(`n.opened_at < ($${p.length}::date + 1)`); }
  if (ricorrenti === '1') w.push('n.ricorrente');
  if (scadute === '1') w.push(`n.stato = 'INVIATA_SEDE' AND n.sla_due_at < now()`);
  if (text) { p.push(`%${String(text).trim()}%`); w.push(`(n.codice ILIKE $${p.length} OR n.accettazione_id ILIKE $${p.length} OR n.descrizione ILIKE $${p.length} OR s.nome ILIKE $${p.length})`); }
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

r.get('/nc', ah(async (req, res) => {
  const { where, params } = buildWhere(req);
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = await many(`SELECT ${NC_COLS} ${NC_FROM} ${where} ORDER BY CASE n.stato WHEN 'RISPOSTA_SEDE' THEN 0 WHEN 'APERTA' THEN 1 WHEN 'INVIATA_SEDE' THEN 2 WHEN 'IN_TRATTAMENTO' THEN 3 ELSE 9 END, n.opened_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const total = await one(`SELECT count(*)::int AS n FROM nc n JOIN sedi s ON s.id=n.sede_id ${where}`, params);
  res.json({ rows: rows.map((n) => viewFor(n, req.user)), total: total.n, limit, offset });
}));

// Contatori per il menu (badge)
r.get('/nc/counts', ah(async (req, res) => {
  if (isSede(req.user)) {
    const c = await one(`SELECT count(*) FILTER (WHERE stato='INVIATA_SEDE')::int AS da_rispondere, count(*) FILTER (WHERE stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO'))::int AS aperte,
      count(*) FILTER (WHERE stato='INVIATA_SEDE' AND sla_due_at < now())::int AS scadute FROM nc WHERE sede_id = ANY($1::int[]) AND sent_at IS NOT NULL AND stato <> 'ANNULLATA'`, [req.user.sedi || []]);
    return res.json(c);
  }
  const c = await one(`SELECT count(*) FILTER (WHERE stato='RISPOSTA_SEDE')::int AS da_gestire, count(*) FILTER (WHERE stato='APERTA')::int AS da_inviare,
    count(*) FILTER (WHERE stato='INVIATA_SEDE')::int AS in_attesa, count(*) FILTER (WHERE stato='INVIATA_SEDE' AND sla_due_at < now())::int AS scadute,
    count(*) FILTER (WHERE stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO'))::int AS aperte,
    count(*) FILTER (WHERE stato='CHIUSA' AND (rca_richiesta OR EXISTS (SELECT 1 FROM nc_azioni z WHERE z.nc_id=nc.id)))::int AS da_verificare,
    count(*) FILTER (WHERE ricorrente AND stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO'))::int AS ricorrenti FROM nc`);
  res.json(c);
}));

r.get('/nc/export.xlsx', requireLab, ah(async (req, res) => {
  const { where, params } = buildWhere(req);
  const rows = await listForExport(where, params);
  const buf = await exportXlsx(rows);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="td-nc_${new Date().toISOString().slice(0, 10)}.xlsx"` });
  await audit(req, 'NC_EXPORTED', { entity: 'nc', label: `${rows.length} NC esportate` });
  res.send(Buffer.from(buf));
}));

// ---------- apertura ----------
const createSchema = z.object({
  accettazione_id: z.string().min(1).max(60),
  macro: z.enum(['FISICA', 'INFORMATICA', 'DOCUMENTALE']),
  tipo_id: z.number().int().nullable().optional(),
  tipo_altro: z.string().max(300).nullable().optional(),
  gravita: z.enum(['MINORE', 'MAGGIORE', 'CRITICA']),
  descrizione: z.string().min(5, 'descrivi la non conformità').max(4000),
  azione_attesa: z.string().min(5, 'indica l\'azione attesa dalla sede').max(2000),
  esami_coinvolti: z.array(z.object({ cod: z.string(), descrizione: z.string().optional().default(''), idEsame: z.string().nullable().optional() })).optional().default([]),
  campione_bloccato: z.boolean().optional().default(true),
  blocca_lis: z.boolean().optional().default(false),
  invia: z.boolean().optional().default(true),
  allegati: z.array(allegatoSchema).optional().default([]),
});
r.post('/nc', requireLab, ah(async (req, res) => {
  const b = parse(createSchema, req.body);
  const acc = await one('SELECT * FROM accettazioni WHERE id=$1', [b.accettazione_id]);
  if (!acc) throw bad('Accettazione non in archivio: richiamala dal LIS o registrala manualmente prima di aprire la NC');
  if (!acc.sede_id) throw bad('L\'accettazione non ha una sede inviante associata: assegnala prima di aprire la NC');
  const tipo = b.tipo_id ? await one('SELECT * FROM nc_tipi WHERE id=$1 AND macro=$2', [b.tipo_id, b.macro]) : null;
  if (b.tipo_id && !tipo) throw bad('Tipologia non valida per la macro-area scelta');
  if (!tipo && !(b.tipo_altro || '').trim()) throw bad('Indica la tipologia oppure specifica "Altro"');
  for (const a of b.allegati) if (Buffer.byteLength(a.base64, 'base64') > MAX_FILE) throw bad(`Allegato ${a.nome} troppo grande (max 6 MB)`);
  const sede = await one('SELECT * FROM sedi WHERE id=$1', [acc.sede_id]);
  const ric = await checkRicorrenza(acc.sede_id, b.tipo_id || null);
  const settings = await getSettings();
  // RCA obbligatoria per NC maggiori/critiche e per le ricorrenti (ISO 15189 §7.5 / §8.7)
  const rcaRichiesta = b.gravita !== 'MINORE' || ric.ricorrente;

  const nc = await tx(async (c) => {
    const codice = await nextCodice(c);
    const ins = await c.query(
      `INSERT INTO nc (codice, accettazione_id, sede_id, macro, tipo_id, tipo_altro, gravita, descrizione, azione_attesa, esami_coinvolti, campione_bloccato, rca_richiesta, ricorrente, opened_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
      [codice, acc.id, acc.sede_id, b.macro, b.tipo_id || null, b.tipo_altro || null, b.gravita, b.descrizione.trim(), b.azione_attesa.trim(), JSON.stringify(b.esami_coinvolti), b.campione_bloccato, rcaRichiesta, ric.ricorrente, req.user.id]);
    const row = ins.rows[0];
    const m = await addMessaggio(c, row.id, { tipo: 'APERTURA', direzione: 'LAB_SEDE', testo: `${b.descrizione.trim()}\n\nAzione attesa: ${b.azione_attesa.trim()}`, userId: req.user.id });
    for (const a of b.allegati) {
      const buf = Buffer.from(a.base64, 'base64');
      await c.query('INSERT INTO nc_allegati (nc_id, messaggio_id, nome_file, mime, dimensione, contenuto, caricato_da) VALUES ($1,$2,$3,$4,$5,$6,$7)', [row.id, m.id, a.nome, a.mime, buf.length, buf, req.user.id]);
    }
    if (ric.ricorrente) await addMessaggio(c, row.id, { tipo: 'SISTEMA', direzione: 'INTERNO', testo: `Non conformità ricorrente: ${ric.n}ª della stessa tipologia per questa sede negli ultimi 90 giorni (soglia ${settings.ricorrenza_soglia}). Analisi della causa radice obbligatoria.` });
    await audit(req, 'NC_CREATED', { entity: 'nc', entityId: row.id, ncId: row.id, label: `${codice} · ${sede.nome} · ${b.macro}${tipo ? ` / ${tipo.label}` : ''} · ${b.gravita}` }, c);
    return row;
  });

  let blocco = null;
  if (b.blocca_lis) blocco = await bloccaSuLis(nc, acc);
  const segnalazione = await apriSegnalazioneLis(await loadNc(nc.id), who(req));
  let invio = null, invioErrore = null;
  if (b.invia) {
    try { invio = await inviaAllaSede(req, nc); }
    catch (e) { invioErrore = e.message; }
  }
  const full = await loadNc(nc.id);
  emit('nc.created', full, who(req), `${full.codice} · ${full.sede_nome}`);
  res.status(201).json({ ...viewFor(full, req.user), ricorrenza: ric, blocco, segnalazione, email: invio?.email || null, invioErrore });
}));

// ---------- dettaglio ----------
r.get('/nc/:id', ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const internal = !isSede(req.user);
  const messaggi = await many(`SELECT m.*, u.full_name AS user_name, u.role AS user_role,
      coalesce((SELECT json_agg(json_build_object('id', al.id, 'nome_file', al.nome_file, 'mime', al.mime, 'dimensione', al.dimensione)) FROM nc_allegati al WHERE al.messaggio_id=m.id), '[]'::json) AS allegati
    FROM nc_messaggi m LEFT JOIN users u ON u.id=m.user_id WHERE m.nc_id=$1 ${internal ? '' : "AND m.direzione <> 'INTERNO'"} ORDER BY m.created_at`, [nc.id]);
  const allegati = await many(`SELECT al.id, al.nome_file, al.mime, al.dimensione, al.created_at, al.messaggio_id, al.lis_allegato_id, u.full_name AS caricato_da_nome FROM nc_allegati al LEFT JOIN users u ON u.id=al.caricato_da WHERE al.nc_id=$1 ORDER BY al.created_at`, [nc.id]);
  const azioni = internal ? await many('SELECT a.*, u.full_name AS created_by_name FROM nc_azioni a LEFT JOIN users u ON u.id=a.created_by WHERE a.nc_id=$1 ORDER BY a.created_at', [nc.id]) : [];
  const email = internal ? await many('SELECT id, tipo, destinatari, cc, oggetto, stato, errore, tentativi, sent_at, created_at FROM email_log WHERE nc_id=$1 ORDER BY created_at DESC', [nc.id]) : [];
  const storico = internal ? await many('SELECT a.id, a.action, a.label, a.at, u.full_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.nc_id=$1 ORDER BY a.at DESC LIMIT 100', [nc.id]) : [];
  const sede = await one('SELECT id, codice, nome, tipo, telefono, referente, coalesce(email_nc_override, email_nc) AS email, email_cc, sla_ore FROM sedi WHERE id=$1', [nc.sede_id]);
  res.json({ nc: viewFor(nc, req.user), messaggi, allegati, azioni, email, storico, sede, lisStatoLabel: lis.STATO_LIS[nc.stato_lis] || null });
}));

// ---------- modifica dati di rilevazione (NC non chiusa) ----------
const patchSchema = z.object({
  version: z.number().int().optional(), tipo_id: z.number().int().nullable().optional(), tipo_altro: z.string().max(300).nullable().optional(),
  gravita: z.enum(['MINORE', 'MAGGIORE', 'CRITICA']).optional(), descrizione: z.string().min(5).max(4000).optional(), azione_attesa: z.string().min(5).max(2000).optional(),
  esami_coinvolti: z.array(z.object({ cod: z.string(), descrizione: z.string().optional().default(''), idEsame: z.string().nullable().optional() })).optional(),
  campione_bloccato: z.boolean().optional(), rca_richiesta: z.boolean().optional(),
});
r.patch('/nc/:id', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const b = parse(patchSchema, req.body);
  assertVersion(nc, b.version);
  if (!APERTE.includes(nc.stato)) throw bad('La non conformità è chiusa: riaprila per modificarla');
  if (b.tipo_id) { const t = await one('SELECT 1 FROM nc_tipi WHERE id=$1 AND macro=$2', [b.tipo_id, nc.macro]); if (!t) throw bad('Tipologia non valida'); }
  const upd = await one(
    `UPDATE nc SET tipo_id=coalesce($2,tipo_id), tipo_altro=coalesce($3,tipo_altro), gravita=coalesce($4,gravita), descrizione=coalesce($5,descrizione), azione_attesa=coalesce($6,azione_attesa),
       esami_coinvolti=coalesce($7,esami_coinvolti), campione_bloccato=coalesce($8,campione_bloccato), rca_richiesta=coalesce($9, rca_richiesta), version=version+1, updated_at=now(), updated_by=$10 WHERE id=$1 RETURNING *`,
    [nc.id, b.tipo_id ?? null, b.tipo_altro ?? null, b.gravita ?? null, b.descrizione?.trim() ?? null, b.azione_attesa?.trim() ?? null, b.esami_coinvolti ? JSON.stringify(b.esami_coinvolti) : null, b.campione_bloccato ?? null, b.rca_richiesta ?? null, req.user.id]);
  const changes = diff(nc, upd, ['tipo_id', 'tipo_altro', 'gravita', 'descrizione', 'azione_attesa', 'campione_bloccato', 'rca_richiesta']);
  await audit(req, 'NC_UPDATED', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · dati di rilevazione aggiornati`, data: changes });
  const full = await loadNc(nc.id);
  emit('nc.updated', full, who(req), 'aggiornata');
  res.json(viewFor(full, req.user));
}));

// ---------- invio / re-invio alla sede ----------
r.post('/nc/:id/invia', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  if (!APERTE.includes(nc.stato)) throw bad('La non conformità è chiusa');
  const { nc: upd, email } = await inviaAllaSede(req, nc);
  await tx((c) => addMessaggio(c, nc.id, { tipo: 'SISTEMA', direzione: 'INTERNO', testo: `Comunicazione inviata alla sede (${email.destinatari}) · stato email: ${email.stato}${email.errore ? ` · ${email.errore}` : ''}.` }));
  res.json({ nc: viewFor(await loadNc(upd.id), req.user), email });
}));

// ---------- thread ----------
const msgSchema = z.object({
  tipo: z.enum(['RICHIESTA', 'RISPOSTA', 'CHIARIMENTO', 'NOTA_INTERNA']),
  testo: z.string().min(2, 'scrivi un messaggio').max(6000),
  azione_eseguita: z.boolean().optional(),
  contatto_nome: z.string().max(160).optional(), contatto_email: z.string().email().optional().or(z.literal('')), contatto_tel: z.string().max(40).optional(),
  allegati: z.array(allegatoSchema).optional().default([]),
  version: z.number().int().optional(),
});
r.post('/nc/:id/messaggi', ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const b = parse(msgSchema, req.body);
  if (!APERTE.includes(nc.stato) && !(isLab(req.user) && b.tipo === 'NOTA_INTERNA')) throw bad(`La non conformità è ${STATO_LABEL[nc.stato].toLowerCase()}: non accetta nuove comunicazioni`);
  for (const a of b.allegati) if (Buffer.byteLength(a.base64, 'base64') > MAX_FILE) throw bad(`Allegato ${a.nome} troppo grande (max 6 MB)`);
  const sede = await one('SELECT * FROM sedi WHERE id=$1', [nc.sede_id]);

  if (isSede(req.user)) {
    if (b.tipo !== 'RISPOSTA' && b.tipo !== 'CHIARIMENTO') throw forbidden('La sede può inviare risposte o richieste di chiarimento');
    if (!(b.contatto_nome || '').trim() || !(b.contatto_email || '').trim() || !(b.contatto_tel || '').trim()) throw bad('Nome e cognome, email e telefono di chi gestisce la non conformità sono obbligatori');
    const msg = await tx(async (c) => {
      const m = await addMessaggio(c, nc.id, { tipo: b.tipo, direzione: 'SEDE_LAB', testo: b.testo.trim(), userId: req.user.id, azione_eseguita: b.azione_eseguita ?? false,
        contatto: { nome: b.contatto_nome.trim(), email: b.contatto_email.trim().toLowerCase(), tel: b.contatto_tel.trim() } });
      for (const a of b.allegati) { const buf = Buffer.from(a.base64, 'base64'); await c.query('INSERT INTO nc_allegati (nc_id, messaggio_id, nome_file, mime, dimensione, contenuto, caricato_da) VALUES ($1,$2,$3,$4,$5,$6,$7)', [nc.id, m.id, a.nome, a.mime, buf.length, buf, req.user.id]); }
      await c.query(`UPDATE nc SET stato='RISPOSTA_SEDE', first_response_at=coalesce(first_response_at, now()), version=version+1, updated_at=now(), updated_by=$2 WHERE id=$1`, [nc.id, req.user.id]);
      await audit(req, 'NC_SEDE_REPLIED', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · risposta di ${sede.nome}${b.azione_eseguita ? ' · azione eseguita' : ''}` }, c);
      return m;
    });
    const full = await loadNc(nc.id);
    const tpl = mail.tplRispostaAlLab(full, sede, msg);
    const labUsers = await many(`SELECT email FROM users WHERE role IN ('ADMIN','QUALITA','LAB') AND status='ACTIVE' AND notify_email`);
    const opener = nc.opened_by ? await one('SELECT email FROM users WHERE id=$1', [nc.opened_by]) : null;
    await mail.enqueue({ ncId: nc.id, tipo: 'NC_RISPOSTA', to: [...config.mail.labNotify, ...labUsers.map((u) => u.email), opener?.email].filter(Boolean), subject: tpl.subject, html: tpl.html });
    emit('nc.replied', full, who(req), `${full.codice} · risposta di ${sede.nome}`);
    await commentaSegnalazioneLis(nc, `Risposta della sede ${sede.nome} (${b.contatto_nome.trim()}): ${b.testo.trim()}${b.azione_eseguita ? ' · azione eseguita' : ''}`, b.contatto_nome.trim());
    return res.status(201).json({ messaggio: msg, nc: viewFor(full, req.user) });
  }

  // laboratorio
  if (!isLab(req.user)) throw forbidden();
  if (b.tipo === 'RISPOSTA') throw bad('Il laboratorio invia richieste o chiarimenti, non risposte');
  const interno = b.tipo === 'NOTA_INTERNA';
  const msg = await tx(async (c) => {
    const m = await addMessaggio(c, nc.id, { tipo: b.tipo, direzione: interno ? 'INTERNO' : 'LAB_SEDE', testo: b.testo.trim(), userId: req.user.id });
    for (const a of b.allegati) { const buf = Buffer.from(a.base64, 'base64'); await c.query('INSERT INTO nc_allegati (nc_id, messaggio_id, nome_file, mime, dimensione, contenuto, caricato_da) VALUES ($1,$2,$3,$4,$5,$6,$7)', [nc.id, m.id, a.nome, a.mime, buf.length, buf, req.user.id]); }
    await audit(req, interno ? 'NC_NOTE' : 'NC_MESSAGE', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · ${interno ? 'nota interna' : 'comunicazione alla sede'}` }, c);
    return m;
  });
  let email = null;
  if (!interno) ({ email } = await inviaAllaSede(req, nc, { messaggio: b.testo.trim() }));
  const full = await loadNc(nc.id);
  if (!interno) { emit('nc.updated', full, who(req), `${full.codice} · nuova richiesta alla sede`); await commentaSegnalazioneLis(nc, `Richiesta alla sede: ${b.testo.trim()}`, who(req)); }
  res.status(201).json({ messaggio: msg, nc: viewFor(full, req.user), email });
}));

// ---------- fase 2: trattamento ----------
const trattSchema = z.object({ trattamento_tipo: z.enum(['CONSERVAZIONE', 'NUOVO_CAMPIONE', 'INTEGRAZIONE_DOCUMENTALE', 'ACCETTAZIONE_LIS', 'DEROGA', 'ANNULLAMENTO_ESAMI', 'ALTRO']), trattamento_note: z.string().max(3000).optional().default(''), conservazione: z.string().max(300).optional().default(''), version: z.number().int().optional() });
r.post('/nc/:id/trattamento', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const b = parse(trattSchema, req.body);
  assertVersion(nc, b.version);
  if (!APERTE.includes(nc.stato)) throw bad('La non conformità è chiusa');
  const nuovoStato = nc.stato === 'INVIATA_SEDE' ? 'INVIATA_SEDE' : 'IN_TRATTAMENTO';
  await tx(async (c) => {
    await c.query(`UPDATE nc SET trattamento_tipo=$2, trattamento_note=$3, conservazione=$4, stato=$5, version=version+1, updated_at=now(), updated_by=$6 WHERE id=$1`, [nc.id, b.trattamento_tipo, b.trattamento_note.trim() || null, b.conservazione.trim() || null, nuovoStato, req.user.id]);
    await addMessaggio(c, nc.id, { tipo: 'TRATTAMENTO', direzione: 'INTERNO', testo: `Trattamento: ${b.trattamento_tipo}${b.conservazione ? ` · conservazione: ${b.conservazione}` : ''}${b.trattamento_note ? `\n${b.trattamento_note}` : ''}`, userId: req.user.id });
    await audit(req, 'NC_TREATMENT', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · trattamento ${b.trattamento_tipo}` }, c);
  });
  const full = await loadNc(nc.id); emit('nc.updated', full, who(req), 'trattamento');
  res.json(viewFor(full, req.user));
}));

// ---------- fase 3: causa radice ----------
const rcaSchema = z.object({ rca_metodo: z.string().max(80).optional().default(''), rca_categoria: z.enum(['PRELIEVO', 'IDENTIFICAZIONE', 'TRASPORTO', 'CONSERVAZIONE', 'LIS', 'DOCUMENTAZIONE', 'FORMAZIONE', 'MATERIALI', 'ORGANIZZAZIONE', 'ALTRO']), rca_causa: z.string().min(10, 'descrivi la causa radice').max(4000), version: z.number().int().optional() });
r.post('/nc/:id/rca', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const b = parse(rcaSchema, req.body);
  assertVersion(nc, b.version);
  if (nc.stato === 'ANNULLATA' || nc.stato === 'VERIFICATA') throw bad('Non modificabile in questo stato');
  await tx(async (c) => {
    await c.query(`UPDATE nc SET rca_richiesta=TRUE, rca_metodo=$2, rca_categoria=$3, rca_causa=$4, rca_by=$5, rca_at=now(), version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1`, [nc.id, b.rca_metodo.trim() || null, b.rca_categoria, b.rca_causa.trim(), req.user.id]);
    await audit(req, 'NC_RCA', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · causa radice: ${b.rca_categoria}` }, c);
  });
  const full = await loadNc(nc.id); emit('nc.updated', full, who(req), 'analisi causa radice');
  res.json(viewFor(full, req.user));
}));

// ---------- fase 4: azioni CAPA ----------
const azioneSchema = z.object({ tipo: z.enum(['CORRETTIVA', 'PREVENTIVA']), descrizione: z.string().min(5).max(2000), responsabile: z.string().max(160).optional().default(''), scadenza: z.string().nullable().optional(), stato: z.enum(['PIANIFICATA', 'IN_CORSO', 'COMPLETATA', 'ANNULLATA']).optional(), note: z.string().max(2000).optional().default('') });
r.post('/nc/:id/azioni', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const b = parse(azioneSchema, req.body);
  if (nc.stato === 'ANNULLATA') throw bad('NC annullata');
  const a = await one(`INSERT INTO nc_azioni (nc_id, tipo, descrizione, responsabile, scadenza, stato, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [nc.id, b.tipo, b.descrizione.trim(), b.responsabile.trim() || null, b.scadenza || null, b.stato || 'PIANIFICATA', b.note.trim() || null, req.user.id]);
  await q('UPDATE nc SET version=version+1, updated_at=now(), updated_by=$2 WHERE id=$1', [nc.id, req.user.id]);
  await audit(req, 'NC_ACTION_CREATED', { entity: 'nc_azione', entityId: a.id, ncId: nc.id, label: `${nc.codice} · azione ${b.tipo.toLowerCase()}: ${b.descrizione.slice(0, 80)}` });
  res.status(201).json(a);
}));
r.put('/nc/:id/azioni/:aid', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const b = parse(azioneSchema.partial(), req.body);
  const cur = await one('SELECT * FROM nc_azioni WHERE id=$1 AND nc_id=$2', [Number(req.params.aid), nc.id]);
  if (!cur) throw notFound('Azione non trovata');
  const a = await one(`UPDATE nc_azioni SET tipo=coalesce($2,tipo), descrizione=coalesce($3,descrizione), responsabile=coalesce($4,responsabile), scadenza=coalesce($5,scadenza), stato=coalesce($6,stato), note=coalesce($7,note),
      completata_at = CASE WHEN coalesce($6,stato)='COMPLETATA' THEN coalesce(completata_at, now()) ELSE NULL END, updated_at=now() WHERE id=$1 RETURNING *`,
    [cur.id, b.tipo ?? null, b.descrizione?.trim() ?? null, b.responsabile ?? null, b.scadenza ?? null, b.stato ?? null, b.note ?? null]);
  await q('UPDATE nc SET version=version+1, updated_at=now(), updated_by=$2 WHERE id=$1', [nc.id, req.user.id]);
  await audit(req, 'NC_ACTION_UPDATED', { entity: 'nc_azione', entityId: a.id, ncId: nc.id, label: `${nc.codice} · azione ${a.stato.toLowerCase()}`, data: diff(cur, a, ['stato', 'descrizione', 'responsabile', 'scadenza']) });
  res.json(a);
}));
r.delete('/nc/:id/azioni/:aid', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const cur = await one('DELETE FROM nc_azioni WHERE id=$1 AND nc_id=$2 RETURNING *', [Number(req.params.aid), nc.id]);
  if (!cur) throw notFound('Azione non trovata');
  await audit(req, 'NC_ACTION_DELETED', { entity: 'nc_azione', entityId: cur.id, ncId: nc.id, label: `${nc.codice} · azione eliminata` });
  res.json({ ok: true });
}));

// ---------- fase 5: chiusura, verifica, riapertura, annullamento ----------
const closeSchema = z.object({ esito: z.string().min(5, 'descrivi l\'esito').max(3000), notifica_sede: z.boolean().optional().default(true), sblocca_lis: z.boolean().optional().default(true), allega_rapporto_lis: z.boolean().optional().default(false), version: z.number().int().optional() });
r.post('/nc/:id/chiudi', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const b = parse(closeSchema, req.body);
  assertVersion(nc, b.version);
  if (!APERTE.includes(nc.stato)) throw bad('La non conformità non è aperta');
  if (nc.rca_richiesta && !nc.rca_causa) throw bad('Questa NC richiede l\'analisi della causa radice prima della chiusura (gravità maggiore/critica o ricorrente)');
  if (!nc.trattamento_tipo) throw bad('Registra il trattamento del campione (fase 2) prima di chiudere');
  const acc = await one('SELECT * FROM accettazioni WHERE id=$1', [nc.accettazione_id]);
  const sede = await one('SELECT * FROM sedi WHERE id=$1', [nc.sede_id]);
  await tx(async (c) => {
    await c.query(`UPDATE nc SET stato='CHIUSA', esito_chiusura=$2, closed_by=$3, closed_at=now(), version=version+1, updated_at=now(), updated_by=$3 WHERE id=$1`, [nc.id, b.esito.trim(), req.user.id]);
    await addMessaggio(c, nc.id, { tipo: 'CHIUSURA', direzione: b.notifica_sede ? 'LAB_SEDE' : 'INTERNO', testo: b.esito.trim(), userId: req.user.id });
    await audit(req, 'NC_CLOSED', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · chiusa` }, c);
  });
  const esiti = {};
  if (b.sblocca_lis) esiti.sblocco = await sbloccaSuLis(nc, acc);
  esiti.segnalazione = await risolviSegnalazioneLis(nc, b.esito.trim(), who(req));
  const full = await loadNc(nc.id);
  if (b.notifica_sede) {
    const tpl = mail.tplChiusura(full, sede, b.esito.trim());
    const users = await many(`SELECT u.email FROM users u JOIN users_sedi us ON us.user_id=u.id WHERE us.sede_id=$1 AND u.status='ACTIVE' AND u.notify_email`, [sede.id]);
    const dest = [sede.email_nc_override || sede.email_nc, ...users.map((u) => u.email)].filter(Boolean);
    if (dest.length) esiti.email = await mail.enqueue({ ncId: nc.id, tipo: 'NC_CHIUSA', to: dest, cc: sede.email_cc, subject: tpl.subject, html: tpl.html });
  }
  if (b.allega_rapporto_lis && config.lis.enabled && config.lis.writeBack) {
    try {
      const pdf = await buildRapporto(full, { includiNoteInterne: false });
      const rr = await lis.caricaAllegato(nc.accettazione_id, { nomeFile: `${nc.codice}.pdf`, tipologia: 'Non conformità', base64: pdf.toString('base64') });
      esiti.allegatoLis = 'caricato'; await lis.logEvento('API', 'OK', { accettazioneId: nc.accettazione_id, dettaglio: `rapporto ${nc.codice} allegato`, payload: JSON.stringify(rr).slice(0, 500) });
    } catch (e) { esiti.allegatoLis = e.message; await lis.logEvento('API', 'ERRORE', { accettazioneId: nc.accettazione_id, dettaglio: `allegato ${nc.codice}: ${e.message}` }); }
  }
  emit('nc.closed', full, who(req), `${full.codice} chiusa`);
  res.json({ nc: viewFor(full, req.user), ...esiti });
}));

const verifySchema = z.object({ verifica_esito: z.enum(['EFFICACE', 'NON_EFFICACE', 'NON_APPLICABILE']), verifica_note: z.string().max(3000).optional().default(''), version: z.number().int().optional() });
r.post('/nc/:id/verifica', requireQualita, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const b = parse(verifySchema, req.body);
  assertVersion(nc, b.version);
  if (nc.stato !== 'CHIUSA') throw bad('La verifica di efficacia si registra su una NC chiusa');
  const open = await one(`SELECT count(*)::int AS n FROM nc_azioni WHERE nc_id=$1 AND stato NOT IN ('COMPLETATA','ANNULLATA')`, [nc.id]);
  if (open.n && b.verifica_esito === 'EFFICACE') throw bad(`${open.n} azioni CAPA ancora aperte: completale prima di dichiarare l'efficacia`);
  if (b.verifica_esito === 'NON_EFFICACE' && !b.verifica_note.trim()) throw bad('Indica perché le azioni non sono risultate efficaci e cosa si fa ora');
  await tx(async (c) => {
    await c.query(`UPDATE nc SET stato=CASE WHEN $2='NON_EFFICACE' THEN 'IN_TRATTAMENTO' ELSE 'VERIFICATA' END, verifica_esito=$2, verifica_note=$3, verifica_by=$4, verifica_at=now(), closed_at=CASE WHEN $2='NON_EFFICACE' THEN NULL ELSE closed_at END, version=version+1, updated_at=now(), updated_by=$4 WHERE id=$1`, [nc.id, b.verifica_esito, b.verifica_note.trim() || null, req.user.id]);
    await addMessaggio(c, nc.id, { tipo: b.verifica_esito === 'NON_EFFICACE' ? 'RIAPERTURA' : 'SISTEMA', direzione: 'INTERNO', testo: `Verifica di efficacia: ${b.verifica_esito.replace('_', ' ').toLowerCase()}${b.verifica_note ? ` · ${b.verifica_note.trim()}` : ''}${b.verifica_esito === 'NON_EFFICACE' ? ' · NC riaperta per nuove azioni' : ''}`, userId: req.user.id });
    await audit(req, 'NC_VERIFIED', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · verifica ${b.verifica_esito}` }, c);
  });
  const full = await loadNc(nc.id); emit('nc.updated', full, who(req), 'verifica efficacia');
  res.json(viewFor(full, req.user));
}));

r.post('/nc/:id/riapri', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const { motivo, version } = parse(z.object({ motivo: z.string().min(5).max(2000), version: z.number().int().optional() }), req.body);
  assertVersion(nc, version);
  if (!['CHIUSA', 'VERIFICATA'].includes(nc.stato)) throw bad('Solo una NC chiusa può essere riaperta');
  await tx(async (c) => {
    await c.query(`UPDATE nc SET stato='IN_TRATTAMENTO', closed_at=NULL, closed_by=NULL, verifica_esito=NULL, verifica_at=NULL, version=version+1, updated_at=now(), updated_by=$2 WHERE id=$1`, [nc.id, req.user.id]);
    await addMessaggio(c, nc.id, { tipo: 'RIAPERTURA', direzione: 'INTERNO', testo: motivo.trim(), userId: req.user.id });
    await audit(req, 'NC_REOPENED', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · riaperta: ${motivo.slice(0, 80)}` }, c);
  });
  const full = await loadNc(nc.id); emit('nc.updated', full, who(req), 'riaperta');
  res.json(viewFor(full, req.user));
}));

r.post('/nc/:id/annulla', requireQualita, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const { motivo } = parse(z.object({ motivo: z.string().min(5).max(2000) }), req.body);
  if (!APERTE.includes(nc.stato)) throw bad('Solo una NC aperta può essere annullata');
  await tx(async (c) => {
    await c.query(`UPDATE nc SET stato='ANNULLATA', version=version+1, updated_at=now(), updated_by=$2 WHERE id=$1`, [nc.id, req.user.id]);
    await addMessaggio(c, nc.id, { tipo: 'SISTEMA', direzione: 'INTERNO', testo: `Annullata: ${motivo.trim()}`, userId: req.user.id });
    await audit(req, 'NC_CANCELLED', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} · annullata: ${motivo.slice(0, 80)}` }, c);
  });
  const full = await loadNc(nc.id); emit('nc.updated', full, who(req), 'annullata');
  res.json(viewFor(full, req.user));
}));

// Eliminazione definitiva: solo per il laboratorio, solo se la sede non ha ancora risposto (nessun messaggio SEDE_LAB) e la NC
// non è stata trattata/chiusa. Serve per gli inserimenti errati; per tutto il resto resta l'annullamento, che conserva lo storico.
r.delete('/nc/:id', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const risposte = await one(`SELECT count(*)::int AS n FROM nc_messaggi WHERE nc_id=$1 AND direzione='SEDE_LAB'`, [nc.id]);
  if (risposte.n > 0) throw bad(`La sede ha già risposto (${risposte.n} messaggi): la NC non si elimina, al massimo si annulla`);
  if (!['APERTA', 'INVIATA_SEDE', 'ANNULLATA'].includes(nc.stato)) throw bad(`La NC è ${STATO_LABEL[nc.stato].toLowerCase()}: non si elimina, si annulla`);
  const acc = await one('SELECT * FROM accettazioni WHERE id=$1', [nc.accettazione_id]);
  const esiti = {};
  if (nc.blocco_lis) esiti.sblocco = await sbloccaSuLis(nc, acc);
  if (nc.lis_segnalazione_id) esiti.segnalazione = await risolviSegnalazioneLis(nc, 'NC eliminata in td-nc (inserimento errato)', who(req));
  await tx(async (c) => {
    await c.query('UPDATE email_log SET nc_id=NULL WHERE nc_id=$1', [nc.id]);
    await c.query('DELETE FROM nc WHERE id=$1', [nc.id]);
    await audit(req, 'NC_DELETED', { entity: 'nc', entityId: nc.id, label: `${nc.codice} · ${nc.sede_nome} · eliminata (${nc.stato.toLowerCase()}, nessuna risposta della sede)` }, c);
  });
  emit('nc.deleted', { id: nc.id, codice: nc.codice, sede_id: nc.sede_id }, who(req), 'eliminata');
  res.json({ ok: true, ...esiti });
}));

// ---------- allegati ----------
r.post('/nc/:id/allegati', ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const a = parse(allegatoSchema, req.body);
  const buf = Buffer.from(a.base64, 'base64');
  if (buf.length > MAX_FILE) throw bad('Allegato troppo grande (max 6 MB)');
  const row = await one('INSERT INTO nc_allegati (nc_id, nome_file, mime, dimensione, contenuto, caricato_da) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome_file, mime, dimensione, created_at', [nc.id, a.nome, a.mime, buf.length, buf, req.user.id]);
  await audit(req, 'NC_ATTACHMENT', { entity: 'nc_allegato', entityId: row.id, ncId: nc.id, label: `${nc.codice} · ${a.nome}` });
  res.status(201).json(row);
}));
r.get('/nc/:id/allegati/:aid', ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const a = await one('SELECT * FROM nc_allegati WHERE id=$1 AND nc_id=$2', [Number(req.params.aid), nc.id]);
  if (!a) throw notFound('Allegato non trovato');
  res.set({ 'Content-Type': a.mime, 'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.nome_file)}"`, 'Cache-Control': 'private, max-age=600' });
  res.send(a.contenuto);
}));
r.delete('/nc/:id/allegati/:aid', requireLab, ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const a = await one('DELETE FROM nc_allegati WHERE id=$1 AND nc_id=$2 RETURNING nome_file', [Number(req.params.aid), nc.id]);
  if (!a) throw notFound('Allegato non trovato');
  await audit(req, 'NC_ATTACHMENT_DELETED', { entity: 'nc_allegato', entityId: req.params.aid, ncId: nc.id, label: `${nc.codice} · ${a.nome_file}` });
  res.json({ ok: true });
}));

// ---------- rapporto PDF ----------
async function buildRapporto(nc, { includiNoteInterne }) {
  const messaggi = await many('SELECT m.*, u.full_name AS user_name FROM nc_messaggi m LEFT JOIN users u ON u.id=m.user_id WHERE m.nc_id=$1 ORDER BY m.created_at', [nc.id]);
  const azioni = await many('SELECT * FROM nc_azioni WHERE nc_id=$1 ORDER BY created_at', [nc.id]);
  return rapportoPdf(nc, { messaggi, azioni, settings: await getSettings(), includiNoteInterne });
}
r.get('/nc/:id/rapporto.pdf', ah(async (req, res) => {
  const nc = await getVisible(req, req.params.id);
  const pdf = await buildRapporto(nc, { includiNoteInterne: !isSede(req.user) });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nc.codice}.pdf"` });
  res.send(pdf);
}));

export default r;
