import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import { useApi, Loading, Empty, Field, Modal, ErrorBox, Badge, useToast } from '../components/ui.jsx';
import { ROLE, USTATUS, AUTH, itDateTime } from '../format.js';

const ROLE_HELP = {
  ADMIN: 'Tutto: utenti interni, impostazioni, LIS, email. Accede solo con Microsoft 365.',
  QUALITA: 'Responsabile qualità: RCA, CAPA, verifica di efficacia, catalogo, sedi, accessi delle sedi, registro attività.',
  LAB: 'Preanalitica e laboratorio: rileva, tratta, dialoga con la sede, chiude.',
  SEDE: 'Punto prelievo, centro medico o cliente Service: vede e risponde solo alle NC delle sedi associate.',
  VIEWER: 'Sola lettura interna (direzione, auditor).',
};

function TempPassword({ value, email }) {
  return <div className="alert warn"><div>Credenziali da consegnare alla sede (la password è mostrata una sola volta):<br />utente <b>{email}</b> · password temporanea <b className="mono" style={{ fontSize: 15 }}>{value}</b><br />Al primo accesso l'utente dovrà scegliere una password personale.</div></div>;
}

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const admin = isAdmin(me);
  const { data, reload } = useApi('/users');
  const { data: sedi } = useApi('/sedi?tutte=1');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState(null);
  const [temp, setTemp] = useState(null);
  const [filtro, setFiltro] = useState('');

  const openNew = () => { setForm({ email: '', full_name: '', role: 'SEDE', organization: '', telefono: '', auth_provider: 'LOCAL', sedi: [] }); setErr(null); setTemp(null); setModal('new'); };
  const openEdit = (u) => { setForm({ full_name: u.full_name, role: u.role, status: u.status, organization: u.organization || '', telefono: u.telefono || '', notify_email: u.notify_email, sedi: (u.sedi || []).map((s) => s.id) }); setErr(null); setTemp(null); setModal(u); };
  const save = async () => {
    setErr(null);
    try {
      if (modal === 'new') { const r = await api.post('/users', form); if (r.tempPassword) setTemp({ pwd: r.tempPassword, email: r.email }); else setModal(null); toast('Utente creato'); }
      else { await api.put(`/users/${modal.id}`, form); setModal(null); toast('Utente aggiornato'); }
      reload();
    } catch (e) { setErr(e); }
  };
  const quick = async (u, patch, msg) => { try { await api.put(`/users/${u.id}`, patch); toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  const reset = async (u) => { try { const r = await api.post(`/users/${u.id}/reset-password`); setForm({}); setTemp({ pwd: r.tempPassword, email: u.email }); setModal(u); } catch (e) { toast(e.message, 'err'); } };
  const toggleSede = (id) => setForm((f) => ({ ...f, sedi: f.sedi.includes(id) ? f.sedi.filter((x) => x !== id) : [...f.sedi, id] }));

  const rows = (data || []).filter((u) => !filtro || `${u.full_name} ${u.email} ${u.organization || ''}`.toLowerCase().includes(filtro.toLowerCase()));
  const pending = (data || []).filter((u) => u.status === 'PENDING');
  const canEditUser = (u) => admin || u.role === 'SEDE';
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Utenti e accessi</h1><div className="sub">Il personale Toscana Diagnostica entra con Microsoft 365 (abilitato in automatico come Laboratorio). Le sedi e i clienti Service ricevono credenziali create qui, vincolate alle loro sedi.</div></div>
        <button className="btn" onClick={openNew}>Nuovo utente</button>
      </div>
      {pending.length > 0 && <div className="alert info" style={{ marginBottom: 14 }}>{pending.length} account in attesa di abilitazione.</div>}
      <div className="filters"><Field label="Cerca"><input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="nome, email, organizzazione" /></Field></div>
      <div className="card">
        {!data ? <Loading /> : !rows.length ? <Empty>Nessun utente</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Utente</th><th>Organizzazione / sedi</th><th>Profilo</th><th>Stato</th><th>Accesso</th><th>Ultimo accesso</th><th></th></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id}>
                <td><div className="strong">{u.full_name}</div><div className="small muted">{u.email}{u.telefono ? ` · ${u.telefono}` : ''}</div></td>
                <td className="small">{u.organization || '–'}{u.role === 'SEDE' && <div className="muted">{(u.sedi || []).map((s) => s.nome).join(', ') || <span className="red">nessuna sede</span>}</div>}</td>
                <td><Badge tone={u.role === 'ADMIN' ? 'teal' : u.role === 'QUALITA' ? 'blue' : u.role === 'LAB' ? 'mauve' : 'grey'}>{ROLE[u.role]}</Badge></td>
                <td><Badge tone={USTATUS[u.status].tone}>{USTATUS[u.status].label}</Badge></td>
                <td className="small">{AUTH[u.auth_provider]}</td>
                <td className="small muted">{itDateTime(u.last_login_at) || 'mai'}</td>
                <td><div className="row end" style={{ gap: 6 }}>
                  {u.status === 'PENDING' && admin && <button className="btn sm" onClick={() => quick(u, { status: 'ACTIVE', role: 'LAB' }, 'Abilitato come laboratorio')}>Abilita</button>}
                  {canEditUser(u) && <button className="btn sm ghost" onClick={() => openEdit(u)}>Modifica</button>}
                  {canEditUser(u) && u.auth_provider !== 'ENTRA' && <button className="btn sm ghost" onClick={() => reset(u)}>Reset password</button>}
                  {canEditUser(u) && u.id !== me.id && u.status !== 'DISABLED' && <button className="btn sm danger" onClick={() => quick(u, { status: 'DISABLED' }, 'Utente disabilitato')}>Disabilita</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      {modal && <Modal title={modal === 'new' ? 'Nuovo utente' : `Modifica ${modal.email}`} onClose={() => setModal(null)}
        footer={temp ? <button className="btn" onClick={() => setModal(null)}>Chiudi</button> : <><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
        <ErrorBox error={err} />
        {temp ? <TempPassword value={temp.pwd} email={temp.email} /> : <div style={{ display: 'grid', gap: 12 }}>
          {modal === 'new' && <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>}
          <Field label="Nome e cognome"><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <div className="form-grid">
            <Field label="Organizzazione"><input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} placeholder="es. Punto Prelievo Novoli" /></Field>
            <Field label="Telefono"><input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></Field>
          </div>
          <Field label="Profilo" help={ROLE_HELP[form.role]}>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, auth_provider: e.target.value === 'SEDE' ? 'LOCAL' : form.auth_provider })} disabled={!admin}>{Object.entries(ROLE).filter(([k]) => admin || k === 'SEDE').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          {form.role === 'SEDE' && <Field label="Sedi associate" help="L'utente vede solo le NC di queste sedi">
            <div className="esami">{(sedi || []).filter((s) => s.attiva || form.sedi.includes(s.id)).map((s) => <label key={s.id} className={form.sedi.includes(s.id) ? 'on' : ''}><input type="checkbox" style={{ display: 'none' }} checked={form.sedi.includes(s.id)} onChange={() => toggleSede(s.id)} />{s.nome}</label>)}</div>
          </Field>}
          {modal === 'new' ? (
            <Field label="Metodo di accesso" help="Le sedi usano email e password fornite dal laboratorio. Il personale TD usa Microsoft 365.">
              <select value={form.auth_provider} onChange={(e) => setForm({ ...form, auth_provider: e.target.value })}><option value="LOCAL">Email e password</option><option value="ENTRA">Microsoft 365</option><option value="BOTH">Microsoft 365 o password</option></select>
            </Field>
          ) : (<>
            <Field label="Stato"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{Object.entries(USTATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <label className="f inline"><input type="checkbox" checked={form.notify_email !== false} onChange={(e) => setForm({ ...form, notify_email: e.target.checked })} /> Riceve le notifiche email</label>
          </>)}
        </div>}
      </Modal>}
    </div>
  );
}
