import React, { useContext, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { qs } from '../api.js';
import { useAuth, isSede, isLab } from '../auth.jsx';
import { useApi, Card, Field, Loading, Empty, Badge } from '../components/ui.jsx';
import { STATO, STATO_SEDE, GRAVITA, MACRO, itDateTime, slaClass } from '../format.js';
import { LiveCtx } from '../App.jsx';

export default function NcList() {
  const { user } = useAuth();
  const live = useContext(LiveCtx);
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const sede = isSede(user);
  const f = useMemo(() => Object.fromEntries(['stato', 'sede', 'macro', 'tipo', 'gravita', 'from', 'to', 'q', 'ricorrenti', 'scadute', 'aperte'].map((k) => [k, sp.get(k) || ''])), [sp]);
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const { data } = useApi(`/nc${qs({ ...f, limit: 300 })}`, [live.tick]);
  const { data: sedi } = useApi(sede ? null : '/sedi');
  const { data: tipi } = useApi('/tipi');
  const S = sede ? STATO_SEDE : STATO;
  const exportUrl = `/api/nc/export.xlsx${qs(f)}`;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Non conformità</h1><div className="sub">{data ? `${data.total} risultati` : ''}{f.scadute ? ' · oltre SLA' : ''}{f.stato === 'CHIUSA' ? ' · chiuse in attesa di verifica di efficacia' : ''}</div></div>
        {isLab(user) && <a className="btn ghost" href={exportUrl}>Esporta XLSX</a>}
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="codice, accettazione, testo" /></Field>
        <Field label="Stato"><select value={f.stato} onChange={(e) => { set('stato', e.target.value); if (e.target.value) set('aperte', ''); }}><option value="">Tutti</option>{Object.entries(S).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        {!sede && <Field label="Sede"><select value={f.sede} onChange={(e) => set('sede', e.target.value)}><option value="">Tutte</option>{(sedi || []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></Field>}
        <Field label="Macro-area"><select value={f.macro} onChange={(e) => { set('macro', e.target.value); set('tipo', ''); }}><option value="">Tutte</option>{Object.entries(MACRO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Tipologia"><select value={f.tipo} onChange={(e) => set('tipo', e.target.value)}><option value="">Tutte</option>{(tipi || []).filter((t) => !f.macro || t.macro === f.macro).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Gravità"><select value={f.gravita} onChange={(e) => set('gravita', e.target.value)}><option value="">Tutte</option>{Object.entries(GRAVITA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Dal"><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
        <Field label="Al"><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
        <label className="f inline"><input type="checkbox" checked={f.ricorrenti === '1'} onChange={(e) => set('ricorrenti', e.target.checked ? '1' : '')} /> solo ricorrenti</label>
        {!sede && <label className="f inline"><input type="checkbox" checked={f.scadute === '1'} onChange={(e) => set('scadute', e.target.checked ? '1' : '')} /> oltre SLA</label>}
        {[...sp.keys()].length > 0 && <button className="btn sm ghost" onClick={() => setSp({}, { replace: true })}>Azzera filtri</button>}
      </div>
      <Card flush>
        {!data ? <Loading /> : !data.rows.length ? <Empty>Nessuna non conformità con questi filtri</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>NC</th><th>Aperta</th><th>Accettazione</th>{!sede && <th>Sede</th>}<th>Tipologia</th><th>Gravità</th><th>Stato</th><th>Scadenza / chiusura</th><th></th></tr></thead>
            <tbody>{data.rows.map((n) => (
              <tr key={n.id} className="click" onClick={() => nav(`/nc/${n.id}`)}>
                <td className="mono strong">{n.codice}</td>
                <td className="small">{itDateTime(n.opened_at)}<div className="muted">{n.opened_by_name}</div></td>
                <td className="mono">{n.accettazione_id}</td>
                {!sede && <td className="small">{n.sede_nome}</td>}
                <td className="small">{MACRO[n.macro]?.label}<div className="muted">{n.tipo_label || n.tipo_altro}</div></td>
                <td className={`small grav-${n.gravita}`}>{GRAVITA[n.gravita]}{n.ricorrente && <div><Badge tone="red">ricorrente</Badge></div>}</td>
                <td><Badge tone={S[n.stato].tone}>{S[n.stato].label}</Badge>{n.rca_richiesta && !n.rca_causa && n.stato !== 'ANNULLATA' && !sede && <div className="small muted">RCA da fare</div>}</td>
                <td className={`small ${slaClass(n)}`}>{n.stato === 'INVIATA_SEDE' ? itDateTime(n.sla_due_at) : n.closed_at ? itDateTime(n.closed_at) : <span className="muted">–</span>}</td>
                <td className="small muted">{n.n_messaggi} msg{n.n_allegati ? ` · ${n.n_allegati} all.` : ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
