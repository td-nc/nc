import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, q } from '../db.js';
import { config } from '../config.js';
import { ah, bad, audit, parse, HttpError } from '../lib/util.js';
import { requireAuth } from '../lib/access.js';
import { beginLogin, completeLogin } from '../lib/entra.js';

const r = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Troppi tentativi. Riprova tra qualche minuto.' } });
const MAX_FAILED = 5, LOCK_MIN = 15;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

const regenerate = (req) => new Promise((res, rej) => req.session.regenerate((e) => (e ? rej(e) : res())));

async function finishLogin(req, user, method) {
  await regenerate(req);
  req.session.userId = user.id;
  req.session.authMethod = method;
  await q('UPDATE users SET last_login_at=now(), failed_logins=0, locked_until=NULL WHERE id=$1', [user.id]);
  req.user = user;
  await audit(req, 'LOGIN', { entity: 'user', entityId: user.id, data: { method } });
}

const publicUser = (u) => u && ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role, status: u.status, auth_provider: u.auth_provider,
  organization: u.organization, telefono: u.telefono, must_change_password: u.must_change_password, notify_email: u.notify_email, sedi: u.sedi || [] });

r.get('/config', (_req, res) => res.json({ entraEnabled: config.entra.enabled, appName: config.appName, lisEnabled: config.lis.enabled, mailProvider: config.mail.provider }));

r.get('/me', ah(async (req, res) => {
  if (req.user) return res.json({ user: publicUser(req.user), authMethod: req.session.authMethod, pending: false });
  if (req.pendingUser) return res.json({ user: publicUser(req.pendingUser), authMethod: req.session.authMethod, pending: true });
  res.status(401).json({ error: 'Non autenticato' });
}));

r.post('/logout', ah(async (req, res) => {
  if (req.user) await audit(req, 'LOGOUT', { entity: 'user', entityId: req.user.id });
  req.session.destroy(() => res.json({ ok: true }));
}));

// ---- email + password (collaboratori esterni senza account Microsoft; gli amministratori usano Microsoft 365)
r.post('/login', loginLimiter, ah(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const u = await one('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
  const generic = new HttpError(401, 'Credenziali non valide');
  if (!u || u.status === 'DISABLED' || !u.password_hash || u.auth_provider === 'ENTRA') { await bcrypt.compare(password, DUMMY_HASH); throw generic; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'Account temporaneamente bloccato per troppi tentativi. Riprova più tardi.');
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const failed = u.failed_logins + 1;
    await q(`UPDATE users SET failed_logins=$2, locked_until = CASE WHEN $2 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MIN} minutes' ELSE NULL END WHERE id=$1`, [u.id, failed]);
    await audit(req, 'LOGIN_FAILED', { entity: 'user', entityId: u.id });
    throw generic;
  }
  await finishLogin(req, u, 'LOCAL');
  res.json({ ok: true, pending: u.status === 'PENDING', mustChangePassword: u.must_change_password, role: u.role });
}));

const pwdSchema = z.string().min(12, 'minimo 12 caratteri').regex(/[A-Z]/, 'serve una maiuscola').regex(/[a-z]/, 'serve una minuscola').regex(/\d/, 'serve un numero');
r.post('/change-password', ah(async (req, res) => {
  const u0 = req.user || req.pendingUser;
  if (!u0) throw new HttpError(401, 'Non autenticato');
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string(), newPassword: pwdSchema }), req.body);
  const u = await one('SELECT password_hash FROM users WHERE id=$1', [u0.id]);
  if (!u.password_hash || !(await bcrypt.compare(currentPassword, u.password_hash))) throw bad('Password attuale errata');
  if (currentPassword === newPassword) throw bad('La nuova password deve essere diversa');
  await q('UPDATE users SET password_hash=$2, must_change_password=FALSE, updated_at=now() WHERE id=$1', [u0.id, await bcrypt.hash(newPassword, 12)]);
  await audit(req, 'PASSWORD_CHANGED', { entity: 'user', entityId: u0.id });
  res.json({ ok: true });
}));

r.put('/me/preferences', ah(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Non autenticato');
  const b = parse(z.object({ notify_email: z.boolean().optional(), telefono: z.string().max(40).optional() }), req.body);
  await q('UPDATE users SET notify_email=coalesce($2,notify_email), telefono=coalesce($3,telefono), updated_at=now() WHERE id=$1', [req.user.id, b.notify_email ?? null, b.telefono ?? null]);
  res.json({ ok: true });
}));

// ---- Microsoft Entra ID
r.get('/entra/login', ah(async (req, res) => {
  if (!config.entra.enabled) throw bad('Accesso Microsoft non configurato');
  const { url, state, nonce, verifier } = beginLogin();
  req.session.oidc = { state, nonce, verifier, at: Date.now() };
  res.redirect(url);
}));

r.get('/entra/callback', ah(async (req, res) => {
  const fail = (m) => res.redirect(`/login?error=${encodeURIComponent(m)}`);
  const o = req.session.oidc;
  delete req.session.oidc;
  if (!o || Date.now() - o.at > 10 * 60 * 1000) return fail('Sessione di accesso scaduta, riprova');
  if (req.query.error) return fail(`Accesso Microsoft non riuscito: ${req.query.error_description || req.query.error}`);
  if (req.query.state !== o.state || !req.query.code) return fail('Risposta di accesso non valida');
  let claims;
  try { claims = await completeLogin({ code: String(req.query.code), verifier: o.verifier, nonce: o.nonce }); }
  catch (e) { console.error('[entra]', e.message); return fail(e.code === 'TENANT' ? e.message : 'Accesso Microsoft non riuscito'); }

  let u = await one('SELECT * FROM users WHERE entra_oid=$1 OR lower(email)=$2', [claims.oid, claims.email]);
  if (!u) {
    // primo accesso: censimento automatico. Dominio TD -> LAB attivo; altri -> in attesa di abilitazione.
    const domain = claims.email.split('@')[1];
    const auto = config.autoLabDomains.includes(domain);
    const isSeedAdmin = config.seed.adminEmail && claims.email === config.seed.adminEmail;
    u = await one(
      `INSERT INTO users (email, full_name, role, status, auth_provider, organization, entra_tid, entra_oid)
       VALUES ($1,$2,$3,$4,'ENTRA',$5,$6,$7) RETURNING *`,
      [claims.email, claims.name, isSeedAdmin ? 'ADMIN' : (auto ? 'LAB' : 'VIEWER'), (auto || isSeedAdmin) ? 'ACTIVE' : 'PENDING',
        auto ? 'Toscana Diagnostica' : domain, claims.tid, claims.oid]);
    await audit({ user: u, ip: req.ip }, 'USER_SELF_REGISTERED', { entity: 'user', entityId: u.id, label: `${u.email} (${u.status})` });
  } else {
    if (u.status === 'DISABLED') return fail(`Account ${claims.email} disabilitato. Contatta l'amministratore.`);
    if (u.auth_provider === 'LOCAL') await q(`UPDATE users SET auth_provider='BOTH' WHERE id=$1`, [u.id]);
    await q('UPDATE users SET entra_oid=coalesce(entra_oid,$2), entra_tid=coalesce(entra_tid,$3), full_name = CASE WHEN full_name = email THEN $4 ELSE full_name END WHERE id=$1', [u.id, claims.oid, claims.tid, claims.name]);
  }
  await finishLogin(req, u, 'ENTRA');
  res.redirect('/');
}));

export default r;
