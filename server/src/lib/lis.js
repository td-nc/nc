// Adapter verso StudioLAB ServiceNET (CB Sistemi) · swagger: https://servicenet.studiolab.it/swagger/ui/index
// Produzione TD: https://servicenet.toscanadiagnostica.it/API/ (WebApi 10.3.2.0, nodo "GIPONEXT"). Autenticazione: header X-API-KEY.
// Tutte le chiamate sono opzionali: senza LIS_API_KEY l'app lavora con le accettazioni ricevute via HL7 o inserite a mano.
//
// Cosa dà l'API (verificato il 24/10/2026 sul nodo di produzione):
//  - GET /api/accettazioni?id=  -> InfoAvanzamentoAccettazione: stato, esami (con Bloccato, TipoNonConformita, NonConformita),
//    referti, allegati e, dalla 10.3, anche Paziente (PazienteAccettazione). NON restituisce il cliente inviante: la sede
//    arriva dal flusso HL7 (ORC-13) o dall'assegnazione manuale in Desk. Non esiste un endpoint "elenco accettazioni":
//    la cache locale si popola con le notifiche HL7/push e con le ricerche per numero.
//  - PUT blocca/sblocca esame, POST allegati, POST segnalazioni (Prest_Messaggi) con presa in carico, commenti e risoluzione:
//    usati in write-back per far comparire la NC anche dentro StudioLAB.
//  - GET /api/studioweb/accettazioni/url -> link diretto all'accettazione in StudioWEB (se il nodo lo espone).
import { config } from '../config.js';
import { one, q } from '../db.js';

export const STATO_LIS = { 0: 'Prenotato', 10: 'In lavorazione', 20: 'Refertazione', 25: 'Refertato parziale', 40: 'Chiuso' };
// Sto facendo un'ipotesi sui codici 20/25: lo swagger li elenca senza descrizione; da confermare con CB Sistemi.

class LisError extends Error { constructor(msg, status, body) { super(msg); this.status = status; this.body = body; } }

