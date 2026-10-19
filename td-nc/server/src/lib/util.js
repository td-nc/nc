import { q } from '../db.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (msg, d) => new HttpError(400, msg, d);
export const forbidden = (msg = 'Operazione non consentita') => new HttpError(403, msg);
export const notFound = (msg = 'Elemento non trovato') => new HttpError(404, msg);

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function audit(req, action, { entity, entityId, ncId, label, data } = {}, client) {
  const runner = client ? client.query.bind(client) : q;
  try {
    const r = await runner(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, nc_id, label, data, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, at',
      [req.user?.id || null, action, entity || null, entityId != null ? String(entityId) : null, ncId || null, label || null,
        data ? JSON.stringify(data) : null, req.ip],
    );
    return r.rows[0];
  } catch (e) {
    console.error('[audit]', e.message);
    return null;
  }
}

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'campo'}: ${i.message}`).join('; ');
    throw bad(`Dati non validi. ${msg}`);
  }
  return r.data;
}

export const itDateTime = (d) =>
  d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '';

// differenze campo per campo (per l'audit): ritorna {campo: [prima, dopo]}
export function diff(before, after, fields) {
  const out = {};
  for (const k of fields) {
    const a = before?.[k], b = after?.[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = [a ?? null, b ?? null];
  }
  return out;
}
