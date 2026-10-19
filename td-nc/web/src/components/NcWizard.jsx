// Apertura di una non conformità dal desk di preanalitica: 3 passi, pochi clic, testi proposti dal catalogo.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Modal, Field, ErrorBox, useApi, Loading } from './ui.jsx';
import { MACRO, GRAVITA, GRAVITA_HELP, fileToB64, fmtBytes } from '../format.js';

export default function NcWizard({ acc, onClose, onDone }) {
  const { data: tipi } = useApi('/tipi');
  const { data: cfg } = useApi('/auth/config');
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ macro: '', tipo_id: null, tipo_altro: '', gravita: 'MINORE', descrizione: '', azione_attesa: '', esami: [], campione_bloccato: true, blocca_lis: false, invia: true });
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const tipo = useMemo(() => (tipi || []).find((t) => t.id === f.tipo_id), [tipi, f.tipo_id]);
  const tipiMacro = (tipi || []).filter((t) => t.macro === f.macro);
  const isAltro = tipo?.codice === 'ALTRO';

  const pickTipo = (t) => setF((x) => ({ ...x, tipo_id: t.id, gravita: t.gravita_default, azione_attesa: x.azione_attesa || t.azione_attesa || '', esami: x.esami.length ? x.esami : (acc.esami || []).map((e) => ({ cod: e.cod, descrizione: e.descrizione || '', idEsame: e.idEsame || null })) }));
  useEffect(() => { if (tipo && !isAltro && f.azione_attesa === '') setF((x) => ({ ...x, azione_attesa: tipo.azione_attesa || '' })); /* eslint-disable-next-line */ }, [tipo]);

  const toggleEsame = (e) => setF((x) => ({ ...x, esami: x.esami.some((y) => y.cod === e.cod) ? x.esami.filter((y) => y.cod !== e.cod) : [...x.esami, { cod: e.cod, descrizione: e.descrizione || '', idEsame: e.idEsame || null }] }));
  const addFiles = async (list) => {
    const out = [];
    for (const file of Array.from(list)) {
      if (file.size > 6 * 1024 * 1024) { setErr(new Error(`${file.name}: massimo 6 MB per allegato`)); continue; }
      out.push({ nome: file.name, mime: file.type || 'application/octet-stream', size: file.size, base64: await fileToB64(file) });
    }
    setFiles((x) => [...x, ...out]);
  };
  const canNext1 = f.macro && (f.tipo_id || f.tipo_altro.trim());
  const canSave = canNext1 && f.descrizione.trim().length >= 5 && f.azione_attesa.trim().length >= 5;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/nc', { accettazione_id: acc.id, macro: f.macro, tipo_id: f.tipo_id, tipo_altro: f.tipo_altro.trim() || null, gravita: f.gravita, descrizione: f.descrizione.trim(), azione_attesa: f.azione_attesa.trim(),
        esami_coinvolti: f.esami, campione_bloccato: f.campione_bloccato, blocca_lis: f.blocca_lis, invia: f.invia, allegati: files.map(({ nome, mime, base64 }) => ({ nome, mime, base64 })) });
      onDone(r);
    } catch (e) { setErr(e); setBusy(false); }
  };

  return (
    <Modal wide title={`Nuova non conformità · accettazione ${acc.id}`} onClose={onClose} footer={<>
      {step > 1 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Indietro</button>}
      <div className="spacer" />
      <button className="btn ghost" onClick={onClose}>Annulla</button>
      {step < 3 && <button className="btn" disabled={step === 1 ? !canNext1 : !canSave} onClick={() => setStep(step + 1)}>Avanti</button>}
      {step === 3 && <button className="btn" disabled={busy || !canSave} onClick={save}>{busy ? 'Registrazione…' : f.invia ? 'Registra e invia alla sede' : 'Registra (senza inviare)'}</button>}
    </>}>
      <div className="phases" style={{ marginBottom: 14 }}>
        {['Tipologia', 'Dettaglio', 'Conferma'].map((l, i) => <div key={l} className={`ph ${step > i + 1 ? 'done' : step === i + 1 ? 'now' : ''}`}><i>{i + 1}</i>{l}</div>)}
      </div>
      <ErrorBox error={err} />
      <div className="small muted" style={{ marginBottom: 10 }}>Sede inviante: <b>{acc.sede_nome}</b> · paziente {[acc.paziente_cognome, acc.paziente_nome].filter(Boolean).join(' ') || '–'}</div>

      {step === 1 && <div style={{ display: 'grid', gap: 14 }}>
        <div className="macro">{Object.entries(MACRO).map(([k, v]) => <button key={k} className={f.macro === k ? 'on' : ''} onClick={() => setF({ ...f, macro: k, tipo_id: null, tipo_altro: '', azione_attesa: '' })}><span className="t">{v.label}</span><span className="s">{v.sub}</span></button>)}</div>
        {f.macro && (!tipi ? <Loading /> : <div className="tipi">{tipiMacro.map((t) => <button key={t.id} className={f.tipo_id === t.id ? 'on' : ''} onClick={() => pickTipo(t)}><span className="l">{t.label}</span>{t.descrizione && <span className="d">{t.descrizione}</span>}</button>)}</div>)}
        {(isAltro || (f.macro && !f.tipo_id)) && f.macro && <Field label="Specifica (obbligatoria se la tipologia non è in elenco)"><input value={f.tipo_altro} onChange={(e) => setF({ ...f, tipo_altro: e.target.value })} placeholder="Descrivi in poche parole la tipologia" /></Field>}
      </div>}

      {step === 2 && <div style={{ display: 'grid', gap: 14 }}>
        <div className="row">
          <Field label="Gravità" help={GRAVITA_HELP[f.gravita]} className="" >
            <div className="seg">{Object.entries(GRAVITA).map(([k, v]) => <label key={k} className={f.gravita === k ? 'on' : ''}><input type="radio" checked={f.gravita === k} onChange={() => setF({ ...f, gravita: k })} />{v}</label>)}</div>
          </Field>
        </div>
        <Field label={`Esami coinvolti (${f.esami.length} di ${(acc.esami || []).length})`} help="Deseleziona gli esami non interessati: il blocco riguarda solo quelli selezionati. Nessuna selezione = tutta l'accettazione.">
          <div className="esami">{(acc.esami || []).map((e) => <label key={e.cod + (e.idEsame || '')} className={f.esami.some((y) => y.cod === e.cod) ? 'on' : ''}><input type="checkbox" style={{ display: 'none' }} checked={f.esami.some((y) => y.cod === e.cod)} onChange={() => toggleEsame(e)} /><b>{e.cod}</b> {e.descrizione}</label>)}{!(acc.esami || []).length && <span className="small muted">Nessun esame in archivio per questa accettazione</span>}</div>
        </Field>
        <Field label="Descrizione della non conformità" help="Cosa hai osservato, in modo oggettivo (aspetto, volume, etichetta, documento mancante). Non inserire dati del paziente oltre a quelli già in accettazione: questa descrizione resta nel fascicolo, non viaggia via email."><textarea autoFocus value={f.descrizione} onChange={(e) => setF({ ...f, descrizione: e.target.value })} placeholder={tipo?.descrizione || 'Es. siero francamente emolizzato nella provetta gialla, volume 2 mL.'} /></Field>
        <Field label="Azione attesa dalla sede" help="È il testo che la sede legge nell'email: chiaro, operativo, con la scadenza implicita dello SLA."><textarea value={f.azione_attesa} onChange={(e) => setF({ ...f, azione_attesa: e.target.value })} /></Field>
        <Field label="Allegati (foto del campione, modulo scansionato)" help="Fino a 6 MB per file. Le foto della provetta sono l'evidenza oggettiva più utile in caso di contestazione.">
          <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addFiles(e.target.files)} />
          {files.length > 0 && <div className="attach-list mt" style={{ marginTop: 6 }}>{files.map((x, i) => <span key={i}>{x.nome} · {fmtBytes(x.size)} <button className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Rimuovi">✕</button></span>)}</div>}
        </Field>
      </div>}

      {step === 3 && <div style={{ display: 'grid', gap: 12 }}>
        <table className="t"><tbody>
          <tr><td className="muted small" style={{ width: 160 }}>Tipologia</td><td><b>{MACRO[f.macro]?.label}</b> · {tipo?.label || f.tipo_altro}{isAltro && f.tipo_altro ? ` · ${f.tipo_altro}` : ''}</td></tr>
          <tr><td className="muted small">Gravità</td><td className={`grav-${f.gravita}`}>{GRAVITA[f.gravita]}{f.gravita !== 'MINORE' && <span className="small muted"> · analisi della causa radice obbligatoria prima della chiusura</span>}</td></tr>
          <tr><td className="muted small">Esami</td><td>{f.esami.length ? f.esami.map((e) => e.cod).join(', ') : 'tutta l\'accettazione'}</td></tr>
          <tr><td className="muted small">Descrizione</td><td style={{ whiteSpace: 'pre-wrap' }}>{f.descrizione}</td></tr>
          <tr><td className="muted small">Azione attesa</td><td style={{ whiteSpace: 'pre-wrap' }}>{f.azione_attesa}</td></tr>
          <tr><td className="muted small">Allegati</td><td>{files.length ? files.map((x) => x.nome).join(', ') : '–'}</td></tr>
          <tr><td className="muted small">Destinatario</td><td>{acc.sede_email || <span className="red">la sede non ha un'email NC: l'invio fallirà, impostala in Sedi invianti</span>}</td></tr>
        </tbody></table>
        <label className="f inline"><input type="checkbox" checked={f.campione_bloccato} onChange={(e) => setF({ ...f, campione_bloccato: e.target.checked })} /> Campione bloccato fisicamente sul desk (cartellino "Materiale non conforme")</label>
        <label className="f inline" title={cfg?.lisEnabled ? '' : 'LIS non collegato'}><input type="checkbox" disabled={!cfg?.lisEnabled} checked={f.blocca_lis} onChange={(e) => setF({ ...f, blocca_lis: e.target.checked })} /> Blocca gli esami coinvolti anche su StudioLAB {!cfg?.lisEnabled && <span className="small muted">(LIS non collegato)</span>}</label>
        <label className="f inline"><input type="checkbox" checked={f.invia} onChange={(e) => setF({ ...f, invia: e.target.checked })} /> Invia subito l'email alla sede inviante (parte lo SLA di risposta)</label>
      </div>}
    </Modal>
  );
}
