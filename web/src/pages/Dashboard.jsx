import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, isLab, isSede } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, Empty, Badge } from '../components/ui.jsx';
import { STATO, STATO_SEDE, GRAVITA, MACRO, itDateTime, slaClass } from '../format.js';
import { LiveCtx } from '../App.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const live = useContext(LiveCtx);
  const nav = useNavigate();
  const sede = isSede(user);
  const { data: open } = useApi('/nc?aperte=1&limit=30', [live.tick]);
  const { data: st } = useApi(`/stats?from=${new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)}`, [live.tick]);
  const c = live.counts || {};
  const S = sede ? STATO_SEDE : STATO;
  const rows = open?.rows || [];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Cruscotto</h1><div className="sub">{sede ? 'Le non conformità sui campioni inviati dalle tue sedi: rispondi entro i termini per sbloccare gli esami.' : 'Lo stato della preanalitica in tempo reale: cosa va gestito adesso, cosa è oltre i termini, come va il mese.'}</div></div>
        {isLab(user) && <Link to="/desk" className="btn lg">Desk accettazioni</Link>}
      </div>
      <div className="grid g4" style={{ marginBottom: 18 }}>
        {sede ? <>
          <Kpi label="Da rispondere" value={c.da_rispondere ?? '–'} foot="in attesa di una vostra azione" accent />
          <Kpi label="Oltre il termine" value={c.scadute ?? '–'} foot="risposta attesa già scaduta" />
          <Kpi label="Aperte in totale" value={c.aperte ?? '–'} foot="in lavorazione con il laboratorio" />
          <Kpi label="Ultimi 30 giorni" value={st?.totali?.totale ?? '–'} foot={`${st?.totali?.ricorrenti ?? 0} ricorrenti`} />
        </> : <>
          <Kpi label="Risposte da gestire" value={c.da_gestire ?? '–'} foot="la sede ha risposto: decidere il trattamento" accent />
          <Kpi label="In attesa della sede" value={c.in_attesa ?? '–'} foot={`${c.scadute ?? 0} oltre SLA`} bar={c.in_attesa ? Math.round(((c.in_attesa - (c.scadute || 0)) / c.in_attesa) * 100) : null} />
          <Kpi label="Da inviare" value={c.da_inviare ?? '–'} foot="aperte ma non ancora comunicate" />
          <Kpi label="Ultimi 30 giorni" value={st?.totali?.totale ?? '–'} foot={`${st?.totali?.critiche ?? 0} critiche · ${st?.totali?.ricorrenti ?? 0} ricorrenti · SLA ${st?.totali?.sla_rispetto_pct ?? '–'}%`} />
        </>}
      </div>
      <div className="grid g3">
        <Card title={sede ? 'Non conformità aperte' : 'Da gestire adesso'} className="span2" flush actions={<Link to="/nc" className="btn sm ghost">Tutte</Link>}>
          {!open ? <Loading /> : !rows.length ? <Empty>Nessuna non conformità aperta. Ottimo segno.</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>NC</th><th>Accettazione</th>{!sede && <th>Sede</th>}<th>Tipologia</th><th>Stato</th><th>Scadenza</th></tr></thead>
              <tbody>{rows.map((n) => (
                <tr key={n.id} className="click" onClick={() => nav(`/nc/${n.id}`)}>
                  <td><div className="strong mono">{n.codice}</div><div className={`small grav-${n.gravita}`}>{GRAVITA[n.gravita]}{n.ricorrente ? ' · ricorrente' : ''}</div></td>
                  <td className="mono">{n.accettazione_id}</td>
                  {!sede && <td className="small">{n.sede_nome}</td>}
                  <td className="small">{MACRO[n.macro]?.label}<div className="muted">{n.tipo_label || n.tipo_altro}</div></td>
                  <td><Badge tone={S[n.stato].tone}>{S[n.stato].label}</Badge></td>
                  <td className={`small ${slaClass(n)}`}>{n.stato === 'INVIATA_SEDE' ? itDateTime(n.sla_due_at) : <span className="muted">–</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card title="Ultimi 30 giorni per tipologia">
            {!st ? <Loading /> : !st.perTipo.length ? <Empty>Nessun dato</Empty> : (
              <div className="bars">{st.perTipo.slice(0, 7).map((t) => (
                <div className="b" key={t.macro + t.tipo}><span className="small" title={t.tipo}>{t.tipo}</span><div className="track"><i style={{ width: `${Math.round((t.n / st.perTipo[0].n) * 100)}%` }} /></div><span className="n">{t.n}</span></div>
              ))}</div>
            )}
          </Card>
          {!sede && <Card title="Sedi con più NC (30 gg)">
            {!st ? <Loading /> : !st.perSede.length ? <Empty>Nessun dato</Empty> : (
              <div className="bars">{st.perSede.slice(0, 6).map((s) => (
                <div className="b" key={s.id}><span className="small" title={s.nome}>{s.nome}</span><div className="track"><i className={s.ricorrenti ? 'c' : ''} style={{ width: `${Math.round((s.totale / st.perSede[0].totale) * 100)}%` }} /></div><span className="n">{s.totale}</span></div>
              ))}</div>
            )}
          </Card>}
        </div>
      </div>
    </div>
  );
}
