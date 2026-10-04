import React, { useState } from 'react';
import { qs } from '../api.js';
import { useAuth, isSede, isLab } from '../auth.jsx';
import { useApi, Card, Field, Kpi, Loading, Empty } from '../components/ui.jsx';
import { MACRO, GRAVITA, STATO, RCA_CAT } from '../format.js';

const monthStart = (back) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return d.toISOString().slice(0, 10); };

// Grafico a barre verticali in SVG (nessuna dipendenza esterna), fedele alla palette condivisa
function Bars({ series, labels, colors = ['#1C505E', '#71B1BD', '#DEC0F1'], h = 160 }) {
  const n = labels.length; if (!n) return <Empty>Nessun dato</Empty>;
  const max = Math.max(1, ...labels.map((_, i) => series.reduce((a, s) => a + (s.data[i] || 0), 0)));
  const w = Math.max(320, n * 44), pad = 24, bw = (w - pad * 2) / n;
  return (
    <svg className="svgchart" viewBox={`0 0 ${w} ${h + 34}`} role="img">
      {labels.map((l, i) => {
        let y = h;
        return <g key={l}>
          {series.map((s, k) => { const v = s.data[i] || 0; const bh = (v / max) * (h - 10); y -= bh; return <rect key={k} x={pad + i * bw + bw * 0.18} y={y} width={bw * 0.64} height={bh} fill={colors[k % colors.length]} rx="2"><title>{`${l} · ${s.name}: ${v}`}</title></rect>; })}
          <text x={pad + i * bw + bw / 2} y={h + 14} fontSize="9.5" textAnchor="middle" fill="#5b6f75">{l}</text>
          <text x={pad + i * bw + bw / 2} y={y - 3} fontSize="9.5" textAnchor="middle" fill="#0f2a33" fontWeight="700">{series.reduce((a, s) => a + (s.data[i] || 0), 0) || ''}</text>
        </g>;
      })}
      <g>{series.map((s, k) => <g key={k}><rect x={pad + k * 110} y={h + 22} width="10" height="10" fill={colors[k]} rx="2" /><text x={pad + k * 110 + 14} y={h + 31} fontSize="9.5" fill="#5b6f75">{s.name}</text></g>)}</g>
    </svg>
  );
}

