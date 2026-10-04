import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isQualita } from '../auth.jsx';
import { useApi, Card, Field, Loading, Empty, Badge, Modal, ErrorBox, useToast } from '../components/ui.jsx';
import { SEDE_TIPO, itDateTime } from '../format.js';

const EMPTY = { codice: '', nome: '', tipo: 'PUNTO_PRELIEVO', email_nc_override: '', email_cc: '', telefono: '', referente: '', indirizzo: '', citta: '', sla_ore: '', attiva: true, note: '' };

export default function Sedi() {
  const { user } = useAuth();
  const toast = useToast();
  const [tutte, setTutte] = useState(false);
  const { data, reload } = useApi(`/sedi${tutte ? '?tutte=1' : ''}`);
  const [modal, setModal] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const q2 = isQualita(user);
  const openNew = () => { setF(EMPTY); setErr(null); setModal('new'); };
  const openEdit = (s) => { setF({ ...EMPTY, ...Object.fromEntries(Object.entries(s).filter(([k]) => k in EMPTY).map(([k, v]) => [k, v ?? ''])) }); setErr(null); setModal(s); };
  const save = async () => {
    setErr(null);
    try {
      const body = { ...f, sla_ore: f.sla_ore === '' ? null : Number(f.sla_ore) };
      if (modal === 'new') await api.post('/sedi', body); else await api.put(`/sedi/${modal.id}`, body);
      setModal(null); toast('Sede salvata'); reload();
    } catch (e) { setErr(e); }
  };
  const rows = (data || []).filter((s) => !q || `${s.nome} ${s.codice} ${s.citta || ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi invianti</h1><div className="sub">Punti prelievo e centri medici Toscana Diagnostica, laboratori e strutture in Service. Il codice coincide con il CodiceCliente di StudioLAB; l'email NC arriva dal LIS (EmailNonConformita) e qui può essere sovrascritta.</div></div>
        {q2 && <button className="btn" onClick={openNew}>Nuova sede</button>}
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome, codice, città" /></Field>
        <label className="f inline"><input type="checkbox" checked={tutte} onChange={(e) => setTutte(e.target.checked)} /> mostra anche le sedi disattivate</label>
      </div>
      <Card flush>
        {!data ? <Loading /> : !rows.length ? <Empty>Nessuna sede</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Sede</th><th>Tipo</th><th>Email NC</th><th>Telefono / referente</th><th className="num">SLA</th><th className="num">NC aperte</th><th className="num">NC 90 gg</th><th className="num">Utenti</th><th></th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td><div className="strong">{s.nome}</div><div className="small muted mono">{s.codice}{s.citta ? ` · ${s.citta}` : ''}{!s.attiva && <Badge tone="grey">disattivata</Badge>}</div></td>
                <td className="small">{SEDE_TIPO[s.tipo]}</td>
                <td className="small">{s.email_effettiva ? <span>{s.email_effettiva}{s.email_nc_override && <span className="muted"> (override)</span>}</span> : <span className="red">mancante</span>}{s.lis_synced_at && <div className="muted">LIS {itDateTime(s.lis_synced_at)}</div>}</td>
                <td className="small">{s.telefono || '–'}{s.referente ? <div className="muted">{s.referente}</div> : null}</td>
                <td className="num small">{s.sla_ore ? `${s.sla_ore} h` : <span className="muted">default</span>}</td>
                <td className="num">{s.nc_aperte > 0 ? <Badge tone="yellow">{s.nc_aperte}</Badge> : <span className="muted">0</span>}</td>
                <td className="num">{s.nc_90gg}</td>
                <td className="num small">{s.n_utenti}</td>
                <td><div className="row end" style={{ gap: 6 }}><Link className="btn sm ghost" to={`/nc?sede=${s.id}`}>NC</Link>{q2 && <button className="btn sm ghost" onClick={() => openEdit(s)}>Modifica</button>}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {modal && <Modal title={modal === 'new' ? 'Nuova sede inviante' : `Modifica ${modal.nome}`} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" disabled={!f.codice.trim() || f.nome.trim().length < 2} onClick={save}>Salva</button></>}>
        <ErrorBox error={err} />
        <div className="form-grid">
          <Field label="Codice (CodiceCliente StudioLAB)"><input value={f.codice} onChange={(e) => setF({ ...f, codice: e.target.value })} disabled={modal !== 'new' && Boolean(modal.lis_synced_at)} /></Field>
          <Field label="Tipo"><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{Object.entries(SEDE_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Nome" className="span2"><input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
          <Field label="Email NC (override)" help={modal !== 'new' && modal.email_nc ? `Dal LIS: ${modal.email_nc}` : 'Se vuota si usa quella del LIS'}><input value={f.email_nc_override} onChange={(e) => setF({ ...f, email_nc_override: e.target.value })} placeholder="qualita@sede.it" /></Field>
          <Field label="In copia (CC)" help="Più indirizzi separati da virgola"><input value={f.email_cc} onChange={(e) => setF({ ...f, email_cc: e.target.value })} /></Field>
          <Field label="Telefono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></Field>
          <Field label="Referente"><input value={f.referente} onChange={(e) => setF({ ...f, referente: e.target.value })} /></Field>
          <Field label="Indirizzo"><input value={f.indirizzo} onChange={(e) => setF({ ...f, indirizzo: e.target.value })} /></Field>
          <Field label="Città"><input value={f.citta} onChange={(e) => setF({ ...f, citta: e.target.value })} /></Field>
          <Field label="SLA risposta (ore lavorative)" help="Vuoto = valore globale delle impostazioni"><input type="number" min="1" max="240" value={f.sla_ore} onChange={(e) => setF({ ...f, sla_ore: e.target.value })} /></Field>
          <Field label="Stato"><select value={f.attiva ? '1' : '0'} onChange={(e) => setF({ ...f, attiva: e.target.value === '1' })}><option value="1">Attiva</option><option value="0">Disattivata</option></select></Field>
        </div>
        <Field label="Note" className="mt"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}
