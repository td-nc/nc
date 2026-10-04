// Logica di dominio delle non conformità: numerazione, macchina a stati, SLA, ricorrenze, notifiche.
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { HttpError, bad, audit } from './util.js';
import { getSettings, num } from './settings.js';
import { addWorkingHours } from './sla.js';
import * as mail from './mail.js';
import * as lis from './lis.js';
import { publish } from './events.js';

export const STATI = ['APERTA', 'INVIATA_SEDE', 'RISPOSTA_SEDE', 'IN_TRATTAMENTO', 'CHIUSA', 'VERIFICATA', 'ANNULLATA'];
export const STATO_LABEL = { APERTA: 'Aperta', INVIATA_SEDE: 'In attesa della sede', RISPOSTA_SEDE: 'Risposta da gestire', IN_TRATTAMENTO: 'In trattamento', CHIUSA: 'Chiusa', VERIFICATA: 'Verificata', ANNULLATA: 'Annullata' };
export const APERTE = ['APERTA', 'INVIATA_SEDE', 'RISPOSTA_SEDE', 'IN_TRATTAMENTO'];

export const NC_COLS = `n.*, s.nome AS sede_nome, s.codice AS sede_codice, s.tipo AS sede_tipo, t.label AS tipo_label, t.codice AS tipo_codice,
  a.stato_lis, a.data_accettazione, a.paziente_cognome, a.paziente_nome, a.paziente_nascita, a.paziente_sesso, a.esami AS acc_esami, a.origine AS acc_origine, a.id_richiesta_cliente,
  uo.full_name AS opened_by_name, uc.full_name AS closed_by_name,
  (SELECT count(*)::int FROM nc_messaggi m WHERE m.nc_id = n.id) AS n_messaggi,
  (SELECT count(*)::int FROM nc_allegati al WHERE al.nc_id = n.id) AS n_allegati,
  (SELECT count(*)::int FROM nc_azioni az WHERE az.nc_id = n.id AND az.stato NOT IN ('COMPLETATA','ANNULLATA')) AS azioni_aperte`;
export const NC_FROM = `FROM nc n JOIN sedi s ON s.id = n.sede_id LEFT JOIN nc_tipi t ON t.id = n.tipo_id JOIN accettazioni a ON a.id = n.accettazione_id
  LEFT JOIN users uo ON uo.id = n.opened_by LEFT JOIN users uc ON uc.id = n.closed_by`;

export const loadNc = (id) => one(`SELECT ${NC_COLS} ${NC_FROM} WHERE n.id = $1`, [id]);

// I dati del paziente sono visibili al laboratorio e alla sede inviante (autenticata); mai nelle email.
export function viewFor(nc, user) {
  if (!nc) return nc;
  const out = { ...nc };
  if (user?.role === 'SEDE') { delete out.rca_metodo; delete out.rca_causa; delete out.rca_categoria; delete out.verifica_note; }
  return out;
}

export async function nextCodice(client) {
  const runner = client ? client.query.bind(client) : q;
  const year = new Date().getFullYear();
  const r = await runner(`SELECT coalesce(max(substring(codice from 9)::int), 0) + 1 AS n FROM nc WHERE codice LIKE $1`, [`NC-${year}-%`]);
  return `NC-${year}-${String(r.rows[0].n).padStart(4, '0')}`;
}

export async function sedeEmail(sede) {
  return sede.email_nc_override || sede.email_nc || '';
}

export async function slaDue(sede, from = new Date()) {
  const s = await getSettings();
  const hours = sede.sla_ore != null ? sede.sla_ore : num(s.sla_ore_default, 24);
  return addWorkingHours(from, hours, s.orario_lavoro);
}

// Ricorrenza: stessa tipologia sulla stessa sede negli ultimi 90 giorni (NC non annullate), soglia configurabile
export async function checkRicorrenza(sedeId, tipoId, excludeId) {
  if (!tipoId) return { ricorrente: false, n: 0 };
  const s = await getSettings();
  const r = await one(`SELECT count(*)::int AS n FROM nc WHERE sede_id=$1 AND tipo_id=$2 AND stato <> 'ANNULLATA' AND opened_at > now() - interval '90 days' AND id <> coalesce($3, 0)`, [sedeId, tipoId, excludeId || null]);
  return { ricorrente: r.n + 1 >= num(s.ricorrenza_soglia, 3), n: r.n + 1 };
}

