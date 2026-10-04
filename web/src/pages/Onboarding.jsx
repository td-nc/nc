import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, ErrorBox } from '../components/ui.jsx';

export default function Onboarding() {
  const { refresh, logout } = useAuth();
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post('/auth/change-password', { currentPassword: cur, newPassword: nw }); await refresh(); } catch (e2) { setErr(e2); }
    setBusy(false);
  };
  return (
    <div className="login">
      <div className="art">
        <img src="/logo-light.svg" alt="Toscana Diagnostica" />
        <div className="claim">Prima di entrare, <span>scegli la tua password</span>.</div>
        <div className="foot">Non Conformità · Laboratorio di Analisi · Toscana Diagnostica</div>
      </div>
      <div className="pane">
        <form onSubmit={submit}>
          <div><h1>Cambia la password temporanea</h1><div className="muted" style={{ marginTop: 4 }}>Minimo 12 caratteri, con almeno una maiuscola, una minuscola e un numero.</div></div>
          <ErrorBox error={err} />
          <Field label="Password temporanea"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus autoComplete="current-password" /></Field>
          <Field label="Nuova password"><input type="password" value={nw} onChange={(e) => setNw(e.target.value)} required autoComplete="new-password" /></Field>
          <button className="btn lg" disabled={busy}>Salva e continua</button>
          <button type="button" className="btn link" onClick={logout}>Esci</button>
        </form>
      </div>
    </div>
  );
}
