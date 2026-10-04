// Canali in ingresso da StudioLAB, senza sessione utente: protetti da segreto condiviso (LIS_PUSH_SECRET).
//  POST /api/lis/push   NotificaPush JSON {IdAccettazione, TipoNotifica, IdDocumento}  -> aggiorna la cache dal LIS
//  POST /api/hl7        messaggio HL7 v2 (ORM^O01 / OML^O21) nel body, text/plain      -> crea/aggiorna accettazione, risponde ACK
import { Router } from 'express';
import express from 'express';
import { config } from '../config.js';
import { one } from '../db.js';
import { ah, HttpError } from '../lib/util.js';
import * as lis from '../lib/lis.js';
import { parseHl7, ack } from '../lib/hl7.js';
import { publish } from '../lib/events.js';

const r = Router();

function checkSecret(req) {
  if (!config.lis.pushSecret) throw new HttpError(503, 'Canale non configurato (LIS_PUSH_SECRET)');
  const given = req.get('X-Push-Secret') || req.get('X-API-KEY') || req.query.secret;
  if (given !== config.lis.pushSecret) throw new HttpError(401, 'Segreto non valido');
}

r.post('/lis/push', express.json({ limit: '1mb' }), ah(async (req, res) => {
  checkSecret(req);
  const id = String(req.body?.IdAccettazione || req.body?.idAccettazione || '').trim();
  if (!id) { await lis.logEvento('PUSH', 'ERRORE', { dettaglio: 'IdAccettazione mancante', payload: JSON.stringify(req.body) }); throw new HttpError(400, 'IdAccettazione mancante'); }
  let row = null;
  try { row = await lis.refreshFromLis(id); } catch (e) { await lis.logEvento('PUSH', 'ERRORE', { accettazioneId: id, dettaglio: e.message, payload: JSON.stringify(req.body) }); return res.status(202).json({ ok: false, error: e.message }); }
  if (!row) row = await lis.upsertAccettazione({ id }, 'PUSH');   // conosciuta solo per numero: la preanalitica la completerà
  await lis.logEvento('PUSH', 'OK', { accettazioneId: id, dettaglio: `${req.body?.TipoNotifica || 'notifica'}${req.body?.IdDocumento ? ` · doc ${req.body.IdDocumento}` : ''}`, payload: JSON.stringify(req.body) });
  publish({ type: 'acc.updated', accId: id, at: new Date().toISOString() });
  res.json({ ok: true, id });
}));

r.post('/hl7', express.text({ type: '*/*', limit: '2mb' }), ah(async (req, res) => {
  checkSecret(req);
  let parsed;
  try { parsed = parseHl7(req.body); }
  catch (e) { await lis.logEvento('HL7', 'ERRORE', { dettaglio: e.message, payload: req.body }); return res.status(400).type('text/plain').send(ack(null, false, e.message)); }
  const a = parsed.accettazione;
  if (!a.id) { await lis.logEvento('HL7', 'ERRORE', { dettaglio: 'numero accettazione assente (ORC-3/ORC-2)', payload: req.body }); return res.status(400).type('text/plain').send(ack(parsed, false, 'numero accettazione assente')); }
  let sede = null;
  if (a.sede_codice) {
    sede = await one('SELECT * FROM sedi WHERE lower(codice)=lower($1)', [a.sede_codice]);
    if (!sede) sede = await one(`INSERT INTO sedi (codice, nome, tipo, note) VALUES ($1,$2,'SERVICE','Creata automaticamente dal flusso HL7: completare anagrafica ed email NC') RETURNING *`, [a.sede_codice, a.sede_codice]);
  }
  if (parsed.controlCode === 'CA') {
    await lis.logEvento('HL7', 'OK', { accettazioneId: a.id, dettaglio: 'annullamento ordine (CA): accettazione mantenuta in archivio', payload: req.body });
    return res.type('text/plain').send(ack(parsed, true));
  }
  await lis.upsertAccettazione({
    id: a.id, sede_id: sede?.id ?? null, id_richiesta_cliente: a.id_richiesta_cliente, data_accettazione: a.data_accettazione,
    paziente_cognome: a.paziente?.cognome, paziente_nome: a.paziente?.nome, paziente_nascita: a.paziente?.nascita, paziente_sesso: a.paziente?.sesso, paziente_cf: a.paziente?.cf,
    esami: a.esami, raw: { hl7: parsed.type, ctrlId: parsed.ctrlId },
  }, 'HL7');
  await lis.logEvento('HL7', 'OK', { accettazioneId: a.id, dettaglio: `${parsed.type} · sede ${a.sede_codice || '–'} · ${a.esami.length} esami`, payload: req.body });
  publish({ type: 'acc.updated', accId: a.id, at: new Date().toISOString() });
  res.type('text/plain').send(ack(parsed, true));
}));

export default r;
