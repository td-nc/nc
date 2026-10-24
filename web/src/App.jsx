import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, isAdmin, isQualita, isLab, isSede, isInternal } from './auth.jsx';
import { ToastProvider, Icon, Loading, BusyBar, useToast } from './components/ui.jsx';
import { ROLE } from './format.js';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Pending from './pages/Pending.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Desk from './pages/Desk.jsx';
import NcList from './pages/NcList.jsx';
import NcDetail from './pages/NcDetail.jsx';
import Stats from './pages/Stats.jsx';
import Sedi from './pages/Sedi.jsx';
import Tipi from './pages/Tipi.jsx';
import Users from './pages/Users.jsx';
import Audit from './pages/Audit.jsx';
import Settings from './pages/Settings.jsx';
import Profile from './pages/Profile.jsx';
import Guide from './pages/Guide.jsx';

export const LiveCtx = React.createContext({ counts: {}, tick: 0, refreshCounts: () => {} });

// Contatori del menu + eventi in tempo reale (SSE): ogni evento aggiorna i badge e segnala alle pagine di ricaricare
function useLive(user) {
  const [counts, setCounts] = useState({});
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const refreshCounts = useCallback(() => { api.get('/nc/counts').then(setCounts).catch(() => {}); }, []);
  useEffect(() => {
    refreshCounts();
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'hello') return;
        setTick((t) => t + 1); refreshCounts();
        if (ev.type === 'nc.replied' && isLab(user)) toast(`Risposta ricevuta: ${ev.label}`);
        if (ev.type === 'nc.created' && isSede(user)) toast(`Nuova non conformità: ${ev.codice}`);
      } catch { /* ignora */ }
    };
    const iv = setInterval(refreshCounts, 120000);
    return () => { es.close(); clearInterval(iv); };
  }, [refreshCounts, toast, user]);
  return { counts, tick, refreshCounts };
}

function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const live = useLive(user);
  useEffect(() => setOpen(false), [loc.pathname]);
  const c = live.counts;
  // Attivo = stesso percorso E stessa query: le viste di /nc (tutte, oltre SLA, da verificare) sono voci distinte
  const isOn = (to) => {
    const [path, search = ''] = to.split('?');
    if (loc.pathname !== path && !(path !== '/' && loc.pathname.startsWith(`${path}/`) && !search)) return false;
    const want = new URLSearchParams(search), got = new URLSearchParams(loc.search);
    if (!search) return ![...got.keys()].some((k) => ['stato', 'scadute'].includes(k));
    return [...want.entries()].every(([k, v]) => got.get(k) === v);
  };
  const L = ({ to, icon, children, count, tone }) => (
    <NavLink to={to} end className={() => (isOn(to) ? 'active' : '')}><Icon name={icon} />{children}{count > 0 && <span className={`count ${tone || ''}`}>{count}</span>}</NavLink>
  );
  return (
    <LiveCtx.Provider value={live}>
      <div className="shell">
        <aside className={`side ${open ? 'open' : ''}`}>
          <div className="brand"><img src="/logo-light.svg" alt="Toscana Diagnostica" /><div className="app">Non Conformità · Laboratorio</div></div>
          <nav>
            <L to="/" icon="home" end>Cruscotto</L>
            {isLab(user) && <>
              <div className="group">Preanalitica</div>
              <L to="/desk" icon="scan">Desk accettazioni</L>
              <L to="/nc" icon="inbox" count={c.da_gestire} tone="yellow">Non conformità</L>
              <L to="/nc?stato=INVIATA_SEDE&scadute=1" icon="clock" count={c.scadute} tone="red">Oltre SLA</L>
            </>}
            {isSede(user) && <>
              <div className="group">Le mie sedi</div>
              <L to="/nc" icon="inbox" count={c.da_rispondere} tone="yellow">Non conformità</L>
              <L to="/accettazioni" icon="list">Accettazioni con NC</L>
            </>}
            {user.role === 'VIEWER' && <L to="/nc" icon="inbox">Non conformità</L>}
            <div className="group">Analisi</div>
            <L to="/statistiche" icon="stats">Statistiche</L>
            {isInternal(user) && <L to="/sedi" icon="building">Sedi invianti</L>}
            {isQualita(user) && <>
              <div className="group">Qualità</div>
              <L to="/nc?stato=CHIUSA" icon="check" count={c.da_verificare}>Da verificare</L>
              <L to="/tipi" icon="sliders">Catalogo tipologie</L>
              <L to="/utenti" icon="users">Utenti e accessi</L>
              <L to="/audit" icon="shield">Registro attività</L>
              <L to="/impostazioni" icon="gear">Impostazioni e LIS</L>
            </>}
            <div className="group">Aiuto</div>
            <L to="/guida" icon="list">Guida all'uso</L>
          </nav>
          <div className="me">
            <div className="name">{user.full_name}</div>
            <div>{ROLE[user.role]}{user.organization ? ` · ${user.organization}` : ''}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <NavLink to="/profilo" className="btn sm ghost" style={{ color: 'var(--teal)' }}>Profilo</NavLink>
              <button className="btn sm dark" onClick={logout}>Esci</button>
            </div>
          </div>
        </aside>
        <main className="main">
          <div className="topbar"><button onClick={() => setOpen(!open)} aria-label="Menu">☰</button><img src="/logo-light.svg" alt="" /></div>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            {isLab(user) && <Route path="/desk" element={<Desk />} />}
            {isLab(user) && <Route path="/desk/:id" element={<Desk />} />}
            {isSede(user) && <Route path="/accettazioni" element={<Desk readOnly />} />}
            <Route path="/nc" element={<NcList />} />
            <Route path="/nc/:id" element={<NcDetail />} />
            <Route path="/statistiche" element={<Stats />} />
            {isInternal(user) && <Route path="/sedi" element={<Sedi />} />}
            {isQualita(user) && <Route path="/tipi" element={<Tipi />} />}
            {isQualita(user) && <Route path="/utenti" element={<Users />} />}
            {isQualita(user) && <Route path="/audit" element={<Audit />} />}
            {isQualita(user) && <Route path="/impostazioni" element={<Settings />} />}
            <Route path="/profilo" element={<Profile />} />
            <Route path="/guida" element={<Guide />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </LiveCtx.Provider>
  );
}

function Gate() {
  const { loading, user, pending, authMethod } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  if (user.must_change_password && authMethod === 'LOCAL') return <Onboarding />;
  if (pending) return <Pending />;
  return <Shell />;
}

export default function App() {
  return (
    <ToastProvider>
      <BusyBar />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
export { isAdmin };