async function call(method, path, body, { query } = {}) {
  if (!config.lis.enabled) throw new LisError('LIS non configurato (LIS_API_KEY assente)', 503);
  const url = new URL(config.lis.baseUrl + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.lis.timeoutMs);
  let res, text;
  try {
    res = await fetch(url, {
      method, signal: ctrl.signal,
      headers: { 'X-API-KEY': config.lis.apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
  } catch (e) {
    throw new LisError(e.name === 'AbortError' ? 'StudioLAB non risponde (timeout)' : `StudioLAB non raggiungibile: ${e.message}`, 502);
  } finally { clearTimeout(t); }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new LisError(`StudioLAB ${res.status}: ${(data && (data.Message || data.ErrorMessage || data.message || data.Messaggio)) || text || res.statusText}`, res.status, data);
  return data;
}

const envelope = (extra = {}) => ({ Mittente: config.lis.mittente, CodiceCliente: config.lis.codiceCliente || undefined, ...extra });

// ---- lettura / stato
export const whoami = () => call('GET', '/api/whoami');
export const ping = () => call('GET', '/api');
export async function elencoEsami({ soloCount = false } = {}) {
  const rows = await call('GET', '/api/esami', null, { query: { CodiceCliente: config.lis.codiceCliente || undefined, EscludiEsamiService: 'true' } });
  return soloCount ? (Array.isArray(rows) ? rows.length : 0) : rows;
}

export async function getInfoAccettazione(id) {
  // la variante in query string è necessaria se l'id contiene "/"
  const info = await call('GET', '/api/accettazioni', null, { query: { id } });
  return normalizeInfo(info);
}

export function normalizeInfo(info) {
  if (!info) return null;
  return {
    id: String(info.IdAccettazione || ''),
    id_richiesta_cliente: info.IdRichiestaCliente || null,
    data_accettazione: info.DataAccettazione || null,
    data_ritiro: info.DataRitiro || null,
    stato_lis: info.StatoAvanzamento ?? null,
    esami: (info.Esami || []).map((e) => ({
      idEsame: e.PlacerId || (e.FillerId != null ? String(e.FillerId) : null),
      fillerId: e.FillerId ?? null,
      cod: e.CodEsame, descrizione: e.Descrizione, stato: e.StatoAvanzamento ?? null,
      numReferto: e.NumReferto || null, bloccato: Boolean(e.Bloccato), dataSblocco: e.DataSblocco || null,
      tipoNc: e.TipoNonConformita ?? null, nc: e.NonConformita || null,
    })),
    referti: info.Referti || [], allegati: info.Allegati || [], fatture: info.Fatture || [],
    // dalla WebApi 10.3 l'InfoAvanzamento include il paziente: lo usiamo per completare la cache quando HL7 non è ancora arrivato
    paziente_cognome: info.Paziente?.Cognome || undefined, paziente_nome: info.Paziente?.Nome || undefined,
    paziente_nascita: info.Paziente?.DataNascita ? String(info.Paziente.DataNascita).slice(0, 10) : undefined,
    paziente_sesso: info.Paziente?.Sesso || undefined, paziente_cf: info.Paziente?.CodiceFiscale || undefined,
    raw: info,
  };
}

// ---- scrittura (solo se LIS_WRITE_BACK=true)
export async function bloccaEsame(idAcc, idEsame) {
  return call('PUT', `/api/accettazioni/${encodeURIComponent(idAcc)}/esami/blocca`, { CodiceCliente: config.lis.codiceCliente || undefined, IdEsame: idEsame });
}
export async function sbloccaEsame(idAcc, idEsame, numeroChiamata) {
  return call('PUT', `/api/accettazioni/${encodeURIComponent(idAcc)}/esami/sblocca`,
    { CodiceCliente: config.lis.codiceCliente || undefined, IdEsame: idEsame, DataSblocco: new Date().toISOString(), NumeroChiamata: numeroChiamata || undefined });
}
export async function caricaAllegato(idAcc, { nomeFile, tipologia, base64 }) {
  return call('POST', '/api/accettazioni/allegati', { Tipologia: tipologia || 'Non conformità', NomeFile: nomeFile, Content: base64 }, { query: { id: idAcc } });
}
export async function aggiornaNotizieCliniche(idAcc, notizie) {
  return call('POST', '/api/accettazioni/notiziecliniche', envelope({ Id: idAcc, NotizieCliniche: notizie }), { query: { id: idAcc } });
}

// ---- segnalazioni (Prest_Messaggi): la NC compare anche in StudioLAB, con presa in carico, commenti e risoluzione
const segPath = (idAcc, idMsg, tail = '') => `/api/accettazioni/${encodeURIComponent(idAcc)}/segnalazioni/${idMsg}${tail}`;
export async function inserisciSegnalazione(idAcc, { messaggio, inseritoDa, tipo }) {
  // la variante in query string è necessaria se l'id contiene "/"; risponde con l'id messaggio (stringa)
  const r = await call('POST', '/api/accettazioni/segnalazioni', { Messaggio: messaggio, InseritoDa: inseritoDa, TipoSegnalazione: tipo ?? config.lis.tipoSegnalazione }, { query: { id: idAcc } });
  const id = typeof r === 'object' && r ? (r.IdMessaggio ?? r.Id ?? r.Result ?? r) : r;
  return id != null ? String(id) : null;
}
export const getSegnalazione = (idAcc, idMsg) => call('GET', segPath(idAcc, idMsg));
export const commentaSegnalazione = (idAcc, idMsg, { commento, inseritoDa }) => call('POST', segPath(idAcc, idMsg, '/commenti'), { Commento: commento, InseritoDa: inseritoDa });
export const prendiInCaricoSegnalazione = (idAcc, idMsg, { operatore, note }) => call('PUT', segPath(idAcc, idMsg, '/presa-in-carico'), { Operatore: operatore, Note: note || '' });
export const risolviSegnalazione = (idAcc, idMsg, { risoltoDa, risoluzione }) => call('PUT', segPath(idAcc, idMsg, '/risolto'), { RisoltoDa: risoltoDa, Risoluzione: risoluzione });
export async function urlStudioWeb(idAcc) {
  try { const r = await call('GET', '/api/studioweb/accettazioni/url', null, { query: { id: idAcc } }); return r?.Url || r?.url || null; } catch { return null; }
}

// ---- cache locale -------------------------------------------------------------------------
export async function upsertSedeFromCliente(cli) {
  if (!cli || !cli.CodiceCliente) return null;
  const tipo = /lab/i.test(cli.TipoCliente || '') ? 'LABORATORIO' : 'SERVICE';
  return one(
    `INSERT INTO sedi (codice, nome, tipo, email_nc, indirizzo, citta, lis_json, lis_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT ((lower(codice))) DO UPDATE SET
       nome = COALESCE(NULLIF(EXCLUDED.nome,''), sedi.nome), email_nc = COALESCE(EXCLUDED.email_nc, sedi.email_nc),
       indirizzo = COALESCE(EXCLUDED.indirizzo, sedi.indirizzo), citta = COALESCE(EXCLUDED.citta, sedi.citta),
       lis_json = EXCLUDED.lis_json, lis_synced_at = now(), updated_at = now()
     RETURNING *`,
    [cli.CodiceCliente, cli.RagioneSociale || cli.CodiceCliente, tipo, cli.EmailNonConformita || cli.Email || null,
      cli.Indirizzo || null, [cli.CAP, cli.Citta, cli.Provincia ? `(${cli.Provincia})` : null].filter(Boolean).join(' ') || null, JSON.stringify(cli)]);
}

// Unisce nella cache ciò che arriva (stato/esami dalle API; paziente/sede da HL7 o manuale)
export async function upsertAccettazione(a, origine) {
  const cur = await one('SELECT * FROM accettazioni WHERE id=$1', [a.id]);
  const merged = {
    sede_id: a.sede_id ?? cur?.sede_id ?? null,
    id_richiesta_cliente: a.id_richiesta_cliente ?? cur?.id_richiesta_cliente ?? null,
    data_accettazione: a.data_accettazione ?? cur?.data_accettazione ?? null,
    data_ritiro: a.data_ritiro ?? cur?.data_ritiro ?? null,
    stato_lis: a.stato_lis ?? cur?.stato_lis ?? null,
    paziente_cognome: a.paziente_cognome ?? cur?.paziente_cognome ?? null,
    paziente_nome: a.paziente_nome ?? cur?.paziente_nome ?? null,
    paziente_nascita: a.paziente_nascita ?? cur?.paziente_nascita ?? null,
    paziente_sesso: a.paziente_sesso ?? cur?.paziente_sesso ?? null,
    paziente_cf: a.paziente_cf ?? cur?.paziente_cf ?? null,
    esami: a.esami && a.esami.length ? a.esami : (cur?.esami || []),
    lis_json: a.raw ? a.raw : cur?.lis_json ?? null,
  };
  // esami: se arrivano da fonti diverse, unisci per codice mantenendo stato/blocco più recenti
  if (cur && a.esami && a.esami.length && cur.esami?.length) {
    const byCod = new Map(cur.esami.map((e) => [e.cod, e]));
    for (const e of a.esami) byCod.set(e.cod, { ...byCod.get(e.cod), ...e });
    merged.esami = [...byCod.values()];
  }
  return one(
    `INSERT INTO accettazioni (id, sede_id, id_richiesta_cliente, data_accettazione, data_ritiro, stato_lis, paziente_cognome, paziente_nome, paziente_nascita, paziente_sesso, paziente_cf, esami, origine, lis_json, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     ON CONFLICT (id) DO UPDATE SET sede_id=EXCLUDED.sede_id, id_richiesta_cliente=EXCLUDED.id_richiesta_cliente, data_accettazione=EXCLUDED.data_accettazione,
       data_ritiro=EXCLUDED.data_ritiro, stato_lis=EXCLUDED.stato_lis, paziente_cognome=EXCLUDED.paziente_cognome, paziente_nome=EXCLUDED.paziente_nome,
       paziente_nascita=EXCLUDED.paziente_nascita, paziente_sesso=EXCLUDED.paziente_sesso, paziente_cf=EXCLUDED.paziente_cf, esami=EXCLUDED.esami,
       origine = CASE WHEN accettazioni.origine = 'MANUALE' AND EXCLUDED.origine <> 'MANUALE' THEN EXCLUDED.origine ELSE accettazioni.origine END,
       lis_json=EXCLUDED.lis_json, fetched_at=now(), updated_at=now()
     RETURNING *`,
    [a.id, merged.sede_id, merged.id_richiesta_cliente, merged.data_accettazione, merged.data_ritiro, merged.stato_lis, merged.paziente_cognome, merged.paziente_nome,
      merged.paziente_nascita, merged.paziente_sesso, merged.paziente_cf, JSON.stringify(merged.esami), origine || cur?.origine || 'LIS', merged.lis_json ? JSON.stringify(merged.lis_json) : null]);
}

export async function logEvento(canale, esito, { accettazioneId, dettaglio, payload } = {}) {
  try { await q('INSERT INTO lis_eventi (canale, esito, accettazione_id, dettaglio, payload) VALUES ($1,$2,$3,$4,$5)', [canale, esito, accettazioneId || null, dettaglio || null, payload ? String(payload).slice(0, 20000) : null]); }
  catch (e) { console.error('[lis_eventi]', e.message); }
}

// Aggiorna la cache dal LIS (se configurato). Ritorna la riga della cache o null se l'accettazione non esiste nel LIS.
export async function refreshFromLis(id) {
  if (!config.lis.enabled) return null;
  try {
    const info = await getInfoAccettazione(id);
    if (!info || !info.id) return null;
    const row = await upsertAccettazione({ ...info, id }, 'LIS');
    await logEvento('API', 'OK', { accettazioneId: id, dettaglio: `stato ${info.stato_lis}, ${info.esami.length} esami` });
    return row;
  } catch (e) {
    await logEvento('API', 'ERRORE', { accettazioneId: id, dettaglio: e.message });
    if (e.status === 400 || e.status === 404) return null;   // non trovata
    throw e;
  }
}

export { LisError };