export default function Stats() {
  const { user } = useAuth();
  const [f, setF] = useState({ from: monthStart(5), to: '', sede: '' });
  const { data: sedi } = useApi(isSede(user) ? '/sedi' : '/sedi?tutte=1');
  const { data } = useApi(`/stats${qs(f)}`);
  const t = data?.totali;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const dow = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Statistiche</h1><div className="sub">Indicatori della fase pre-analitica per il riesame della direzione e il confronto con le sedi. Periodo e sede selezionabili.</div></div>
        {isLab(user) && <a className="btn ghost" href={`/api/nc/export.xlsx${qs(f)}`}>Esporta dettaglio XLSX</a>}
      </div>
      <div className="filters">
        <Field label="Dal"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Al"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        {!isSede(user) && <Field label="Sede"><select value={f.sede} onChange={(e) => setF({ ...f, sede: e.target.value })}><option value="">Tutte</option>{(sedi || []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></Field>}
        <div className="row" style={{ alignSelf: 'flex-end' }}>{[['Mese corrente', monthStart(0)], ['3 mesi', monthStart(2)], ['6 mesi', monthStart(5)], ['12 mesi', monthStart(11)]].map(([l, v]) => <button key={l} className="btn sm ghost" onClick={() => setF({ ...f, from: v, to: '' })}>{l}</button>)}</div>
      </div>
      {!data ? <Loading /> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Kpi label="Non conformità" value={t.totale} foot={`${t.aperte} aperte · ${t.chiuse} chiuse`} accent />
          <Kpi label="Rispetto SLA sede" value={t.sla_rispetto_pct != null ? `${t.sla_rispetto_pct}%` : '–'} foot={`${t.risposte_in_sla} risposte su ${t.con_risposta} entro i termini`} bar={t.sla_rispetto_pct} />
          <Kpi label="Tempo risposta sede" value={t.ore_risposta_media_lavorative != null ? `${t.ore_risposta_media_lavorative} h` : '–'} foot="ore lavorative medie, invio → prima risposta" />
          <Kpi label="Tempo di chiusura" value={t.ore_chiusura_mediana != null ? `${Math.round(t.ore_chiusura_mediana)} h` : '–'} foot={`mediana · media ${t.ore_chiusura_media != null ? Math.round(t.ore_chiusura_media) : '–'} h`} />
        </div>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Kpi label="Critiche / maggiori" value={`${t.critiche} / ${t.maggiori}`} foot={pct(t.critiche + t.maggiori, t.totale) + ' del totale'} />
          <Kpi label="Ricorrenti" value={t.ricorrenti} foot="stessa tipologia e sede in 90 gg" />
          <Kpi label="Escalation" value={t.escalation} foot="sedi senza risposta oltre i termini" />
          <Kpi label="NC per 1.000 accettazioni" value={t.tasso_nc_per_1000 ?? '–'} foot={`${t.accettazioni_in_archivio} accettazioni in archivio`} />
        </div>
        <div className="grid g2" style={{ marginBottom: 16 }}>
          <Card title="Andamento mensile per macro-area">
            <Bars labels={data.trend.map((x) => x.mese.slice(2).replace('-', '/'))} series={[{ name: 'Fisiche', data: data.trend.map((x) => x.fisiche) }, { name: 'Informatiche', data: data.trend.map((x) => x.informatiche) }, { name: 'Documentali', data: data.trend.map((x) => x.documentali) }]} />
          </Card>
          <Card title="Pareto delle tipologie">
            {!data.perTipo.length ? <Empty>Nessun dato</Empty> : <div className="bars">{data.perTipo.slice(0, 10).map((x) => <div className="b" key={x.macro + x.tipo}><span className="small" title={`${MACRO[x.macro]?.label} · ${x.tipo}`}>{x.tipo}</span><div className="track"><i style={{ width: `${Math.round((x.n / data.perTipo[0].n) * 100)}%` }} />{x.rilevanti > 0 && <i className="c" style={{ width: `${Math.round((x.rilevanti / data.perTipo[0].n) * 100)}%`, marginTop: -10 }} />}</div><span className="n">{x.n}</span></div>)}
              <div className="legend mt"><span><i style={{ background: 'var(--teal)' }} />tutte</span><span><i style={{ background: 'var(--red)' }} />maggiori + critiche</span></div></div>}
          </Card>
        </div>
        <div className="grid g3" style={{ marginBottom: 16 }}>
          <Card title="Per gravità e stato">
            <div className="bars">{data.perGravita.map((g) => <div className="b" key={g.gravita}><span className="small">{GRAVITA[g.gravita]}</span><div className="track"><i className={g.gravita === 'CRITICA' ? 'c' : g.gravita === 'MAGGIORE' ? 'm' : ''} style={{ width: `${Math.round((g.n / t.totale) * 100)}%` }} /></div><span className="n">{g.n}</span></div>)}</div>
            <div className="bars mt">{data.perStato.map((s) => <div className="b" key={s.stato}><span className="small">{STATO[s.stato]?.label}</span><div className="track"><i className="m" style={{ width: `${Math.round((s.n / t.totale) * 100)}%` }} /></div><span className="n">{s.n}</span></div>)}</div>
          </Card>
          <Card title="Cause radice (RCA eseguite)">
            {!data.perCausa.length ? <Empty>Nessuna analisi della causa radice nel periodo</Empty> : <div className="bars">{data.perCausa.map((c) => <div className="b" key={c.categoria}><span className="small">{RCA_CAT[c.categoria]}</span><div className="track"><i style={{ width: `${Math.round((c.n / data.perCausa[0].n) * 100)}%` }} /></div><span className="n">{c.n}</span></div>)}</div>}
            <div className="small muted mt">{t.con_rca} NC con RCA · {data.capa.totale} azioni CAPA ({data.capa.completate} completate, {data.capa.scadute} scadute) · {t.verificate_efficaci} verifiche efficaci</div>
          </Card>
          <Card title="Quando si rilevano">
            <Bars h={90} labels={data.perGiornoSettimana.map((x) => dow[x.dow])} series={[{ name: 'NC per giorno', data: data.perGiornoSettimana.map((x) => x.n) }]} />
            <Bars h={90} labels={data.perOra.map((x) => `${x.ora}h`)} series={[{ name: 'NC per ora', data: data.perOra.map((x) => x.n) }]} colors={['#71B1BD']} />
          </Card>
        </div>
        <Card title="Per sede inviante" flush>
          {!data.perSede.length ? <Empty>Nessun dato</Empty> : <div className="table-wrap"><table className="t">
            <thead><tr><th>Sede</th><th className="num">NC</th><th className="num">Aperte</th><th className="num">Maggiori + critiche</th><th className="num">Ricorrenti</th><th className="num">Risposte in SLA</th><th className="num">Accettazioni</th><th className="num">NC / 1.000</th></tr></thead>
            <tbody>{data.perSede.map((s) => <tr key={s.id}><td><div className="strong">{s.nome}</div><div className="small muted">{s.codice}</div></td><td className="num strong">{s.totale}</td><td className="num">{s.aperte}</td><td className={`num ${s.rilevanti ? 'red' : ''}`}>{s.rilevanti}</td><td className={`num ${s.ricorrenti ? 'red' : ''}`}>{s.ricorrenti}</td><td className="num">{pct(s.in_sla, s.con_risposta)}</td><td className="num muted">{s.accettazioni}</td><td className="num">{s.accettazioni ? Math.round((s.totale / s.accettazioni) * 10000) / 10 : '–'}</td></tr>)}</tbody>
          </table></div>}
          <div className="small muted" style={{ padding: '10px 14px' }}>{data.nota_denominatore}</div>
        </Card>
      </>}
    </div>
  );
}
