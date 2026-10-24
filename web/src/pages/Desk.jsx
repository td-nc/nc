import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, isSede } from '../auth.jsx';
import { useApi, Card, Field, Loading, Empty, Badge, ErrorBox, Icon, useToast, Modal } from '../components/ui.jsx';
import { STATO, STATO_SEDE, STATO_LIS, GRAVITA, MACRO, SEDE_TIPO, itDate, itDateTime } from '../format.js';
import { LiveCtx } from '../App.jsx';
import NcWizard from '../components/NcWizard.jsx';

function ManualForm({ id, sedi, onDone, onClose }) {
  const [f, setF] = useState({ id, sede_id: '', paziente_cognome: '', paziente_nome: '', paziente_nascita: '', paziente_sesso: '', id_richiesta_cliente: '', esami: '' });
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    try {
      const esami = f.esami.split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const [cod, ...d] = x.split(/\s+/); return { cod: cod.toUpperCase(), descrizione: d.join(' ') }; });
      const r = await api.post('/accettazioni', { ...f, sede_id: Number(f.sede_id), paziente_nascita: f.paziente_nascita || null, paziente_sesso: f.paziente_sesso || null, id_richiesta_cliente: f.id_richiesta_cliente || null, esami });
      onDone(r.id);
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={`Registra l'accettazione ${id}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!f.sede_id} onClick={save}>Registra</button></>}>
      <div className="alert info">L'accettazione non è in archivio (LIS non collegato o ordine non trasmesso). Registrala con i dati minimi: la NC potrà essere aperta subito. Se il campione è privo di ordine informatico, la NC giusta è "Informatica · Accettazione non trasmessa al LIS".</div>
      <ErrorBox error={err} />
      <div className="form-grid mt">
        <Field label="Sede inviante"><select value={f.sede_id} onChange={(e) => setF({ ...f, sede_id: e.target.value })}><option value="">Scegli…</option>{sedi.map((s) => <option key={s.id} value={s.id}>{s.nome} ({s.codice})</option>)}</select></Field>
        <Field label="Riferimento richiesta cliente" help="Facoltativo"><input value={f.id_richiesta_cliente} onChange={(e) => setF({ ...f, id_richiesta_cliente: e.target.value })} /></Field>
        <Field label="Cognome paziente"><input value={f.paziente_cognome} onChange={(e) => setF({ ...f, paziente_cognome: e.target.value.toUpperCase() })} /></Field>
        <Field label="Nome paziente"><input value={f.paziente_nome} onChange={(e) => setF({ ...f, paziente_nome: e.target.value.toUpperCase() })} /></Field>
        <Field label="Data di nascita"><input type="date" value={f.paziente_nascita} onChange={(e) => setF({ ...f, paziente_nascita: e.target.value })} /></Field>
        <Field label="Sesso"><select value={f.paziente_sesso} onChange={(e) => setF({ ...f, paziente_sesso: e.target.value })}><option value="">–</option><option>M</option><option>F</option><option>X</option></select></Field>
      </div>
      <Field label="Esami (uno per riga o separati da virgola: codice e descrizione)" className="mt"><textarea value={f.esami} onChange={(e) => setF({ ...f, esami: e.target.value })} placeholder={'EMO Emocromo\nK Potassio'} /></Field>
    </Modal>
  );
}

export default function Desk({ readOnly = false }) {
  const { user } = useAuth();
  const live = useContext(LiveCtx);
  const nav = useNavigate();
  const toast = useToast();
  const params = useParams();
  const sede = isSede(user) || readOnly;
  const [code, setCode] = useState(params.id || '');
  const [acc, setAcc] = useState(null);
  const [err, setErr] = useState(null);
  const [manual, setManual] = useState(null);
  const [wizard, setWizard] = useState(false);
  const [fixSede, setFixSede] = useState(false);
  const inputRef = useRef();
  const { data: sedi } = useApi('/sedi');
  const [filter, setFilter] = useState({ q: '', sede: '', from: '', to: '', solo_nc: sede ? '1' : '' });
  const { data: recent, reload } = useApi(`/accettazioni${qs({ ...filter, limit: 60 })}`, [live.tick]);

  const removeAcc = async () => {
    if (!acc || !window.confirm(`Eliminare l'accettazione ${acc.id} registrata manualmente? L'operazione non si annulla.`)) return;
    try { await api.del(`/accettazioni/${encodeURIComponent(acc.id)}`); toast('Accettazione eliminata'); setAcc(null); setCode(''); nav('/desk', { replace: true }); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const lookup = async (id, refresh = false) => {
    const v = String(id || code).trim();
    if (!v) return;
    setErr(null); setAcc(null);
    try { const a = await api.get(`/accettazioni/${encodeURIComponent(v)}${refresh ? '?refresh=1' : ''}`); setAcc(a); if (params.id !== v) nav(`/desk/${encodeURIComponent(v)}`, { replace: true }); }
    catch (e) { setErr(e); if (e.code === 'ACC_NOT_FOUND' && !sede) setManual(v); }
  };
  useEffect(() => { if (params.id) { setCode(params.id); lookup(params.id); } else inputRef.current?.focus(); /* eslint-disable-next-line */ }, [params.id]);
  useEffect(() => { if (acc && live.tick) lookup(acc.id); /* eslint-disable-next-line */ }, [live.tick]);

  const S = sede ? STATO_SEDE : STATO;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{sede ? 'Accettazioni con non conformità' : 'Desk accettazioni'}</h1><div className="sub">{sede ? 'Le accettazioni delle tue sedi su cui il laboratorio ha aperto una non conformità.' : 'Leggi il barcode della provetta o digita il numero di accettazione: vedi stato, esami, NC già aperte e apri una nuova NC in pochi secondi.'}</div></div>
      </div>

      {!sede && <Card>
        <form className="scan" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
          <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Numero accettazione / barcode" autoComplete="off" />
          <button className="btn lg"><Icon name="search" /> Cerca</button>
        </form>
        {err && err.code !== 'ACC_NOT_FOUND' && <div className="mt"><ErrorBox error={err} /></div>}
        {err && err.code === 'ACC_NOT_FOUND' && !manual && <div className="alert warn mt">{err.message}. <button className="btn sm" onClick={() => setManual(String(code).trim())}>Registra manualmente</button></div>}
      </Card>}

      {acc && <div className="grid g3 mt" style={{ marginTop: 16 }}>
        <Card className="span2" title={`Accettazione ${acc.id}`} actions={<>
          {acc.lisError && <Badge tone="red">LIS non raggiungibile</Badge>}
          <Badge tone={acc.origine === 'MANUALE' ? 'mauve' : 'blue'}>{acc.origine === 'MANUALE' ? 'registrata manualmente' : `da ${acc.origine}`}</Badge>
          {!sede && acc.origine !== 'MANUALE' && <button className="btn sm ghost" onClick={() => lookup(acc.id, true)}>Aggiorna dal LIS</button>}
          {!sede && acc.origine === 'MANUALE' && <button className="btn sm danger" disabled={(acc.nc || []).length > 0} title={(acc.nc || []).length ? 'Ha non conformità collegate: annullale prima' : 'Elimina la registrazione manuale'} onClick={removeAcc}>Elimina</button>}
          {!sede && <button className="btn" onClick={() => setWizard(true)}><Icon name="plus" /> Nuova NC</button>}
        </>}>
          <div className="acc-head">
            <div>
              <div className="small muted">Sede inviante</div>
              <div className="strong">{acc.sede_nome || <span className="red">non associata</span>} {acc.sede_codice && <span className="muted small">({acc.sede_codice} · {SEDE_TIPO[acc.sede_tipo]})</span>}
                {!sede && <button className="btn link small" style={{ marginLeft: 8 }} onClick={() => setFixSede(true)}>{acc.sede_id ? 'correggi' : 'assegna'}</button>}</div>
              {!acc.sede_email && !sede && acc.sede_id && <div className="small red">La sede non ha un'email per le NC: impostala in Sedi invianti prima di inviare.</div>}
              <div className="small muted mt">Paziente</div>
              <div className="strong">{[acc.paziente_cognome, acc.paziente_nome].filter(Boolean).join(' ') || '–'} {acc.paziente_nascita && <span className="muted small">· {itDate(acc.paziente_nascita)} · {acc.paziente_sesso || ''}</span>}</div>
            </div>
            <div>
              <div className="small muted">Stato LIS</div><div className="strong">{acc.lisStatoLabel || STATO_LIS[acc.stato_lis] || '–'}</div>
              <div className="small muted mt">Data accettazione</div><div>{itDateTime(acc.data_accettazione) || '–'}</div>
              {acc.id_richiesta_cliente && <><div className="small muted mt">Rif. cliente</div><div className="mono">{acc.id_richiesta_cliente}</div></>}
            </div>
          </div>
          <div className="small muted mt">Esami ({acc.esami?.length || 0})</div>
          <div className="esami mt" style={{ marginTop: 6 }}>{(acc.esami || []).map((e) => <label key={e.cod + (e.idEsame || '')} className={e.bloccato ? 'blocked' : ''} title={e.nc || ''}><b>{e.cod}</b> {e.descrizione}{e.bloccato ? ' · bloccato' : ''}{e.numReferto ? ' · refertato' : ''}</label>)}{!acc.esami?.length && <span className="muted small">nessun esame in archivio</span>}</div>
        </Card>
        <Card title={`Non conformità (${acc.nc.length})`} flush>
          {!acc.nc.length ? <Empty>Nessuna NC su questa accettazione</Empty> : (
            <table className="t"><tbody>{acc.nc.map((n) => (
              <tr key={n.id} className="click" onClick={() => nav(`/nc/${n.id}`)}>
                <td><div className="strong mono">{n.codice}</div><div className="small muted">{MACRO[n.macro]?.label} · {n.tipo_label || n.tipo_altro}</div><div className={`small grav-${n.gravita}`}>{GRAVITA[n.gravita]}</div></td>
                <td style={{ textAlign: 'right' }}><Badge tone={S[n.stato].tone}>{S[n.stato].label}</Badge><div className="small muted">{itDateTime(n.opened_at)}</div></td>
              </tr>
            ))}</tbody></table>
          )}
        </Card>
      </div>}

      <Card title={sede ? 'Accettazioni' : 'Accettazioni in archivio'} className="mt" style={{ marginTop: 16 }} flush actions={<div className="row">
        <input placeholder="Cerca numero o cognome" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} style={{ minHeight: 32, width: 200 }} />
        {!sede && <select value={filter.sede} onChange={(e) => setFilter({ ...filter, sede: e.target.value })} style={{ minHeight: 32, width: 220 }}><option value="">Tutte le sedi</option>{(sedi || []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>}
        <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} style={{ minHeight: 32, width: 150 }} />
        {!sede && <label className="f inline small"><input type="checkbox" checked={filter.solo_nc === '1'} onChange={(e) => setFilter({ ...filter, solo_nc: e.target.checked ? '1' : '' })} /> solo con NC</label>}
      </div>}>
        {!recent ? <Loading /> : !recent.length ? <Empty>Nessuna accettazione in archivio{!sede && '. Richiamane una dal LIS o registrala manualmente.'}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Accettazione</th><th>Data</th><th>Sede</th><th>Paziente</th><th>Stato LIS</th><th>Esami</th><th>NC</th><th>Origine</th></tr></thead>
            <tbody>{recent.map((a) => (
              <tr key={a.id} className="click" onClick={() => (sede ? null : (setCode(a.id), lookup(a.id)))}>
                <td className="mono strong">{a.id}</td><td className="small">{itDateTime(a.data_accettazione)}</td><td className="small">{a.sede_nome || <span className="red">–</span>}</td>
                <td className="small">{[a.paziente_cognome, a.paziente_nome].filter(Boolean).join(' ')}</td><td className="small">{STATO_LIS[a.stato_lis] || '–'}</td><td className="small">{(a.esami || []).length}</td>
                <td>{a.n_nc > 0 ? <Badge tone="yellow">{a.n_nc}</Badge> : <span className="muted small">–</span>}</td><td className="small muted">{a.origine}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      {manual && <ManualForm id={manual} sedi={(sedi || []).filter((s) => s.attiva)} onClose={() => setManual(null)} onDone={(id) => { setManual(null); toast('Accettazione registrata'); setCode(id); lookup(id); reload(); }} />}
      {wizard && acc && <NcWizard acc={acc} onClose={() => setWizard(false)} onDone={(nc) => { setWizard(false); live.refreshCounts(); nav(`/nc/${nc.id}`); }} />}
      {fixSede && acc && <Modal title="Sede inviante dell'accettazione" onClose={() => setFixSede(false)}>
        <Field label="Sede"><select defaultValue={acc.sede_id || ''} onChange={async (e) => { try { await api.patch(`/accettazioni/${encodeURIComponent(acc.id)}/sede`, { sede_id: Number(e.target.value) }); setFixSede(false); toast('Sede aggiornata'); lookup(acc.id); } catch (er) { toast(er.message, 'err'); } }}>
          <option value="">Scegli…</option>{(sedi || []).map((s) => <option key={s.id} value={s.id}>{s.nome} ({s.codice})</option>)}</select></Field>
      </Modal>}
    </div>
  );
}
export { Link };
