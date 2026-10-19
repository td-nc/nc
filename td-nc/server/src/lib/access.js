import { one, many } from '../db.js';
import { HttpError, forbidden } from './util.js';

// ADMIN    direzione / amministratore dell'applicazione: tutto
// QUALITA  responsabile qualità (RSQ): analisi causa radice, CAPA, chiusura, verifica efficacia, catalogo, sedi, statistiche
// LAB      operatori di preanalitica / laboratorio: rilevazione, trattamento, dialogo con la sede, chiusura
// SEDE     punti prelievo, centri medici, clienti Service: vedono e rispondono solo alle NC delle proprie sedi
// VIEWER   sola lettura interna (direzione, auditor)
export const ROLES = ['ADMIN', 'QUALITA', 'LAB', 'SEDE', 'VIEWER'];
export const INTERNAL_ROLES = ['ADMIN', 'QUALITA', 'LAB', 'VIEWER'];

export async function loadUser(req, _res, next) {
  try {
    const id = req.session?.userId;
    if (id) {
      const u = await one(
        `SELECT id, email, full_name, role, status, auth_provider, organization, telefono, entra_tid, must_change_password, last_login_at, notify_email
           FROM users WHERE id = $1`, [id]);
      if (u && u.status === 'ACTIVE') {
        if (u.role === 'SEDE') u.sedi = (await many('SELECT sede_id FROM users_sedi WHERE user_id=$1', [u.id])).map((r) => r.sede_id);
        req.user = u;
      } else if (u && u.status === 'PENDING') req.pendingUser = u;
      else req.session.userId = null;
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, _res, next) {
  if (!req.user) {
    if (req.pendingUser) return next(Object.assign(new HttpError(403, 'Account in attesa di abilitazione'), { code: 'PENDING' }));
    return next(new HttpError(401, 'Sessione scaduta o non autenticata'));
  }
  if (req.user.must_change_password && req.session.authMethod === 'LOCAL' && !/^\/api\/auth\//.test(req.originalUrl)) {
    return next(Object.assign(new HttpError(403, 'Cambio password obbligatorio'), { code: 'PASSWORD_CHANGE_REQUIRED' }));
  }
  next();
}

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
export const requireAdmin = requireRole('ADMIN');
export const requireQualita = requireRole('ADMIN', 'QUALITA');
export const requireLab = requireRole('ADMIN', 'QUALITA', 'LAB');
export const requireInternal = requireRole(...INTERNAL_ROLES);
export const isAdmin = (u) => u?.role === 'ADMIN';
export const isQualita = (u) => u?.role === 'ADMIN' || u?.role === 'QUALITA';
export const isLab = (u) => ['ADMIN', 'QUALITA', 'LAB'].includes(u?.role);
export const isSede = (u) => u?.role === 'SEDE';
export const isInternal = (u) => INTERNAL_ROLES.includes(u?.role);

// Una NC è visibile a un utente SEDE solo se appartiene a una delle sue sedi
export const canSeeSede = (u, sedeId) => isInternal(u) || (isSede(u) && (u.sedi || []).includes(Number(sedeId)));