export async function addMessaggio(client, ncId, { tipo, direzione, testo, userId, azione_eseguita = null, contatto = {} }) {
  const r = await client.query(
    `INSERT INTO nc_messaggi (nc_id, tipo, direzione, testo, azione_eseguita, contatto_nome, contatto_email, contatto_tel, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [ncId, tipo, direzione, testo, azione_eseguita, contatto.nome || null, contatto.email || null, contatto.tel || null, userId || null]);
  return r.rows[0];
}

const bump = (client, id, userId, extraSet = '', params = []) =>
  client.query(`UPDATE nc SET version = version + 1, updated_at = now(), updated_by = $2 ${extraSet} WHERE id = $1 RETURNING *`, [id, userId || null, ...params]);

export function assertVersion(nc, version) {
  if (version != null && Number(version) !== nc.version) {
    const e = new HttpError(409, 'La non conformità è stata modificata da un altro utente: ricarica la pagina');
    e.current = nc; throw e;
  }
}

export function emit(type, nc, by, label) {
  publish({ type, ncId: nc.id, codice: nc.codice, stato: nc.stato, sedeId: nc.sede_id, by, label, at: new Date().toISOString() });
}

// Invio (o re-invio) della NC alla sede inviante: email + stato INVIATA_SEDE + SLA
export async function inviaAllaSede(req, nc, { messaggio } = {}) {
  const sede = await one('SELECT * FROM sedi WHERE id=$1', [nc.sede_id]);
  const to = await sedeEmail(sede);
  const settings = await getSettings();
  const due = await slaDue(sede);
  const full = await loadNc(nc.id);
  const tpl = messaggio ? mail.tplRichiesta(full, sede, messaggio) : mail.tplApertura(full, sede, full.tipo_label || full.tipo_altro || '–', settings);
  // destinatari: email NC della sede + utenti SEDE della sede che ricevono notifiche
  const users = await many(`SELECT u.email FROM users u JOIN users_sedi us ON us.user_id=u.id WHERE us.sede_id=$1 AND u.status='ACTIVE' AND u.notify_email`, [sede.id]);
  const dest = [to, ...users.map((u) => u.email)].filter(Boolean);
  if (!dest.length) throw bad(`La sede "${sede.nome}" non ha un indirizzo email per le non conformità: impostalo nell'anagrafica sedi prima di inviare.`);
  const email = await mail.enqueue({ ncId: nc.id, tipo: messaggio ? 'NC_RICHIESTA' : 'NC_APERTA', to: dest, cc: sede.email_cc, subject: tpl.subject, html: tpl.html });
  const upd = await one(
    `UPDATE nc SET stato='INVIATA_SEDE', sent_at=coalesce(sent_at, now()), sla_due_at=$2, sla_reminder_at=NULL, sla_escalated_at=NULL, version=version+1, updated_at=now(), updated_by=$3 WHERE id=$1 RETURNING *`,
    [nc.id, due, req.user?.id || null]);
  await audit(req, 'NC_SENT', { entity: 'nc', entityId: nc.id, ncId: nc.id, label: `${nc.codice} inviata a ${sede.nome} (${dest.join(', ')}) · stato email ${email.stato}` });
  emit('nc.updated', upd, req.user?.full_name, `inviata a ${sede.nome}`);
  return { nc: upd, email };
}

// Blocco esami su StudioLAB (se write-back attivo). Non blocca mai il flusso: registra l'esito.
export async function bloccaSuLis(nc, acc) {
  if (!config.lis.enabled || !config.lis.writeBack) return { done: false, esito: 'write-back LIS non attivo' };
  const esami = (nc.esami_coinvolti || []).length ? nc.esami_coinvolti : (acc.esami || []);
  const esiti = [];
  for (const e of esami) {
    const idEsame = e.idEsame || e.cod;
    try { await lis.bloccaEsame(nc.accettazione_id, idEsame); esiti.push(`${e.cod}: bloccato`); }
    catch (err) { esiti.push(`${e.cod}: ${err.message}`); }
  }
  const ok = esiti.length > 0 && esiti.every((x) => x.endsWith('bloccato'));
  await q('UPDATE nc SET blocco_lis=$2, blocco_lis_esito=$3 WHERE id=$1', [nc.id, ok, esiti.join('; ')]);
  await lis.logEvento('API', ok ? 'OK' : 'ERRORE', { accettazioneId: nc.accettazione_id, dettaglio: `blocco esami per ${nc.codice}: ${esiti.join('; ')}` });
  return { done: ok, esito: esiti.join('; ') };
}
export async function sbloccaSuLis(nc, acc) {
  if (!config.lis.enabled || !config.lis.writeBack || !nc.blocco_lis) return { done: false };
  const esami = (nc.esami_coinvolti || []).length ? nc.esami_coinvolti : (acc.esami || []);
  const esiti = [];
  for (const e of esami) {
    try { await lis.sbloccaEsame(nc.accettazione_id, e.idEsame || e.cod, nc.codice); esiti.push(`${e.cod}: sbloccato`); }
    catch (err) { esiti.push(`${e.cod}: ${err.message}`); }
  }
  await q('UPDATE nc SET blocco_lis_esito=$2 WHERE id=$1', [nc.id, esiti.join('; ')]);
  return { done: esiti.every((x) => x.endsWith('sbloccato')), esito: esiti.join('; ') };
}

// ---------- scheduler: solleciti, escalation, coda email ----------
export async function runSlaCheck() {
  const s = await getSettings();
  const now = new Date();
  // sollecito: alla scadenza dello SLA (sla_sollecito_ore ore lavorative dopo, se impostato)
  const candidates = await many(`SELECT * FROM nc WHERE stato='INVIATA_SEDE' AND sla_due_at IS NOT NULL AND sla_reminder_at IS NULL AND sla_due_at <= $1`, [now]);
  const toRemind = candidates.filter((nc) => addWorkingHours(new Date(nc.sla_due_at), num(s.sla_sollecito_ore, 0), s.orario_lavoro) <= now);
  let reminders = 0, escalations = 0;
  for (const nc of toRemind) {
    const full = await loadNc(nc.id); const sede = await one('SELECT * FROM sedi WHERE id=$1', [nc.sede_id]);
    const users = await many(`SELECT u.email FROM users u JOIN users_sedi us ON us.user_id=u.id WHERE us.sede_id=$1 AND u.status='ACTIVE' AND u.notify_email`, [sede.id]);
    const dest = [await sedeEmail(sede), ...users.map((u) => u.email)].filter(Boolean);
    const tpl = mail.tplSollecito(full, sede, full.tipo_label || full.tipo_altro || '–');
    if (dest.length) await mail.enqueue({ ncId: nc.id, tipo: 'NC_SOLLECITO', to: dest, cc: sede.email_cc, subject: tpl.subject, html: tpl.html });
    await q('UPDATE nc SET sla_reminder_at=now() WHERE id=$1', [nc.id]);
    await tx((c) => addMessaggio(c, nc.id, { tipo: 'SISTEMA', direzione: 'INTERNO', testo: `Sollecito automatico inviato alla sede (${dest.join(', ') || 'nessun destinatario'}).` }));
    reminders++;
  }
  const escHours = num(s.sla_escalation_ore, 24);
  const toEscalate = await many(`SELECT * FROM nc WHERE stato='INVIATA_SEDE' AND sla_due_at IS NOT NULL AND sla_escalated_at IS NULL AND sla_reminder_at IS NOT NULL`);
  for (const nc of toEscalate) {
    const escAt = addWorkingHours(new Date(nc.sla_due_at), escHours, s.orario_lavoro);
    if (escAt > now) continue;
    const full = await loadNc(nc.id); const sede = await one('SELECT * FROM sedi WHERE id=$1', [nc.sede_id]);
    const tpl = mail.tplEscalation(full, sede, full.tipo_label || full.tipo_altro || '–');
    const labUsers = await many(`SELECT email FROM users WHERE role IN ('ADMIN','QUALITA','LAB') AND status='ACTIVE' AND notify_email`);
    await mail.enqueue({ ncId: nc.id, tipo: 'NC_ESCALATION', to: [...config.mail.labNotify, ...labUsers.map((u) => u.email)], subject: tpl.subject, html: tpl.html });
    await q('UPDATE nc SET sla_escalated_at=now(), version=version+1, updated_at=now() WHERE id=$1', [nc.id]);
    await tx((c) => addMessaggio(c, nc.id, { tipo: 'SISTEMA', direzione: 'INTERNO', testo: 'Escalation automatica: la sede non ha risposto entro i termini. Contattare telefonicamente la sede o decidere il trattamento.' }));
    emit('nc.updated', { ...nc, stato: 'INVIATA_SEDE' }, 'sistema', `escalation ${nc.codice}`);
    escalations++;
  }
  const retried = await mail.retryQueue();
  return { reminders, escalations, retried };
}
