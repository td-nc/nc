import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import { useApi, Card, Field, Loading, Empty, Badge, ErrorBox, useToast } from '../components/ui.jsx';
import { itDateTime } from '../format.js';

const LABEL = {
  sla_ore_default: ['SLA risposta sede (ore lavorative)', 'Tempo entro cui la sede deve rispondere. Le sedi possono avere un valore proprio.'],
  sla_sollecito_ore: ['Sollecito dopo la scadenza (ore lavorative)', '0 = alla scadenza esatta dello SLA'],
  sla_escalation_ore: ['Escalation al laboratorio dopo (ore lavorative dalla scadenza)', 'Email interna e segnalazione sulla NC: la sede va contattata telefonicamente'],
  ricorrenza_soglia: ['Soglia di ricorrenza', 'NC della stessa tipologia sulla stessa sede in 90 giorni oltre la quale la NC è marcata ricorrente e la RCA diventa obbligatoria'],
  orario_lavoro: ['Finestra lavorativa (lun-ven)', 'Formato HH:MM-HH:MM, fuso Europe/Rome. Usata per SLA e statistiche'],
  lab_nome: ['Nome del laboratorio', 'Compare nel rapporto PDF'],
  lab_indirizzo: ['Indirizzo', ''],
  lab_email: ['Email del laboratorio', 'Mostrata alle sedi nelle email come contatto'],
  lab_telefono: ['Telefono del laboratorio', 'Mostrato alle sedi per le urgenze'],
};

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, reload } = useApi('/settings');
  const { data: lis, reload: reloadLis } = useApi('/lis/status');
  const { data: email, reload: reloadEmail } = useApi('/email?limit=100');
  const [f, setF] = useState(null);
  const [testTo, setTestTo] = useState(user.email);
  const [err, setErr] = useState(null);
  useEffect(() => { if (data) setF({ ...data.settings }); }, [data]);
  const save = async () => { setErr(null); try { await api.put('/settings', f); toast('Impostazioni salvate'); reload(); } catch (e) { setErr(e); } };
  const runScheduler = async () => { try { const r = await api.post('/scheduler/run'); toast(`Scheduler: ${r.reminders} solleciti, ${r.escalations} escalation, ${r.retried} email ritentate`); reloadEmail(); } catch (e) { toast(e.message, 'err'); } };
  const testMail = async () => { try { const r = await api.post('/email/test', { to: testTo }); toast(`Email di prova: ${r.stato.toLowerCase()}${r.errore ? ` · ${r.errore}` : ''}`, r.stato === 'ERRORE' ? 'err' : 'ok'); reloadEmail(); } catch (e) { toast(e.message, 'err'); } };
  const retry = async (e) => { try { const r = await api.post(`/email/${e.id}/retry`); toast(`Email: ${r.stato.toLowerCase()}`); reloadEmail(); } catch (er) { toast(er.message, 'err'); } };
  if (!data || !f) return <Loading />;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Impostazioni e integrazioni</h1><div className="sub">SLA, ricorrenze, dati del laboratorio, stato del collegamento con StudioLAB e della posta in uscita.</div></div></div>
      <div className="grid g2">
        <Card title="Regole del processo" actions={<button className="btn sm" onClick={save}>Salva</button>}>
          <ErrorBox error={err} />
          <div style={{ display: 'grid', gap: 12 }}>
            {Object.entries(LABEL).map(([k, [l, h]]) => <Field key={k} label={l} help={h}><input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          </div>
        </Card>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card title="StudioLAB (CB Sistemi)" actions={<button className="btn sm ghost" onClick={reloadLis}>Verifica</button>}>
            {!lis ? <Loading /> : <div className="small" style={{ display: 'grid', gap: 6 }}>
              <div>API ServiceNET: {lis.enabled ? <Badge tone={lis.ok ? 'green' : 'red'}>{lis.ok ? 'collegato' : `errore: ${lis.error}`}</Badge> : <Badge tone="grey">non configurato (LIS_API_KEY)</Badge>} <span className="muted">{lis.baseUrl}</span></div>
              <div>Write-back (blocco esami, allegati): <Badge tone={lis.writeBack ? 'green' : 'grey'}>{lis.writeBack ? 'attivo' : 'disattivato'}</Badge></div>
              <div>Canali in ingresso (push / HL7): <Badge tone={lis.push ? 'green' : 'grey'}>{lis.push ? 'segreto configurato' : 'non configurati (LIS_PUSH_SECRET)'}</Badge></div>
              <div className="muted">Eventi: {lis.stats?.api ?? 0} API · {lis.stats?.push ?? 0} push · {lis.stats?.hl7 ?? 0} HL7 · {lis.stats?.errori_24h ?? 0} errori nelle ultime 24 h</div>
              <div className="muted">Endpoint da comunicare a CB Sistemi: <span className="mono">{data.baseUrl}/api/lis/push</span> e <span className="mono">{data.baseUrl}/api/hl7</span> (header X-Push-Secret).</div>
              {lis.eventi?.length > 0 && <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}><table className="t"><tbody>{lis.eventi.slice(0, 20).map((e) => <tr key={e.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{itDateTime(e.created_at)}</td><td className="small"><Badge tone={e.esito === 'OK' ? 'green' : 'red'}>{e.canale}</Badge></td><td className="small">{e.accettazione_id}</td><td className="small muted">{e.dettaglio}</td></tr>)}</tbody></table></div>}
            </div>}
          </Card>
          <Card title="Posta in uscita" actions={isAdmin(user) && <button className="btn sm ghost" onClick={runScheduler}>Esegui scheduler ora</button>}>
            <div className="small" style={{ display: 'grid', gap: 8 }}>
              <div>Provider: <Badge tone={data.mail.provider === 'log' ? 'mauve' : 'green'}>{data.mail.provider === 'log' ? 'simulazione (nessun invio reale)' : data.mail.provider}</Badge> · mittente <b>{data.mail.from}</b> · notifiche interne a {data.mail.labNotify.join(', ')}</div>
              {isAdmin(user) && <div className="row"><input value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ maxWidth: 280 }} /><button className="btn sm" onClick={testMail}>Invia email di prova</button></div>}
            </div>
          </Card>
        </div>
      </div>
      <Card title={`Ultime email (${email?.length ?? 0})`} className="mt" style={{ marginTop: 16 }} flush>
        {!email ? <Loading /> : !email.length ? <Empty>Nessuna email</Empty> : <div className="table-wrap"><table className="t">
          <thead><tr><th>Quando</th><th>NC</th><th>Tipo</th><th>Destinatari</th><th>Oggetto</th><th>Stato</th><th></th></tr></thead>
          <tbody>{email.map((e) => <tr key={e.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{itDateTime(e.created_at)}</td><td className="mono small">{e.codice}</td><td className="small">{e.tipo.replace('NC_', '')}</td><td className="small">{e.destinatari}{e.cc ? <div className="muted">cc {e.cc}</div> : null}</td><td className="small">{e.oggetto}</td><td><Badge tone={e.stato === 'INVIATA' ? 'green' : e.stato === 'ERRORE' ? 'red' : e.stato === 'SIMULATA' ? 'mauve' : 'grey'}>{e.stato.toLowerCase()}</Badge>{e.errore && <div className="small red">{e.errore}</div>}</td><td>{e.stato !== 'INVIATA' && <button className="btn sm ghost" onClick={() => retry(e)}>Riprova</button>}</td></tr>)}</tbody>
        </table></div>}
      </Card>
    </div>
  );
}
