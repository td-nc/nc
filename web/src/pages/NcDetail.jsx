import React, { useContext, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isSede, isLab, isQualita } from '../auth.jsx';
import { useApi, Card, Field, Loading, Empty, Badge, ErrorBox, Modal, PromptModal, useToast, Icon } from '../components/ui.jsx';
import { STATO, STATO_SEDE, GRAVITA, GRAVITA_HELP, MACRO, TRATT, RCA_CAT, AZ_STATO, MSG_TIPO, APERTE, STATO_LIS, itDate, itDateTime, slaClass, fileToB64, fmtBytes } from '../format.js';
import { LiveCtx } from '../App.jsx';

const PHASES = ['Rilevazione e blocco', 'Trattamento', 'Causa radice', 'Azioni CAPA', 'Chiusura e verifica'];
function phaseIndex(nc, azioni) {
  if (nc.stato === 'VERIFICATA') return 5;
  if (nc.stato === 'CHIUSA') return 4;
  if (azioni.length) return 3;
  if (nc.rca_causa) return 3;
  if (nc.trattamento_tipo) return 2;
  return nc.stato === 'APERTA' ? 0 : 1;
}

function Attach({ ncId, a }) { return <a href={`/api/nc/${ncId}/allegati/${a.id}`} target="_blank" rel="noreferrer"><Icon name="file" size={13} /> {a.nome_file} <span className="muted">({fmtBytes(a.dimensione)})</span></a>; }

function MessageForm({ nc, sede, onSent }) {
  const { user } = useAuth();
  const toast = useToast();
  const sedeUser = isSede(user);
  const [tipo, setTipo] = useState(sedeUser ? 'RISPOSTA' : 'RICHIESTA');
  const [testo, setTesto] = useState('');
  const [done, setDone] = useState(false);
  const [c, setC] = useState({ nome: user.full_name || '', email: user.email || '', tel: user.telefono || '' });
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const addFiles = async (list) => { const out = []; for (const f of Array.from(list)) { if (f.size > 6e6) { setErr(new Error(`${f.name}: massimo 6 MB`)); continue; } out.push({ nome: f.name, mime: f.type || 'application/octet-stream', size: f.size, base64: await fileToB64(f) }); } setFiles((x) => [...x, ...out]); };
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post(`/nc/${nc.id}/messaggi`, { tipo, testo, azione_eseguita: sedeUser ? done : undefined, contatto_nome: c.nome, contatto_email: c.email, contatto_tel: c.tel, allegati: files.map(({ nome, mime, base64 }) => ({ nome, mime, base64 })) });
      setTesto(''); setFiles([]); setDone(false); toast(sedeUser ? 'Risposta inviata al laboratorio' : tipo === 'NOTA_INTERNA' ? 'Nota salvata' : 'Comunicazione inviata alla sede'); onSent();
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  const open = APERTE.includes(nc.stato);
  if (!open && !(isLab(user))) return null;
  return (
    <Card title={sedeUser ? 'Rispondi al laboratorio' : 'Scrivi'}>
      <ErrorBox error={err} />
      <div style={{ display: 'grid', gap: 12 }}>
        {!sedeUser && <div className="seg">
          {open && <label className={tipo === 'RICHIESTA' ? 'on' : ''}><input type="radio" checked={tipo === 'RICHIESTA'} onChange={() => setTipo('RICHIESTA')} />Richiesta alla sede (email + SLA)</label>}
          {open && <label className={tipo === 'CHIARIMENTO' ? 'on' : ''}><input type="radio" checked={tipo === 'CHIARIMENTO'} onChange={() => setTipo('CHIARIMENTO')} />Chiarimento alla sede</label>}
          <label className={tipo === 'NOTA_INTERNA' ? 'on' : ''}><input type="radio" checked={tipo === 'NOTA_INTERNA'} onChange={() => setTipo('NOTA_INTERNA')} />Nota interna</label>
        </div>}
        {sedeUser && <div className="seg">
          <label className={tipo === 'RISPOSTA' ? 'on' : ''}><input type="radio" checked={tipo === 'RISPOSTA'} onChange={() => setTipo('RISPOSTA')} />Risposta</label>
          <label className={tipo === 'CHIARIMENTO' ? 'on' : ''}><input type="radio" checked={tipo === 'CHIARIMENTO'} onChange={() => setTipo('CHIARIMENTO')} />Chiedo un chiarimento</label>
        </div>}
        <Field label={sedeUser ? 'Messaggio per il laboratorio' : 'Testo'}><textarea value={testo} onChange={(e) => setTesto(e.target.value)} placeholder={sedeUser ? 'Es. paziente richiamato, nuovo prelievo eseguito e inviato con il corriere delle 12:00.' : tipo === 'NOTA_INTERNA' ? 'Nota visibile solo al laboratorio' : 'Testo che la sede riceverà via email'} /></Field>
        {sedeUser && <>
          <label className="f inline"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> <b>Confermo di aver eseguito l'azione richiesta</b> ({nc.azione_attesa.length > 90 ? `${nc.azione_attesa.slice(0, 90)}…` : nc.azione_attesa})</label>
          <div className="form-grid">
            <Field label="Nome e cognome di chi gestisce la NC *"><input value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} required /></Field>
            <Field label="Email *"><input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} required /></Field>
            <Field label="Telefono *"><input value={c.tel} onChange={(e) => setC({ ...c, tel: e.target.value })} required /></Field>
          </div>
        </>}
        <Field label="Allegati" help="Foto, moduli firmati, consensi (max 6 MB per file)">
          <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addFiles(e.target.files)} />
          {files.length > 0 && <div className="attach-list" style={{ marginTop: 6 }}>{files.map((x, i) => <span key={i}>{x.nome} · {fmtBytes(x.size)} <button className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button></span>)}</div>}
        </Field>
        <div className="row end"><button className="btn" disabled={busy || testo.trim().length < 2 || (sedeUser && (!c.nome.trim() || !c.email.trim() || !c.tel.trim()))} onClick={send}>{busy ? 'Invio…' : sedeUser ? 'Invia la risposta' : tipo === 'NOTA_INTERNA' ? 'Salva nota' : 'Invia alla sede'}</button></div>
      </div>
    </Card>
  );
}

