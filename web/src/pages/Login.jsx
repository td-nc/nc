import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, ErrorBox } from '../components/ui.jsx';

export default function Login() {
  const { refresh } = useAuth();
  const [cfg, setCfg] = useState({ entraEnabled: false });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(() => { const e = new URLSearchParams(window.location.search).get('error'); return e ? new Error(e) : null; });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/auth/config').then(setCfg).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post('/auth/login', { email, password });
      await refresh();
    } catch (e2) { setErr(e2); }
    setBusy(false);
  };

  return (
    <div className="login">
      <div className="art">
        <img src="/logo-light.svg" alt="Toscana Diagnostica" />
        <div className="claim">Ogni campione, ogni anomalia, <span>sotto controllo</span>. Prima che diventi un referto.</div>
        <div className="foot">Gestione delle non conformità pre-analitiche · Laboratorio di Analisi · Via di Pratignone 13/4, Sesto Fiorentino · accesso riservato</div>
      </div>
      <div className="pane">
        <form onSubmit={submit}>
          <div>
            <h1>Accedi</h1>
            <div className="muted" style={{ marginTop: 4 }}>Personale Toscana Diagnostica con il proprio account Microsoft 365. Punti prelievo, centri medici, clienti Service e collaboratori esterni con le credenziali fornite dal laboratorio.</div>
          </div>
          <ErrorBox error={err} />
          {cfg.entraEnabled && <>
            <a className="btn ms lg" href="/api/auth/entra/login">
              <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg>
              Accedi con Microsoft 365
            </a>
            <div className="or">oppure con email e password</div>
          </>}
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!cfg.entraEnabled} /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <button className="btn lg" disabled={busy}>{busy ? 'Verifica…' : 'Accedi'}</button>
          <div className="small muted">Hai ricevuto un'email dal laboratorio? Dopo l'accesso verrai portato direttamente alla non conformità indicata nel link.</div>
        </form>
      </div>
    </div>
  );
}
