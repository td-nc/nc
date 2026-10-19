import React, { useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Loading, Badge, Modal, ErrorBox, useToast } from '../components/ui.jsx';
import { MACRO, GRAVITA } from '../format.js';

const EMPTY = { macro: 'FISICA', codice: '', label: '', descrizione: '', gravita_default: 'MINORE', azione_attesa: '', richiede_nuovo_campione: false, lis_tipo: '', posizione: 50, attivo: true };

export default function Tipi() {
  const toast = useToast();
  const { data, reload } = useApi('/tipi?tutti=1');
  const [modal, setModal] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState(null);
  const openNew = (macro) => { setF({ ...EMPTY, macro }); setErr(null); setModal('new'); };
  const openEdit = (t) => { setF({ ...EMPTY, ...Object.fromEntries(Object.entries(t).filter(([k]) => k in EMPTY).map(([k, v]) => [k, v ?? ''])) }); setErr(null); setModal(t); };
  const save = async () => {
    setErr(null);
    try {
      const body = { ...f, lis_tipo: f.lis_tipo === '' ? null : Number(f.lis_tipo), posizione: Number(f.posizione) || 50, codice: f.codice.toUpperCase() };
      if (modal === 'new') await api.post('/tipi', body); else await api.put(`/tipi/${modal.id}`, body);
      setModal(null); toast('Tipologia salvata'); reload();
    } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Catalogo tipologie</h1><div className="sub">Le tipologie proposte alla preanalitica, con gravità di default e testo dell'azione attesa. Modificare qui significa cambiare il linguaggio con cui il laboratorio parla alle sedi: tienilo coerente con il vademecum e la modulistica.</div></div></div>
      {!data ? <Loading /> : Object.keys(MACRO).map((m) => (
        <Card key={m} title={MACRO[m].label} className="mt" style={{ marginBottom: 16 }} flush actions={<button className="btn sm ghost" onClick={() => openNew(m)}>Aggiungi</button>}>
          <table className="t"><thead><tr><th>Tipologia</th><th>Gravità</th><th>Azione attesa proposta</th><th className="num">NC</th><th></th></tr></thead>
            <tbody>{data.filter((t) => t.macro === m).map((t) => (
              <tr key={t.id} style={{ opacity: t.attivo ? 1 : .5 }}>
                <td><div className="strong">{t.label} <span className="muted small mono">{t.codice}</span>{!t.attivo && <Badge tone="grey">disattivata</Badge>}{t.richiede_nuovo_campione && <Badge tone="blue">nuovo campione</Badge>}</div><div className="small muted">{t.descrizione}</div></td>
                <td className={`small grav-${t.gravita_default}`}>{GRAVITA[t.gravita_default]}</td>
                <td className="small" style={{ maxWidth: 420 }}>{t.azione_attesa || <span className="muted">–</span>}</td>
                <td className="num small">{t.n_nc}</td>
                <td><button className="btn sm ghost" onClick={() => openEdit(t)}>Modifica</button></td>
              </tr>
            ))}</tbody></table>
        </Card>
      ))}
      {modal && <Modal title={modal === 'new' ? 'Nuova tipologia' : `Modifica ${modal.label}`} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" disabled={f.codice.trim().length < 2 || f.label.trim().length < 2} onClick={save}>Salva</button></>}>
        <ErrorBox error={err} />
        <div className="form-grid">
          <Field label="Macro-area"><select value={f.macro} disabled={modal !== 'new'} onChange={(e) => setF({ ...f, macro: e.target.value })}>{Object.entries(MACRO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="Codice" help="Maiuscole, numeri e _"><input value={f.codice} disabled={modal !== 'new'} onChange={(e) => setF({ ...f, codice: e.target.value.toUpperCase() })} /></Field>
          <Field label="Nome" className="span2"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Gravità di default"><select value={f.gravita_default} onChange={(e) => setF({ ...f, gravita_default: e.target.value })}>{Object.entries(GRAVITA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Ordine"><input type="number" value={f.posizione} onChange={(e) => setF({ ...f, posizione: e.target.value })} /></Field>
          <Field label="TipoNonConformita StudioLAB" help="Codice numerico del LIS, se mappato"><input type="number" value={f.lis_tipo} onChange={(e) => setF({ ...f, lis_tipo: e.target.value })} /></Field>
          <Field label="Stato"><select value={f.attivo ? '1' : '0'} onChange={(e) => setF({ ...f, attivo: e.target.value === '1' })}><option value="1">Attiva</option><option value="0">Disattivata</option></select></Field>
        </div>
        <Field label="Descrizione (aiuto per l'operatore)" className="mt"><textarea value={f.descrizione} onChange={(e) => setF({ ...f, descrizione: e.target.value })} /></Field>
        <Field label="Azione attesa proposta (testo che legge la sede)" className="mt"><textarea value={f.azione_attesa} onChange={(e) => setF({ ...f, azione_attesa: e.target.value })} /></Field>
        <label className="f inline mt"><input type="checkbox" checked={f.richiede_nuovo_campione} onChange={(e) => setF({ ...f, richiede_nuovo_campione: e.target.checked })} /> Di norma richiede un nuovo campione</label>
      </Modal>}
    </div>
  );
}