function TrattamentoCard({ nc, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ trattamento_tipo: nc.trattamento_tipo || '', conservazione: nc.conservazione || '', trattamento_note: nc.trattamento_note || '' });
  const [edit, setEdit] = useState(!nc.trattamento_tipo);
  useEffect(() => { setF({ trattamento_tipo: nc.trattamento_tipo || '', conservazione: nc.conservazione || '', trattamento_note: nc.trattamento_note || '' }); setEdit(!nc.trattamento_tipo); }, [nc.id, nc.version, nc.trattamento_tipo, nc.conservazione, nc.trattamento_note]);
  const save = async () => { try { await api.post(`/nc/${nc.id}/trattamento`, { ...f, version: nc.version }); toast('Trattamento registrato'); reload(); } catch (e) { toast(e.message, 'err'); if (e.status === 409) reload(); } };
  const open = APERTE.includes(nc.stato);
  return (
    <Card title="2 · Trattamento immediato" actions={!edit && open && <button className="btn sm ghost" onClick={() => setEdit(true)}>Modifica</button>}>
      {!edit ? <div className="small">
        <div><b>{TRATT[nc.trattamento_tipo]}</b></div>
        {nc.conservazione && <div className="muted mt">Conservazione: {nc.conservazione}</div>}
        {nc.trattamento_note && <div className="mt" style={{ whiteSpace: 'pre-wrap' }}>{nc.trattamento_note}</div>}
      </div> : <div style={{ display: 'grid', gap: 10 }}>
        <Field label="Decisione sul campione"><select value={f.trattamento_tipo} onChange={(e) => setF({ ...f, trattamento_tipo: e.target.value })}><option value="">Scegli…</option>{Object.entries(TRATT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Conservazione" help="Dove e come è conservato il campione in attesa (es. 4 °C rack NC-A3 fino al 12/10)"><input value={f.conservazione} onChange={(e) => setF({ ...f, conservazione: e.target.value })} /></Field>
        <Field label="Note"><textarea value={f.trattamento_note} onChange={(e) => setF({ ...f, trattamento_note: e.target.value })} /></Field>
        <div className="row end">{nc.trattamento_tipo && <button className="btn sm ghost" onClick={() => setEdit(false)}>Annulla</button>}<button className="btn sm" disabled={!f.trattamento_tipo} onClick={save}>Salva</button></div>
      </div>}
    </Card>
  );
}

function RcaCard({ nc, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ rca_metodo: nc.rca_metodo || '5 perché', rca_categoria: nc.rca_categoria || '', rca_causa: nc.rca_causa || '' });
  const [edit, setEdit] = useState(false);
  useEffect(() => setF({ rca_metodo: nc.rca_metodo || '5 perché', rca_categoria: nc.rca_categoria || '', rca_causa: nc.rca_causa || '' }), [nc.id, nc.version, nc.rca_metodo, nc.rca_categoria, nc.rca_causa]);
  const save = async () => { try { await api.post(`/nc/${nc.id}/rca`, { ...f, version: nc.version }); toast('Causa radice registrata'); setEdit(false); reload(); } catch (e) { toast(e.message, 'err'); } };
  const show = edit || (!nc.rca_causa && nc.rca_richiesta);
  return (
    <Card title="3 · Analisi della causa radice" actions={<>{nc.rca_richiesta ? <Badge tone={nc.rca_causa ? 'green' : 'red'}>{nc.rca_causa ? 'eseguita' : 'obbligatoria'}</Badge> : <Badge tone="grey">facoltativa</Badge>}{!show && nc.stato !== 'VERIFICATA' && nc.stato !== 'ANNULLATA' && <button className="btn sm ghost" onClick={() => setEdit(true)}>{nc.rca_causa ? 'Modifica' : 'Aggiungi'}</button>}</>}>
      {!show ? (nc.rca_causa ? <div className="small"><div><Badge tone="blue">{RCA_CAT[nc.rca_categoria]}</Badge> <span className="muted">· {nc.rca_metodo}</span></div><div className="mt" style={{ whiteSpace: 'pre-wrap' }}>{nc.rca_causa}</div></div> : <div className="small muted">Non richiesta per le NC minori non ricorrenti. Aggiungila se la causa è evidente e utile per la statistica.</div>) : <div style={{ display: 'grid', gap: 10 }}>
        <div className="row">
          <Field label="Metodo"><select value={f.rca_metodo} onChange={(e) => setF({ ...f, rca_metodo: e.target.value })}><option>5 perché</option><option>Ishikawa</option><option>Analisi diretta</option><option>Altro</option></select></Field>
          <Field label="Categoria della causa"><select value={f.rca_categoria} onChange={(e) => setF({ ...f, rca_categoria: e.target.value })}><option value="">Scegli…</option>{Object.entries(RCA_CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <Field label="Causa radice" help="Perché è successo, non cosa è successo. Es. 'prelievo con ago 23G e aspirazione forzata da operatore neoassunto non ancora affiancato'."><textarea value={f.rca_causa} onChange={(e) => setF({ ...f, rca_causa: e.target.value })} /></Field>
        <div className="row end">{nc.rca_causa && <button className="btn sm ghost" onClick={() => setEdit(false)}>Annulla</button>}<button className="btn sm" disabled={!f.rca_categoria || f.rca_causa.trim().length < 10} onClick={save}>Salva</button></div>
      </div>}
    </Card>
  );
}

function AzioniCard({ nc, azioni, reload }) {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [f, setF] = useState({});
  const openNew = () => { setF({ tipo: 'CORRETTIVA', descrizione: '', responsabile: '', scadenza: '', stato: 'PIANIFICATA', note: '' }); setModal('new'); };
  const openEdit = (a) => { setF({ tipo: a.tipo, descrizione: a.descrizione, responsabile: a.responsabile || '', scadenza: a.scadenza || '', stato: a.stato, note: a.note || '' }); setModal(a); };
  const save = async () => { try { if (modal === 'new') await api.post(`/nc/${nc.id}/azioni`, { ...f, scadenza: f.scadenza || null }); else await api.put(`/nc/${nc.id}/azioni/${modal.id}`, { ...f, scadenza: f.scadenza || null }); setModal(null); toast('Azione salvata'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const quick = async (a, stato) => { try { await api.put(`/nc/${nc.id}/azioni/${a.id}`, { stato }); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="4 · Azioni correttive e preventive" flush actions={nc.stato !== 'ANNULLATA' && <button className="btn sm ghost" onClick={openNew}>Aggiungi</button>}>
      {!azioni.length ? <Empty>Nessuna azione. Per le NC minori può bastare il trattamento; per cause ripetute pianifica almeno un'azione preventiva (formazione, blocco software, istruzione operativa).</Empty> : (
        <table className="t"><tbody>{azioni.map((a) => (
          <tr key={a.id}>
            <td><div className="small"><Badge tone={a.tipo === 'CORRETTIVA' ? 'teal' : 'blue'}>{a.tipo === 'CORRETTIVA' ? 'Correttiva' : 'Preventiva'}</Badge></div><div className="mt" style={{ whiteSpace: 'pre-wrap' }}>{a.descrizione}</div><div className="small muted">{a.responsabile || 'responsabile non indicato'}{a.scadenza ? ` · entro ${itDate(a.scadenza)}` : ''}{a.completata_at ? ` · completata ${itDate(a.completata_at)}` : ''}</div></td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><Badge tone={AZ_STATO[a.stato].tone}>{AZ_STATO[a.stato].label}</Badge>
              <div className="row end" style={{ marginTop: 6, gap: 4 }}>{a.stato !== 'COMPLETATA' && a.stato !== 'ANNULLATA' && <button className="btn sm" onClick={() => quick(a, 'COMPLETATA')}>Completata</button>}<button className="btn sm ghost" onClick={() => openEdit(a)}>Modifica</button></div></td>
          </tr>
        ))}</tbody></table>
      )}
      {modal && <Modal title={modal === 'new' ? 'Nuova azione' : 'Modifica azione'} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" disabled={(f.descrizione || '').trim().length < 5} onClick={save}>Salva</button></>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="seg">{['CORRETTIVA', 'PREVENTIVA'].map((t) => <label key={t} className={f.tipo === t ? 'on' : ''}><input type="radio" checked={f.tipo === t} onChange={() => setF({ ...f, tipo: t })} />{t === 'CORRETTIVA' ? 'Correttiva (elimina la causa)' : 'Preventiva (evita che si ripeta altrove)'}</label>)}</div>
          <Field label="Descrizione"><textarea value={f.descrizione} onChange={(e) => setF({ ...f, descrizione: e.target.value })} placeholder="Es. affiancamento dell'operatore sulla tecnica di prelievo; blocco software sull'accettazione senza consenso HIV" /></Field>
          <div className="form-grid">
            <Field label="Responsabile"><input value={f.responsabile} onChange={(e) => setF({ ...f, responsabile: e.target.value })} /></Field>
            <Field label="Scadenza"><input type="date" value={f.scadenza} onChange={(e) => setF({ ...f, scadenza: e.target.value })} /></Field>
            <Field label="Stato"><select value={f.stato} onChange={(e) => setF({ ...f, stato: e.target.value })}>{Object.entries(AZ_STATO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          </div>
          <Field label="Note"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </Modal>}
    </Card>
  );
}

function ChiusuraCard({ nc, azioni, messaggi = [], reload, cfg }) {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [modal, setModal] = useState(null);   // 'chiudi' | 'verifica' | 'riapri' | 'annulla'
  const [f, setF] = useState({ esito: '', notifica_sede: true, sblocca_lis: true, allega_rapporto_lis: false, verifica_esito: 'EFFICACE', verifica_note: '' });
  const [err, setErr] = useState(null);
  const open = APERTE.includes(nc.stato);
  const canClose = open && nc.trattamento_tipo && (!nc.rca_richiesta || nc.rca_causa);
  const azioniAperte = azioni.filter((a) => !['COMPLETATA', 'ANNULLATA'].includes(a.stato)).length;
  const haRisposte = messaggi.some((m) => m.direzione === 'SEDE_LAB');
  const elimina = async () => {
    if (!window.confirm(`Eliminare definitivamente ${nc.codice}? Spariscono scheda, comunicazioni e allegati; il codice non viene riutilizzato. Se la sede ha già risposto l'operazione viene rifiutata.`)) return;
    try { await api.del(`/nc/${nc.id}`); toast('NC eliminata'); nav('/nc'); } catch (e) { toast(e.message, 'err'); }
  };
  const chiudi = async () => { setErr(null); try { const r = await api.post(`/nc/${nc.id}/chiudi`, { esito: f.esito, notifica_sede: f.notifica_sede, sblocca_lis: f.sblocca_lis, allega_rapporto_lis: f.allega_rapporto_lis, version: nc.version }); setModal(null); toast(`${nc.codice} chiusa${r.email ? ` · email ${r.email.stato.toLowerCase()}` : ''}`); reload(); } catch (e) { setErr(e); } };
  const verifica = async () => { setErr(null); try { await api.post(`/nc/${nc.id}/verifica`, { verifica_esito: f.verifica_esito, verifica_note: f.verifica_note, version: nc.version }); setModal(null); toast('Verifica registrata'); reload(); } catch (e) { setErr(e); } };
  return (
    <Card title="5 · Chiusura e verifica dell'efficacia">
      <div style={{ display: 'grid', gap: 10 }}>
        {nc.closed_at && <div className="small"><div className="muted">Chiusa da {nc.closed_by_name} il {itDateTime(nc.closed_at)}</div><div className="mt" style={{ whiteSpace: 'pre-wrap' }}>{nc.esito_chiusura}</div></div>}
        {nc.verifica_esito && <div className="small"><Badge tone={nc.verifica_esito === 'EFFICACE' ? 'green' : nc.verifica_esito === 'NON_EFFICACE' ? 'red' : 'grey'}>Verifica: {nc.verifica_esito.replace('_', ' ').toLowerCase()}</Badge> <span className="muted">{itDateTime(nc.verifica_at)}</span>{nc.verifica_note && <div className="mt">{nc.verifica_note}</div>}</div>}
        {open && <div className="small muted">
          {!nc.trattamento_tipo && <div>· Registra il trattamento (fase 2).</div>}
          {nc.rca_richiesta && !nc.rca_causa && <div>· Analisi della causa radice obbligatoria per questa NC.</div>}
          {canClose && <div>Pronta per la chiusura{azioniAperte ? ` (${azioniAperte} azioni CAPA resteranno aperte: la verifica di efficacia avverrà dopo il loro completamento)` : ''}.</div>}
        </div>}
        <div className="row">
          {open && <button className="btn" disabled={!canClose} onClick={() => setModal('chiudi')}>Chiudi la NC</button>}
          {nc.stato === 'CHIUSA' && isQualita(user) && <button className="btn" onClick={() => setModal('verifica')}>Registra verifica di efficacia</button>}
          {['CHIUSA', 'VERIFICATA'].includes(nc.stato) && <button className="btn ghost" onClick={() => setModal('riapri')}>Riapri</button>}
          {open && isQualita(user) && <button className="btn danger" onClick={() => setModal('annulla')}>Annulla NC</button>}
          {isLab(user) && ['APERTA', 'INVIATA_SEDE', 'ANNULLATA'].includes(nc.stato) && !haRisposte && <button className="btn danger ghost" title="Solo finché la sede non ha risposto: cancella la NC e il suo storico" onClick={elimina}>Elimina NC</button>}
        </div>
      </div>
      {modal === 'chiudi' && <Modal title={`Chiusura ${nc.codice}`} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" disabled={f.esito.trim().length < 5} onClick={chiudi}>Chiudi la non conformità</button></>}>
        <ErrorBox error={err} />
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label="Esito" help="Cosa è stato fatto sul caso clinico: nuovo campione processato, esame annullato, referto con nota, documento integrato."><textarea autoFocus value={f.esito} onChange={(e) => setF({ ...f, esito: e.target.value })} /></Field>
          <label className="f inline"><input type="checkbox" checked={f.notifica_sede} onChange={(e) => setF({ ...f, notifica_sede: e.target.checked })} /> Notifica la chiusura alla sede via email</label>
          <label className="f inline"><input type="checkbox" disabled={!cfg?.lisEnabled || !nc.blocco_lis} checked={f.sblocca_lis} onChange={(e) => setF({ ...f, sblocca_lis: e.target.checked })} /> Sblocca gli esami su StudioLAB {!nc.blocco_lis && <span className="small muted">(non erano stati bloccati sul LIS)</span>}</label>
          <label className="f inline"><input type="checkbox" disabled={!cfg?.lisEnabled} checked={f.allega_rapporto_lis} onChange={(e) => setF({ ...f, allega_rapporto_lis: e.target.checked })} /> Allega il rapporto NC in PDF all'accettazione su StudioLAB {!cfg?.lisEnabled && <span className="small muted">(LIS non collegato)</span>}</label>
        </div>
      </Modal>}
      {modal === 'verifica' && <Modal title="Verifica di efficacia" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" onClick={verifica}>Registra</button></>}>
        <ErrorBox error={err} />
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="small muted">La verifica attesta che le azioni intraprese hanno eliminato la causa: la stessa NC non si è più ripresentata dalla stessa sede nel periodo di osservazione. {azioniAperte ? <b className="red">Ci sono {azioniAperte} azioni ancora aperte.</b> : ''}</div>
          <div className="seg">{[['EFFICACE', 'Efficace'], ['NON_EFFICACE', 'Non efficace (riapre la NC)'], ['NON_APPLICABILE', 'Non applicabile']].map(([k, v]) => <label key={k} className={f.verifica_esito === k ? 'on' : ''}><input type="radio" checked={f.verifica_esito === k} onChange={() => setF({ ...f, verifica_esito: k })} />{v}</label>)}</div>
          <Field label="Note"><textarea value={f.verifica_note} onChange={(e) => setF({ ...f, verifica_note: e.target.value })} placeholder="Es. nessuna emolisi dalla stessa sede nei 60 giorni successivi all'affiancamento." /></Field>
        </div>
      </Modal>}
      {modal === 'riapri' && <PromptModal title="Riapri la non conformità" label="Motivo della riapertura" confirmText="Riapri" minLength={5} onClose={() => setModal(null)} onConfirm={async (motivo) => { await api.post(`/nc/${nc.id}/riapri`, { motivo, version: nc.version }); toast('NC riaperta'); reload(); }} />}
      {modal === 'annulla' && <PromptModal danger title="Annulla la non conformità" label="Motivo (es. aperta per errore, duplicato)" confirmText="Annulla NC" minLength={5} onClose={() => setModal(null)} onConfirm={async (motivo) => { await api.post(`/nc/${nc.id}/annulla`, { motivo }); toast('NC annullata'); nav('/nc'); }} />}
    </Card>
  );
}

function EditRilevazione({ nc, onClose, reload }) {
  const toast = useToast();
  const { data: tipi } = useApi('/tipi');
  const [f, setF] = useState({ tipo_id: nc.tipo_id, tipo_altro: nc.tipo_altro || '', gravita: nc.gravita, descrizione: nc.descrizione, azione_attesa: nc.azione_attesa, campione_bloccato: nc.campione_bloccato, rca_richiesta: nc.rca_richiesta });
  const [err, setErr] = useState(null);
  const save = async () => { setErr(null); try { await api.patch(`/nc/${nc.id}`, { ...f, version: nc.version }); toast('Aggiornata'); onClose(); reload(); } catch (e) { setErr(e); } };
  return (
    <Modal title={`Modifica rilevazione ${nc.codice}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <ErrorBox error={err} />
      <div style={{ display: 'grid', gap: 10 }}>
        <Field label="Tipologia"><select value={f.tipo_id || ''} onChange={(e) => setF({ ...f, tipo_id: Number(e.target.value) || null })}><option value="">–</option>{(tipi || []).filter((t) => t.macro === nc.macro).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Specifica"><input value={f.tipo_altro} onChange={(e) => setF({ ...f, tipo_altro: e.target.value })} /></Field>
        <Field label="Gravità" help={GRAVITA_HELP[f.gravita]}><div className="seg">{Object.entries(GRAVITA).map(([k, v]) => <label key={k} className={f.gravita === k ? 'on' : ''}><input type="radio" checked={f.gravita === k} onChange={() => setF({ ...f, gravita: k, rca_richiesta: k !== 'MINORE' ? true : f.rca_richiesta })} />{v}</label>)}</div></Field>
        <Field label="Descrizione"><textarea value={f.descrizione} onChange={(e) => setF({ ...f, descrizione: e.target.value })} /></Field>
        <Field label="Azione attesa"><textarea value={f.azione_attesa} onChange={(e) => setF({ ...f, azione_attesa: e.target.value })} /></Field>
        <label className="f inline"><input type="checkbox" checked={f.campione_bloccato} onChange={(e) => setF({ ...f, campione_bloccato: e.target.checked })} /> Campione bloccato fisicamente</label>
        <label className="f inline"><input type="checkbox" checked={f.rca_richiesta} onChange={(e) => setF({ ...f, rca_richiesta: e.target.checked })} /> Analisi della causa radice richiesta</label>
      </div>
    </Modal>
  );
}

export default function NcDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const live = useContext(LiveCtx);
  const toast = useToast();
  const { data, error, reload } = useApi(`/nc/${id}`, [live.tick]);
  const { data: cfg } = useApi('/auth/config');
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <div className="page"><ErrorBox error={error} /><Link to="/nc">Torna all'elenco</Link></div>;
  if (!data) return <Loading />;
  const { nc, messaggi, allegati, azioni, email, storico, sede } = data;
  const sedeUser = isSede(user);
  const lab = isLab(user);
  const S = sedeUser ? STATO_SEDE : STATO;
  const ph = phaseIndex(nc, azioni);
  const open = APERTE.includes(nc.stato);
  const resend = async () => { setBusy(true); try { const r = await api.post(`/nc/${nc.id}/invia`); toast(`Email ${r.email.stato.toLowerCase()} a ${r.email.destinatari}`); reload(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}><h1 className="mono">{nc.codice}</h1><Badge tone={S[nc.stato].tone}>{S[nc.stato].label}</Badge><span className={`badge ${nc.gravita === 'CRITICA' ? 'b-red' : nc.gravita === 'MAGGIORE' ? 'b-yellow' : 'b-grey'}`}>{GRAVITA[nc.gravita]}</span>{nc.ricorrente && <Badge tone="red">ricorrente</Badge>}{nc.sla_escalated_at && open && <Badge tone="red">escalation</Badge>}</div>
          <div className="sub">{MACRO[nc.macro]?.label} · <b>{nc.tipo_label || nc.tipo_altro}</b>{nc.tipo_label && nc.tipo_altro ? ` · ${nc.tipo_altro}` : ''} · aperta il {itDateTime(nc.opened_at)} da {nc.opened_by_name || '–'}</div>
        </div>
        <div className="row">
          <a className="btn ghost" href={`/api/nc/${nc.id}/rapporto.pdf`} target="_blank" rel="noreferrer"><Icon name="print" /> Rapporto PDF</a>
          {lab && open && <button className="btn ghost" disabled={busy} onClick={resend}><Icon name="mail" /> {nc.sent_at ? 'Reinvia email' : 'Invia alla sede'}</button>}
          {lab && open && <button className="btn ghost" onClick={() => setEdit(true)}>Modifica</button>}
        </div>
      </div>

      {!sedeUser && <div className="phases">{PHASES.map((l, i) => <div key={l} className={`ph ${ph > i ? 'done' : ph === i ? 'now' : ''}`}><i>{ph > i ? '✓' : i + 1}</i>{l}</div>)}</div>}
      {sedeUser && nc.stato === 'INVIATA_SEDE' && <div className="alert warn" style={{ marginBottom: 16 }}><Icon name="clock" /> <div>Il laboratorio attende una vostra risposta entro <b>{itDateTime(nc.sla_due_at)}</b>. Il campione è bloccato: gli esami coinvolti non vengono refertati fino alla risoluzione.</div></div>}
      {!sedeUser && nc.stato === 'INVIATA_SEDE' && <div className={`alert ${slaClass(nc) === 'sla-late' ? 'err' : 'info'}`} style={{ marginBottom: 16 }}><Icon name="clock" /> <div>In attesa della sede · scadenza <b>{itDateTime(nc.sla_due_at)}</b>{nc.sla_reminder_at ? ` · sollecito inviato ${itDateTime(nc.sla_reminder_at)}` : ''}{nc.sla_escalated_at ? ` · escalation ${itDateTime(nc.sla_escalated_at)}: contattare telefonicamente la sede (${sede.telefono || 'telefono non censito'})` : ''}</div></div>}
      {!sedeUser && nc.stato === 'RISPOSTA_SEDE' && <div className="alert ok" style={{ marginBottom: 16 }}><Icon name="reply" /> <div>La sede ha risposto. Leggi la risposta, poi: nuova richiesta alla sede, oppure registra il trattamento e chiudi.</div></div>}

      <div className="grid g3">
        <div className="span2" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card title="1 · Rilevazione">
            <div className="grid g2">
              <div>
                <div className="small muted">Accettazione</div><div className="strong mono">{lab ? <Link to={`/desk/${encodeURIComponent(nc.accettazione_id)}`}>{nc.accettazione_id}</Link> : nc.accettazione_id} <span className="muted small">· {data.lisStatoLabel || STATO_LIS[nc.stato_lis] || 'stato LIS non noto'} · {itDateTime(nc.data_accettazione)}</span></div>
                <div className="small muted mt">Paziente</div><div>{[nc.paziente_cognome, nc.paziente_nome].filter(Boolean).join(' ') || '–'}{nc.paziente_nascita ? <span className="muted small"> · {itDate(nc.paziente_nascita)}</span> : ''}</div>
                <div className="small muted mt">Esami coinvolti</div><div className="esami" style={{ marginTop: 4 }}>{(nc.esami_coinvolti || []).length ? nc.esami_coinvolti.map((e) => <label key={e.cod} className="on"><b>{e.cod}</b> {e.descrizione}</label>) : <span className="small">tutta l'accettazione</span>}</div>
              </div>
              <div>
                <div className="small muted">Sede inviante</div><div className="strong">{sede.nome} <span className="muted small">({sede.codice})</span></div>
                <div className="small muted">{sede.email || <span className="red">email NC non impostata</span>}{sede.telefono ? ` · ${sede.telefono}` : ''}{sede.referente ? ` · ${sede.referente}` : ''}</div>
                <div className="small muted mt">Blocco</div><div className="small">{nc.campione_bloccato ? 'Campione bloccato sul desk' : 'Campione non bloccato'}{nc.blocco_lis ? ' · esami bloccati su StudioLAB' : nc.blocco_lis_esito ? ` · LIS: ${nc.blocco_lis_esito}` : ''}</div>
                {(nc.lis_segnalazione_id || nc.lis_segnalazione_esito) && <><div className="small muted mt">Segnalazione StudioLAB</div><div className="small">{nc.lis_segnalazione_id ? `n. ${nc.lis_segnalazione_id} · ${nc.lis_segnalazione_esito || ''}` : nc.lis_segnalazione_esito}</div></>}
                {nc.sent_at && <><div className="small muted mt">Inviata alla sede</div><div className="small">{itDateTime(nc.sent_at)}{nc.first_response_at ? ` · prima risposta ${itDateTime(nc.first_response_at)}` : ''}</div></>}
              </div>
            </div>
            <div className="small muted mt">Descrizione</div><div style={{ whiteSpace: 'pre-wrap' }}>{nc.descrizione}</div>
            <div className="small muted mt">Azione attesa dalla sede</div><div style={{ whiteSpace: 'pre-wrap' }}><b>{nc.azione_attesa}</b></div>
            {allegati.filter((a) => !a.messaggio_id).length > 0 && <div className="msg att mt" style={{ border: 0, padding: 0 }}>{allegati.filter((a) => !a.messaggio_id).map((a) => <Attach key={a.id} ncId={nc.id} a={a} />)}</div>}
          </Card>

          <Card title={`Comunicazioni (${messaggi.length})`}>
            <div className="thread">{messaggi.map((m) => (
              <div key={m.id} className={`msg ${m.tipo}`}>
                <div className="who"><b>{MSG_TIPO[m.tipo]}</b> · {m.direzione === 'SEDE_LAB' ? (m.contatto_nome || m.user_name) : (m.user_name || 'sistema')}{m.direzione === 'SEDE_LAB' && m.contatto_email ? ` · ${m.contatto_email} · ${m.contatto_tel}` : ''} · {itDateTime(m.created_at)}{m.azione_eseguita && <Badge tone="green">azione eseguita</Badge>}</div>
                <div className="body">{m.testo}</div>
                {m.allegati?.length > 0 && <div className="att">{m.allegati.map((a) => <Attach key={a.id} ncId={nc.id} a={a} />)}</div>}
              </div>
            ))}</div>
          </Card>
          {(lab || sedeUser) && <MessageForm nc={nc} sede={sede} onSent={() => { reload(); live.refreshCounts(); }} />}
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          {sedeUser ? <>
            <Card title="Cosa fare">
              <div className="small" style={{ display: 'grid', gap: 8 }}>
                <div>1. Leggete la descrizione e l'azione attesa.</div>
                <div>2. Eseguite l'azione (nuovo prelievo, invio del documento, correzione dell'accettazione) oppure chiedete un chiarimento.</div>
                <div>3. Rispondete qui indicando nome, email e telefono di chi ha gestito la pratica: il laboratorio riceve subito la notifica.</div>
                {nc.sla_due_at && open && <div className={slaClass(nc)}>Risposta attesa entro {itDateTime(nc.sla_due_at)}</div>}
              </div>
            </Card>
            {nc.closed_at && <Card title="Esito"><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{nc.esito_chiusura}</div><div className="small muted mt">Chiusa il {itDateTime(nc.closed_at)}</div></Card>}
          </> : <>
            <TrattamentoCard nc={nc} reload={reload} />
            <RcaCard nc={nc} reload={reload} />
            <AzioniCard nc={nc} azioni={azioni} reload={reload} />
            <ChiusuraCard nc={nc} azioni={azioni} messaggi={messaggi} reload={reload} cfg={cfg} />
            <Card title={`Email (${email.length})`} flush>
              {!email.length ? <Empty>Nessuna email</Empty> : <table className="t"><tbody>{email.map((e) => <tr key={e.id}><td className="small"><div><b>{e.tipo.replace('NC_', '')}</b> · {itDateTime(e.created_at)}</div><div className="muted">{e.destinatari}</div>{e.errore && <div className="red">{e.errore}</div>}</td><td style={{ textAlign: 'right' }}><Badge tone={e.stato === 'INVIATA' ? 'green' : e.stato === 'ERRORE' ? 'red' : e.stato === 'SIMULATA' ? 'mauve' : 'grey'}>{e.stato.toLowerCase()}</Badge></td></tr>)}</tbody></table>}
            </Card>
            <Card title="Storico" flush>
              <table className="t"><tbody>{storico.slice(0, 12).map((s) => <tr key={s.id}><td className="small"><div>{s.label}</div><div className="muted">{s.full_name || 'sistema'} · {itDateTime(s.at)}</div></td></tr>)}</tbody></table>
            </Card>
          </>}
        </div>
      </div>
      {edit && <EditRilevazione nc={nc} onClose={() => setEdit(false)} reload={reload} />}
    </div>
  );
}
