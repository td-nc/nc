// Parser HL7 v2 minimale per il flusso ordini (ORM^O01 / OML^O21) ricevuto da StudioLAB over HTTPS.
// Serve a popolare la cache delle accettazioni con sede inviante, paziente ed esami richiesti.
// La mappatura dei campi (in particolare numero accettazione e codice sede) va confermata con CB Sistemi
// sulla base della loro documentazione HL7: i campi usati qui sono quelli standard.
//   MSH-4  sending facility  -> codice sede (fallback: ORC-21 ordering facility, PV1-3 point of care)
//   PID-3  patient id (CF)   PID-5 nome   PID-7 nascita   PID-8 sesso
//   ORC-2 / OBR-2 placer order number  -> riferimento del cliente
//   ORC-3 / OBR-3 filler order number  -> numero accettazione del laboratorio
//   OBR-4  universal service id        -> codice^descrizione esame
//   ORC-9 / OBR-7                      -> data accettazione / data richiesta

export function parseHl7(text) {
  const raw = String(text || '').replace(/^﻿/, '').replace(/\r\n|\n/g, '\r').trim();
  const segs = raw.split('\r').filter(Boolean);
  if (!segs.length || !segs[0].startsWith('MSH')) throw new Error('Messaggio HL7 non valido (MSH mancante)');
  const fs = segs[0][3] || '|';
  const enc = segs[0].slice(4, 8);
  const cs = enc[0] || '^', rs = enc[1] || '~', sub = enc[3] || '&';
  const F = (seg, i) => { const f = seg.split(fs); return seg.startsWith('MSH') ? (i === 1 ? fs : i === 2 ? enc : (f[i - 1] || '')) : (f[i] || ''); };
  const C = (field, i) => (String(field || '').split(cs)[i - 1] || '');
  const R = (field) => String(field || '').split(rs);

  const msh = segs[0];
  const type = F(msh, 9);
  const ctrlId = F(msh, 10);
  const sendingApp = F(msh, 3), sendingFacility = C(F(msh, 4), 1);
  const pid = segs.find((s) => s.startsWith('PID'));
  const pv1 = segs.find((s) => s.startsWith('PV1'));
  const orcs = segs.filter((s) => s.startsWith('ORC'));
  const obrs = segs.filter((s) => s.startsWith('OBR'));

  const d = (ts) => { const m = String(ts || '').match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/); return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? `T${m[4]}:${m[5]}:${m[6] || '00'}` : ''}` : null; };

  let paz = null;
  if (pid) {
    const name = F(pid, 5);
    const ids = R(F(pid, 3));
    const cf = ids.map((x) => C(x, 1)).find((x) => /^[A-Z0-9]{16}$/i.test(x)) || null;
    paz = { cognome: C(name, 1) || null, nome: C(name, 2) || null, nascita: d(F(pid, 7))?.slice(0, 10) || null, sesso: F(pid, 8) || null, cf };
  }
  const orc0 = orcs[0] || '';
  const obr0 = obrs[0] || '';
  const filler = C(F(orc0, 3), 1) || C(F(obr0, 3), 1);
  const placer = C(F(orc0, 2), 1) || C(F(obr0, 2), 1);
  const sede = sendingFacility || C(F(orc0, 21), 1) || C(F(pv1 || '', 3), 1) || null;
  const esami = obrs.map((o) => ({ idEsame: C(F(o, 2), 1) || C(F(o, 3), 1) || null, cod: C(F(o, 4), 1), descrizione: C(F(o, 4), 2) || C(F(o, 4), 1), stato: null, bloccato: false }))
    .filter((e) => e.cod);
  const dataAcc = d(F(orc0, 9)) || d(F(obr0, 7)) || d(F(msh, 7));
  const controlCode = F(orc0, 1) || 'NW';   // NW nuovo, CA annullato, XO modifica

  return {
    type, ctrlId, sendingApp, sendingFacility, controlCode,
    accettazione: { id: filler || placer || null, id_richiesta_cliente: placer || null, sede_codice: sede, data_accettazione: dataAcc, paziente: paz, esami },
  };
}

export function ack(parsed, ok = true, errText = '') {
  const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const msh = `MSH|^~\\&|TD-NC|TOSCANADIAGNOSTICA|${parsed?.sendingApp || ''}|${parsed?.sendingFacility || ''}|${now}||ACK|${now}${Math.floor(Math.random() * 1000)}|P|2.5`;
  const msa = `MSA|${ok ? 'AA' : 'AE'}|${parsed?.ctrlId || ''}${ok ? '' : `|${errText.replace(/[|\r\n]/g, ' ')}`}`;
  return `${msh}\r${msa}\r`;
}
