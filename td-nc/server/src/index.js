import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { loadUser, requireAuth } from './lib/access.js';
import { HttpError } from './lib/util.js';
import { clientCount, sseHandler } from './lib/events.js';
import { runSlaCheck } from './lib/nc.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import sediRoutes from './routes/sedi.js';
import accRoutes from './routes/accettazioni.js';
import ncRoutes from './routes/nc.js';
import statsRoutes from './routes/stats.js';
import adminRoutes from './routes/admin.js';
import inboundRoutes from './routes/inbound.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Dominio canonico (come td-integration): richieste su altri host -> redirect permanente
const canonicalHost = (() => { try { const u = new URL(config.baseUrl); return /localhost|127\.0\.0\.1/.test(u.hostname) ? null : u.host; } catch { return null; } })();
if (canonicalHost) {
  app.use((req, res, next) => {
    if (req.path === '/api/health' || req.path.startsWith('/api/lis/') || req.path === '/api/hl7' || req.hostname === canonicalHost) return next();
    res.redirect(301, `https://${canonicalHost}${req.originalUrl}`);
  });
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", 'blob:'],
      objectSrc: ["'self'", 'blob:'],
      formAction: ["'self'", 'https://login.microsoftonline.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Canali macchina (LIS) prima di sessione e CSRF
app.use('/api', inboundRoutes);

app.use(express.json({ limit: '24mb' }));

const PgStore = pgSession(session);
app.use(session({
  store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
  name: 'tdnc.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: config.sessionHours * 3600 * 1000 },
}));

// CSRF: le richieste che modificano dati devono arrivare dal client dell'app (header custom)
app.use('/api', (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'td-nc') return next(new HttpError(403, 'Richiesta non valida'));
  next();
});

app.use(loadUser);
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, sse: clientCount(), lis: config.lis.enabled, mail: config.mail.provider }); } catch { res.status(503).json({ ok: false }); }
});
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.get('/api/events', sseHandler);
app.use('/api', userRoutes);
app.use('/api', sediRoutes);
app.use('/api', accRoutes);
app.use('/api', ncRoutes);
app.use('/api', statsRoutes);
app.use('/api', adminRoutes);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));

// Frontend (build Vite)
const webDir = process.env.WEB_DIR || path.join(__dirname, '..', 'public');
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
}

app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (err.code === '23505') return res.status(409).json({ error: 'Elemento duplicato' });
  res.status(status).json({ error: status >= 500 ? 'Errore interno del server' : err.message, code: err.code, details: err.details, current: err.current });
});

// Scheduler: SLA (solleciti, escalation) e coda email
function startScheduler() {
  const tick = async () => {
    try { const out = await runSlaCheck(); if (out.reminders || out.escalations || out.retried) console.log('[scheduler]', JSON.stringify(out)); }
    catch (e) { console.error('[scheduler]', e.message); }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, Math.max(1, config.schedulerMinutes) * 60 * 1000);
}

async function start() {
  const deadline = Date.now() + 150_000;
  for (let attempt = 1; ; attempt++) {
    try { await pool.query('SELECT 1'); break; }
    catch (e) {
      if (Date.now() > deadline) throw new Error(`Database non raggiungibile: ${e.message}`);
      console.log(`[avvio] database non ancora pronto (tentativo ${attempt}). Riprovo tra 5 s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await migrate();
  app.listen(config.port, () => console.log(`TD Non Conformità in ascolto su :${config.port} · LIS ${config.lis.enabled ? 'attivo' : 'non configurato'} · email ${config.mail.provider}`));
  if (process.env.DISABLE_SCHEDULER !== 'true') startScheduler();
}
start().catch((e) => { console.error(e); process.exit(1); });
