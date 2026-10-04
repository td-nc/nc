import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Loading, Empty, Field } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { qs } from '../api.js';

const ACTION = {
  NC_CREATED: 'NC aperta', NC_SENT: 'NC inviata alla sede', NC_UPDATED: 'NC modificata', NC_SEDE_REPLIED: 'Risposta della sede', NC_MESSAGE: 'Comunicazione alla sede', NC_NOTE: 'Nota interna',
  NC_TREATMENT: 'Trattamento', NC_RCA: 'Causa radice', NC_ACTION_CREATED: 'Azione CAPA aggiunta', NC_ACTION_UPDATED: 'Azione CAPA modificata', NC_ACTION_DELETED: 'Azione CAPA eliminata',
  NC_CLOSED: 'NC chiusa', NC_VERIFIED: 'Verifica efficacia', NC_REOPENED: 'NC riaperta', NC_CANCELLED: 'NC annullata', NC_ATTACHMENT: 'Allegato', NC_ATTACHMENT_DELETED: 'Allegato eliminato', NC_EXPORTED: 'Export',
  ACC_CREATED: 'Accettazione registrata', ACC_UPDATED: 'Accettazione aggiornata', SEDE_CREATED: 'Sede creata', SEDE_UPDATED: 'Sede modificata', TIPO_CREATED: 'Tipologia creata', TIPO_UPDATED: 'Tipologia modificata', SETTINGS_UPDATED: 'Impostazioni', SCHEDULER_RUN: 'Scheduler manuale',
  LOGIN: 'Accesso', LOGOUT: 'Uscita', LOGIN_FAILED: 'Accesso fallito', USER_CREATED: 'Utente creato', USER_UPDATED: 'Utente modificato', USER_SELF_REGISTERED: 'Primo accesso Microsoft', USER_PASSWORD_RESET: 'Reset password', PASSWORD_CHANGED: 'Password cambiata',
};

export default function Audit() {
  const [action, setAction] = useState('');
  const { data } = useApi(`/audit${qs({ action, limit: 500 })}`);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Registro attività</h1><div className="sub">Chi ha fatto cosa e quando: ogni passaggio delle non conformità, gli accessi, le modifiche ad anagrafiche e impostazioni. È l'evidenza per audit ISO 15189 / 9001.</div></div></div>
      <div className="filters"><Field label="Azione"><select value={action} onChange={(e) => setAction(e.target.value)}><option value="">Tutte</option>{Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
      <div className="card">
        {!data ? <Loading /> : !data.length ? <Empty>Nessuna attività</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Quando</th><th>Utente</th><th>Azione</th><th>Dettaglio</th></tr></thead>
            <tbody>{data.map((a) => <tr key={a.id}>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>{itDateTime(a.at)}</td>
              <td>{a.full_name || <span className="muted">sistema</span>}<div className="small muted">{a.email}</div></td>
              <td className="small"><span className="badge b-grey">{ACTION[a.action] || a.action}</span></td>
              <td className="small">{a.nc_id ? <Link to={`/nc/${a.nc_id}`}>{a.label}</Link> : (a.label || `${a.entity || ''} ${a.entity_id || ''}`)}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
