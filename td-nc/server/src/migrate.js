import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool, one, q } from './db.js';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'migrations');

export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`[migrate] applicata ${f}`);
    } catch (e) { await c.query('ROLLBACK'); throw new Error(`Migrazione ${f} fallita: ${e.message}`); }
    finally { c.release(); }
  }
  await seed();
}

async function seed() {
  // Primo amministratore (accesso Microsoft 365; password locale opzionale per l'avvio)
  if (config.seed.adminEmail) {
    const ex = await one('SELECT id, role, status FROM users WHERE lower(email)=$1', [config.seed.adminEmail]);
    if (!ex) {
      const pwd = config.seed.adminPassword && config.seed.adminPassword.length >= 12 ? await bcrypt.hash(config.seed.adminPassword, 12) : null;
      await pool.query(
        `INSERT INTO users (email, full_name, role, status, auth_provider, organization, password_hash, must_change_password)
         VALUES ($1,$2,'ADMIN','ACTIVE',$3,'Toscana Diagnostica',$4,$5)`,
        [config.seed.adminEmail, config.seed.adminName, pwd ? 'BOTH' : 'ENTRA', pwd, Boolean(pwd)]);
      console.log(`[seed] creato amministratore ${config.seed.adminEmail}`);
    } else if (ex.role !== 'ADMIN' || ex.status !== 'ACTIVE') {
      await pool.query(`UPDATE users SET role='ADMIN', status='ACTIVE' WHERE id=$1`, [ex.id]);
    }
  }
  // Sede "Laboratorio" (campioni interni / accettazioni dirette) sempre presente
  await q(`INSERT INTO sedi (codice, nome, tipo, email_nc, note) VALUES ('LAB-SESTO', 'Laboratorio di Analisi · Sesto Fiorentino (accettazione diretta)', 'LABORATORIO', $1, 'Sede interna: NC su campioni accettati direttamente al laboratorio')
           ON CONFLICT ((lower(codice))) DO NOTHING`, [config.mail.from]);

  // Dati dimostrativi (solo SEED_DEMO=true): sedi e accettazioni fittizie per il collaudo
  if (config.seed.demo) {
    const n = await one('SELECT count(*)::int AS n FROM accettazioni');
    if (n.n === 0) {
      const sedi = [
        ['PP-FIRENZE-01', 'Punto Prelievo Firenze Novoli', 'PUNTO_PRELIEVO', 'pp.novoli@example.test', '055 000001'],
        ['CM-PRATO-01', 'Centro Medico Prato', 'CENTRO_MEDICO', 'cm.prato@example.test', '0574 000002'],
        ['SRV-LAB-EMPOLI', 'Laboratorio Service Empoli', 'LABORATORIO', 'nc.empoli@example.test', '0571 000003'],
        ['SRV-POLI-PISTOIA', 'Poliambulatorio Service Pistoia', 'SERVICE', 'qualita.pistoia@example.test', '0573 000004'],
      ];
      const ids = [];
      for (const [codice, nome, tipo, email, tel] of sedi) {
        const s = await one(`INSERT INTO sedi (codice, nome, tipo, email_nc, telefono, note) VALUES ($1,$2,$3,$4,$5,'Sede dimostrativa') ON CONFLICT ((lower(codice))) DO UPDATE SET nome=EXCLUDED.nome RETURNING id`, [codice, nome, tipo, email, tel]);
        ids.push(s.id);
      }
      const esami = [[{ cod: 'EMO', descrizione: 'Emocromo' }, { cod: 'GLI', descrizione: 'Glucosio' }, { cod: 'K', descrizione: 'Potassio' }], [{ cod: 'PT', descrizione: 'Tempo di protrombina' }, { cod: 'PTT', descrizione: 'aPTT' }], [{ cod: 'HIV', descrizione: 'Anticorpi HIV 1-2' }, { cod: 'HBS', descrizione: 'HBsAg' }], [{ cod: 'URI', descrizione: 'Esame urine completo' }, { cod: 'URC', descrizione: 'Urinocoltura' }]];
      const nomi = [['ROSSI', 'MARIO', '1961-03-12', 'M'], ['BIANCHI', 'LUCIA', '1978-09-30', 'F'], ['VERDI', 'ANNA', '1990-01-05', 'F'], ['NERI', 'PAOLO', '1955-07-21', 'M'], ['GALLI', 'SARA', '1984-11-02', 'F'], ['FONTANA', 'LUCA', '2001-05-14', 'M']];
      for (let i = 0; i < 12; i++) {
        const [cg, nm, dn, sx] = nomi[i % nomi.length];
        const d = new Date(Date.now() - i * 36 * 3600 * 1000);
        await q(`INSERT INTO accettazioni (id, sede_id, data_accettazione, stato_lis, paziente_cognome, paziente_nome, paziente_nascita, paziente_sesso, esami, origine) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUALE') ON CONFLICT (id) DO NOTHING`,
          [`26${String(100100 + i * 37)}`, ids[i % ids.length], d, [0, 10, 10, 20, 40][i % 5], cg, nm, dn, sx, JSON.stringify(esami[i % esami.length].map((e) => ({ ...e, stato: null, bloccato: false })))]);
      }
      console.log('[seed] dati dimostrativi: 4 sedi, 12 accettazioni');
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
