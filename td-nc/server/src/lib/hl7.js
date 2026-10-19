// Parser HL7 v2.5 per i messaggi di StudioLAB (CB Sistemi), specifica "Integrazione HL7 con ServiceNET" rev. 3 del 27/03/2026.
// Trasporto: HL7 over HTTPS (Appendice B): POST text/plain, autenticazione X-API-KEY, risposta sempre HTTP 200 con ACK nel body.
//
// Messaggi gestiti in ingresso (StudioLAB -> td-nc):
//   OML^O21  inserimento accettazione (da un Order Placer) o notifica cambio stato (da StudioLAB): ORC-1 NW/SC/HD/SN/CA, ORC-5 IP/CA/HD/CM/SC
//   ORL^O22  risposta all'inserimento: filler ID e numero accettazione del laboratorio (OBR-20)
//   MDM^T02 / MDM^T10  referto firmato: ORC-1 OC = esame non eseguito per non conformità
//   ADT^A05 / ADT^A39  anagrafica: aggiornamento paziente; il merge viene solo registrato
// Mappatura dei campi (dal documento):
//   PID-3 (ripetibile) ^^^^NN = codice fiscale, ^^^^PI = id paziente placer; PID-5 cognome^nome; PID-7 nascita yyyyMMdd; PID-8 sesso
//   PV1-19 placer ID accettazione; PV1-44 data accettazione; PV1-16 urgente
//   ORC-1 controllo; ORC-2 placer ID esame; ORC-3 filler ID esame; ORC-4 placer ID accettazione; ORC-5 stato; ORC-9 data; ORC-13 codice cliente
//   OBR-2/3 come ORC; OBR-4 codice^descrizione esame; OBR-20 numero accettazione lato laboratorio (nelle risposte)
//   FT1-13.1 codice cliente (segmento opzionale, Appendice C)
//   MSH-4 presidio inviante (fallback per la sede solo se ORC-13 e FT1 mancano)

const ORC_CONTROL = { NW: 'nuovo', SC: 'cambio stato', HD: 'bloccato (non conformità)', SN: 'aggiunto dal laboratorio', CA: 'eliminato', OK: 'confermato', OC: 'non eseguito (non conformità)', RP: 'sostituito' };
const ORC_STATUS = { IP: 10, CA: null, HD: null, CM: 40, SC: 0 };   // stato esame -> StatoAvanzamento compatibile con le API (ipotesi: IP≈in lavorazione, CM≈chiuso, SC≈prenotato)

