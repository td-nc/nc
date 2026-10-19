// Canali in ingresso da StudioLAB, senza sessione utente: protetti da segreto condiviso (LIS_PUSH_SECRET).
//  POST /api/lis/push   NotificaPush JSON {IdAccettazione, TipoNotifica, IdDocumento}  -> aggiorna la cache dal LIS
//  POST /api/hl7        messaggio HL7 v2.5 StudioLAB (OML^O21, ORL^O22, MDM^T02/T10, ADT) nel body text/plain -> aggiorna la cache, risponde ACK (sempre HTTP 200)
//  Specifica: CB Sistemi, "Integrazione HL7 con ServiceNET" rev. 3 (27/03/2026). Autenticazione: header X-API-KEY (o X-Push-Secret) = LIS_PUSH_SECRET
import { Router } from 'express';
import express from 'express';
import { config } from '../config.js';
import { one, q } from '../db.js';
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

r.post('/hl7', express.text({ type: '*/*', limit: '4mb' }), ah(async (req, res) => {
  checkSecret(req);
  const reply = (parsed, ok, err) => res.status(200).type('text/plain').send(ack(parsed, ok, err));   // Appendice B: sempre 200, esito nel segmento MSA
  let parsed;
  try { parsed = parseHl7(req.body); }
  catch (e) { await lis.logEvento('HL7', 'ERRORE', { dettaglio: e.message, payload: req.body }); return reply(null, false, e.message); }
  const a = parsed.accettazione;
  try {
    // Anagrafica: ADT^A05 aggiorna il paziente sulle accettazioni note; ADT^A39 (merge) viene solo registrato
    if (parsed.code === 'ADT') {
      if (parsed.merge) await lis.logEvento('HL7', 'OK', { dettaglio: `merge anagrafiche: ${parsed.merge.idDaEliminare} -> ${a.paziente?.cf || a.paziente?.idPlacer || '?'} (registrato, nessuna azione)`, payload: req.body });
      else if (a.paziente?.cf) {
        const r2 = await q(`UPDATE accettazioni SET paziente_cognome=coalesce($2,paziente_cognome), paziente_nome=coalesce($3,paziente_nome), paziente_nascita=coalesce($4,paziente_nascita), paziente_sesso=coalesce($5,paziente_sesso), updated_at=now() WHERE paziente_cf=$1`, [a.paziente.cf, a.paziente.cognome, a.paziente.nome, a.paziente.nascita, a.paziente.sesso]);
        await lis.logEvento('HL7', 'OK', { dettaglio: `${parsed.type}: anagrafica aggiornata su ${r2.rowCount} accettazioni`, payload: req.body });
      }
      return reply(parsed, true);
    }
    if (!a.id) { await lis.logEvento('HL7', 'ERRORE', { dettaglio: 'numero accettazione assente (PV1-19 / ORC-4 / OBR-20)', payload: req.body }); return reply(parsed, false, 'Numero accettazione assente'); }
    let sede = null;
    if (a.sede_codice) {
      sede = await one('SELECT * FROM sedi WHERE lower(codice)=lower($1)', [a.sede_codice]);
      if (!sede && !a.sede_da_msh) sede = await one(`INSERT INTO sedi (codice, nome, tipo, note) VALUES ($1,$2,'SERVICE','Creata automaticamente dal flusso HL7 (ORC-13): completare anagrafica ed email NC') RETURNING *`, [a.sede_codice, a.sede_codice]);
    }
    const row = await lis.upsertAccettazione({
      id: a.id, sede_id: sede?.id ?? null, id_richiesta_cliente: a.id_richiesta_cliente, data_accettazione: a.data_accettazione,
      paziente_cognome: a.paziente?.cognome, paziente_nome: a.paziente?.nome, paziente_nascita: a.paziente?.nascita, paziente_sesso: a.paziente?.sesso, paziente_cf: a.paziente?.cf,
      stato_lis: a.esami.length && a.esami.every((e) => e.stato === 40) ? 40 : (a.esami.some((e) => e.stato === 10) ? 10 : undefined),
      esami: a.esami, raw: { hl7: parsed.type, ctrlId: parsed.ctrlId, controllo: parsed.controlCode, referto: parsed.referto },
    }, 'HL7');
    // se arriva prima il numero placer e poi quello del laboratorio (ORL_O22), collega le due identità
    if (a.id_lab && a.id_placer && a.id_lab !== a.id_placer) await q(`UPDATE nc SET accettazione_id=$1 WHERE accettazione_id=$2`, [a.id_lab, a.id_placer]).catch(() => {});
    const flags = a.esami.filter((e) => e.bloccato || e.nonEseguito).map((e) => `${e.cod}:${e.statoHl7 || e.controllo}`);
    await lis.logEvento('HL7', 'OK', { accettazioneId: a.id, dettaglio: `${parsed.type}${parsed.controlCode ? ` ${parsed.controlCode}` : ''} · sede ${a.sede_codice || '–'}${a.sede_da_msh ? ' (da MSH-4)' : ''} · ${a.esami.length} esami${flags.length ? ` · NC LIS: ${flags.join(', ')}` : ''}`, payload: req.body });
    publish({ type: 'acc.updated', accId: row.id, at: new Date().toISOString() });
    return reply(parsed, true);
  } catch (e) {
    await lis.logEvento('HL7', 'ERRORE', { accettazioneId: a?.id, dettaglio: e.message, payload: req.body });
    return reply(parsed, false, `Errore interno: ${e.message}`);
  }
}));

export default r;