export function parseHl7(text) {
  const raw = String(text || '').replace(/^﻿/, '').replace(/^[\x0B]/, '').replace(/[\x1C\x0D]*$/, '').replace(/\r\n|\n/g, '\r').trim();
  const segs = raw.split('\r').map((s) => s.trim()).filter(Boolean);
  if (!segs.length || !segs[0].startsWith('MSH')) throw new Error('Messaggio HL7 non valido (MSH mancante)');
  const fs = segs[0][3] || '|';
  const enc = segs[0].slice(4, 8);
  const cs = enc[0] || '^', rs = enc[1] || '~';
  const F = (seg, i) => { if (!seg) return ''; const f = seg.split(fs); return seg.startsWith('MSH') ? (i === 1 ? fs : i === 2 ? enc : (f[i - 1] || '')) : (f[i] || ''); };
  const C = (field, i) => (String(field || '').split(cs)[i - 1] || '');
  const R = (field) => String(field || '').split(rs).filter(Boolean);
  const d = (ts) => { const m = String(ts || '').match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/); return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? `T${m[4]}:${m[5]}:${m[6] || '00'}` : ''}` : null; };

  const msh = segs[0];
  const msgType = F(msh, 9);
  const code = C(msgType, 1), trigger = C(msgType, 2), structure = C(msgType, 3) || `${code}_${trigger}`;
  const ctrlId = F(msh, 10);
  const sendingApp = F(msh, 3), sendingFacility = C(F(msh, 4), 1);
  const receivingApp = F(msh, 5), receivingFacility = F(msh, 6);
  const pid = segs.find((s) => s.startsWith('PID'));
  const pv1 = segs.find((s) => s.startsWith('PV1'));
  const ft1 = segs.find((s) => s.startsWith('FT1'));
  const mrg = segs.find((s) => s.startsWith('MRG'));
  const txa = segs.find((s) => s.startsWith('TXA'));

  // paziente
  let paz = null;
  if (pid) {
    const ids = R(F(pid, 3));
    const byType = (t) => ids.map((x) => ({ id: C(x, 1), type: C(x, 5) })).find((x) => x.type === t)?.id || null;
    const cf = byType('NN') || ids.map((x) => C(x, 1)).find((x) => /^[A-Z0-9]{16}$/i.test(x)) || null;
    const name = F(pid, 5);
    paz = { cognome: C(name, 1) || null, nome: C(name, 2) || null, nascita: d(F(pid, 7))?.slice(0, 10) || null, sesso: F(pid, 8) || null, cf, idPlacer: byType('PI') };
  }

  // gruppi ORC/OBR
  const ordini = [];
  let cur = null;
  for (const s of segs) {
    if (s.startsWith('ORC')) { cur = { control: F(s, 1), placerEsame: C(F(s, 2), 1), fillerEsame: C(F(s, 3), 1), placerAcc: C(F(s, 4), 1), status: F(s, 5), data: d(F(s, 9)), cliente: C(F(s, 13), 1) }; ordini.push(cur); }
    else if (s.startsWith('OBR')) {
      if (!cur || cur.cod) { cur = { placerEsame: C(F(s, 2), 1), fillerEsame: C(F(s, 3), 1) }; ordini.push(cur); }
      cur.cod = C(F(s, 4), 1); cur.descrizione = C(F(s, 4), 2) || C(F(s, 4), 1);
      cur.fillerAcc = C(F(s, 20), 1) || null;   // numero accettazione lato laboratorio (ORL_O22)
      cur.placerEsame ||= C(F(s, 2), 1); cur.fillerEsame ||= C(F(s, 3), 1);
      cur.dataEsecuzione = d(F(s, 7)) || d(F(s, 36));
    }
  }
  const placerAcc = C(F(pv1, 19), 1) || ordini.find((o) => o.placerAcc)?.placerAcc || C(F(txa, 14), 1) || null;
  const fillerAcc = ordini.find((o) => o.fillerAcc)?.fillerAcc || C(F(txa, 15), 1) || null;
  const cliente = ordini.find((o) => o.cliente)?.cliente || (ft1 ? C(F(ft1, 13), 1) : '') || null;
  const dataAcc = d(F(pv1, 44)) || ordini.find((o) => o.data)?.data || d(F(msh, 7));

  const esami = ordini.filter((o) => o.cod).map((o) => ({
    cod: o.cod, descrizione: o.descrizione || '', idEsame: o.fillerEsame || o.placerEsame || null, placerId: o.placerEsame || null, fillerId: o.fillerEsame || null,
    stato: o.status ? ORC_STATUS[o.status] ?? null : null, statoHl7: o.status || null, controllo: o.control || null,
    bloccato: o.control === 'HD' || o.status === 'HD', annullato: o.control === 'CA' || o.status === 'CA', nonEseguito: o.control === 'OC',
    nc: o.control === 'HD' || o.status === 'HD' ? 'Esame bloccato su StudioLAB (HD)' : o.control === 'OC' ? 'Esame non eseguito per non conformità (OC)' : null,
  }));

  return {
    type: structure, code, trigger, ctrlId, sendingApp, sendingFacility, receivingApp, receivingFacility,
    controlCode: ordini[0]?.control || null,
    merge: mrg ? { idDaEliminare: C(F(mrg, 1), 1) } : null,
    referto: txa ? { numero: F(txa, 12), sostituito: F(txa, 16) || null, tipo: F(txa, 21) || null } : null,
    accettazione: {
      // numero accettazione: lato laboratorio se presente (OBR-20 / TXA-15), altrimenti placer (PV1-19 / ORC-4)
      id: fillerAcc || placerAcc || null,
      id_lab: fillerAcc, id_placer: placerAcc,
      id_richiesta_cliente: placerAcc && placerAcc !== fillerAcc ? placerAcc : null,
      sede_codice: cliente || sendingFacility || null,
      sede_da_msh: !cliente,
      data_accettazione: dataAcc, urgente: F(pv1, 16) === '1',
      paziente: paz, esami,
    },
  };
}

// ACK (MSH + MSA). MSH-9.2 riflette il trigger del messaggio ricevuto (ACK^O21, ACK^T02...). Sempre HTTP 200.
export function ack(parsed, ok = true, errText = '') {
  const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const trig = parsed?.trigger || '';
  const msh = `MSH|^~\\&|TD-NC|TOSCANADIAGNOSTICA|${parsed?.sendingApp || 'STUDIOLAB'}|${parsed?.sendingFacility || ''}|${now}||ACK^${trig}|ACK-${now}${Math.floor(Math.random() * 1000)}|P|2.5|||||UNICODE UTF-8`;
  const msa = `MSA|${ok ? 'AA' : 'AE'}|${parsed?.ctrlId || ''}|${ok ? 'OK' : errText.replace(/[|\r\n]/g, ' ')}`;
  return `${msh}\r\n${msa}\r\n`;
}

export { ORC_CONTROL, ORC_STATUS };
