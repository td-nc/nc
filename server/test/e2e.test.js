// Test end-to-end delle API su un database di prova con SEED_DEMO=true.
// Avvio: DATABASE_URL=... SESSION_SECRET=x SEED_ADMIN_EMAIL=admin@test.it SEED_ADMIN_PASSWORD=Admin-Password-2026 SEED_DEMO=true DISABLE_SCHEDULER=true node src/index.js
// poi: BASE=http://localhost:3000 npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL || 'admin@test.it', password: process.env.SEED_ADMIN_PASSWORD || 'Admin-Password-2026' };

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const res = await fetch(BASE + '/api' + url, {
      method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'td-nc', Cookie: this.cookie, ...headers },
      body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
    });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : (ct.includes('pdf') || ct.includes('sheet') ? Buffer.from(await res.arrayBuffer()) : await res.text()), ct };
  }
  get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b || {}); }
  put(u, b) { return this.req('PUT', u, b); } patch(u, b) { return this.req('PATCH', u, b); } del(u) { return this.req('DELETE', u); }
}

const admin = new Client();
let sede, acc, nc, sedeUser, lab;

async function login(c, cred) {
  let r = await c.post('/auth/login', cred); assert.equal(r.status, 200, JSON.stringify(r.data));
  if (r.data.mustChangePassword) {
    const np = cred.password + '-X1';
    r = await c.post('/auth/change-password', { currentPassword: cred.password, newPassword: np }); assert.equal(r.status, 200, JSON.stringify(r.data));
    cred.password = np;
  }
}

before(async () => {
  const h = await admin.get('/health'); assert.equal(h.status, 200);
  await login(admin, ADMIN);
});

test('seed: sedi dimostrative e accettazioni in archivio', async () => {
  const s = await admin.get('/sedi'); assert.equal(s.status, 200); assert.ok(s.data.length >= 5);
  sede = s.data.find((x) => x.codice === 'PP-FIRENZE-01'); assert.ok(sede);
  const a = await admin.get('/accettazioni?limit=50'); assert.equal(a.status, 200); assert.ok(a.data.length >= 12);
  acc = a.data.find((x) => x.sede_id === sede.id); assert.ok(acc);
});

test('CSRF: scrittura senza header rifiutata', async () => {
  const r = await admin.req('POST', '/sedi', { codice: 'X', nome: 'X' }, { 'X-Requested-With': 'no' });
  assert.equal(r.status, 403);
});

test('richiamo accettazione per numero (cache) e 404 con canCreateManual', async () => {
  const r = await admin.get(`/accettazioni/${acc.id}`); assert.equal(r.status, 200); assert.equal(r.data.sede_nome, sede.nome); assert.ok(Array.isArray(r.data.nc));
  const nf = await admin.get('/accettazioni/NON-ESISTE'); assert.equal(nf.status, 404); assert.equal(nf.data.code, 'ACC_NOT_FOUND'); assert.equal(nf.data.details.canCreateManual, true);
});

test('registrazione manuale di un\'accettazione', async () => {
  const r = await admin.post('/accettazioni', { id: 'MAN-0001', sede_id: sede.id, paziente_cognome: 'TEST', paziente_nome: 'MANUALE', esami: [{ cod: 'EMO', descrizione: 'Emocromo' }] });
  assert.equal(r.status, 201); assert.equal(r.data.origine, 'MANUALE');
});

test('catalogo tipologie e impostazioni', async () => {
  const t = await admin.get('/tipi'); assert.equal(t.status, 200); assert.ok(t.data.find((x) => x.codice === 'EMOLISI'));
  const s = await admin.get('/settings'); assert.equal(s.status, 200); assert.equal(s.data.settings.sla_ore_default, '24');
});

test('apertura NC: codice progressivo, email in registro, stato INVIATA_SEDE, SLA calcolato', async () => {
  const tipi = (await admin.get('/tipi')).data;
  const emolisi = tipi.find((x) => x.codice === 'EMOLISI');
  const r = await admin.post('/nc', {
    accettazione_id: acc.id, macro: 'FISICA', tipo_id: emolisi.id, gravita: 'MINORE', descrizione: 'Siero francamente emolizzato, provetta gialla.',
    azione_attesa: emolisi.azione_attesa, esami_coinvolti: acc.esami.slice(0, 2), campione_bloccato: true, invia: true,
    allegati: [{ nome: 'foto.png', mime: 'image/png', base64: Buffer.from('fake-png').toString('base64') }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  nc = r.data;
  assert.match(nc.codice, /^NC-\d{4}-0001$/);
  assert.equal(nc.stato, 'INVIATA_SEDE');
  assert.ok(nc.sla_due_at);
  assert.ok(new Date(nc.sla_due_at) > new Date());
  assert.equal(nc.email.stato, 'SIMULATA');
  assert.equal(nc.email.destinatari, 'pp.novoli@example.test');
  assert.ok(!nc.email.corpo_html?.includes('ROSSI'), 'nessun dato paziente in email');
  const d = await admin.get(`/nc/${nc.id}`); assert.equal(d.status, 200); assert.equal(d.data.allegati.length, 1); assert.equal(d.data.messaggi[0].tipo, 'APERTURA');
  const counts = await admin.get('/nc/counts'); assert.equal(counts.data.in_attesa, 1);
});

test('NC critica -> RCA obbligatoria; chiusura bloccata senza RCA e trattamento', async () => {
  const tipi = (await admin.get('/tipi')).data;
  const et = tipi.find((x) => x.codice === 'ETICHETTA');
  const r = await admin.post('/nc', { accettazione_id: acc.id, macro: 'FISICA', tipo_id: et.id, gravita: 'CRITICA', descrizione: 'Etichetta con nome diverso dalla richiesta.', azione_attesa: 'Conferma identità', invia: false });
  assert.equal(r.status, 201); assert.equal(r.data.stato, 'APERTA'); assert.equal(r.data.rca_richiesta, true);
  const c = await admin.post(`/nc/${r.data.id}/chiudi`, { esito: 'Chiusura test' }); assert.equal(c.status, 400);
  const an = await admin.post(`/nc/${r.data.id}/annulla`, { motivo: 'Aperta per errore durante il test' }); assert.equal(an.status, 200); assert.equal(an.data.stato, 'ANNULLATA');
});

test('utente di sede: creato dalla Qualità, vede solo le proprie NC, risponde con contatti obbligatori', async () => {
  const r = await admin.post('/users', { email: 'sede.novoli@example.test', full_name: 'Operatore Novoli', role: 'SEDE', auth_provider: 'LOCAL', sedi: [sede.id], organization: 'PP Novoli' });
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.ok(r.data.tempPassword);
  sedeUser = new Client();
  await login(sedeUser, { email: 'sede.novoli@example.test', password: r.data.tempPassword });
  const me = await sedeUser.get('/auth/me'); assert.equal(me.data.user.role, 'SEDE'); assert.deepEqual(me.data.user.sedi, [sede.id]);
  const list = await sedeUser.get('/nc'); assert.equal(list.status, 200); assert.ok(list.data.rows.every((x) => x.sede_id === sede.id));
  const altra = (await admin.get('/sedi')).data.find((x) => x.codice === 'CM-PRATO-01');
  const accAltra = (await admin.get(`/accettazioni?sede=${altra.id}`)).data[0];
  const hidden = await sedeUser.get(`/accettazioni/${accAltra.id}`); assert.equal(hidden.status, 404);
  const noContact = await sedeUser.post(`/nc/${nc.id}/messaggi`, { tipo: 'RISPOSTA', testo: 'Rifacciamo il prelievo domani.' }); assert.equal(noContact.status, 400);
  const forbidden = await sedeUser.post(`/nc/${nc.id}/chiudi`, { esito: 'x' }); assert.equal(forbidden.status, 403);
  const ok = await sedeUser.post(`/nc/${nc.id}/messaggi`, { tipo: 'RISPOSTA', testo: 'Paziente richiamato, nuovo prelievo eseguito stamani e inviato con il corriere delle 12.', azione_eseguita: true, contatto_nome: 'Giulia Verdi', contatto_email: 'g.verdi@example.test', contatto_tel: '3331234567' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data)); assert.equal(ok.data.nc.stato, 'RISPOSTA_SEDE'); assert.ok(ok.data.nc.first_response_at);
  const d = await sedeUser.get(`/nc/${nc.id}`); assert.equal(d.status, 200); assert.equal(d.data.azioni.length, 0); assert.ok(!('rca_causa' in d.data.nc));
  const counts = await admin.get('/nc/counts'); assert.equal(counts.data.da_gestire, 1);
});

test('laboratorio: nuova richiesta alla sede riporta in INVIATA_SEDE con nuovo SLA, nota interna invisibile alla sede', async () => {
  const r = await admin.post(`/nc/${nc.id}/messaggi`, { tipo: 'RICHIESTA', testo: 'Grazie. Confermate che la nuova provetta riporta la stessa etichetta?' });
  assert.equal(r.status, 201); assert.equal(r.data.nc.stato, 'INVIATA_SEDE'); assert.equal(r.data.email.tipo, 'NC_RICHIESTA');
  const n = await admin.post(`/nc/${nc.id}/messaggi`, { tipo: 'NOTA_INTERNA', testo: 'Campione originale conservato a 4 °C, rack NC-A3.' }); assert.equal(n.status, 201);
  const dSede = await sedeUser.get(`/nc/${nc.id}`); assert.ok(!dSede.data.messaggi.some((m) => m.tipo === 'NOTA_INTERNA'));
  const dLab = await admin.get(`/nc/${nc.id}`); assert.ok(dLab.data.messaggi.some((m) => m.tipo === 'NOTA_INTERNA'));
  const r2 = await sedeUser.post(`/nc/${nc.id}/messaggi`, { tipo: 'RISPOSTA', testo: 'Confermato, stessa etichetta.', contatto_nome: 'Giulia Verdi', contatto_email: 'g.verdi@example.test', contatto_tel: '3331234567' });
  assert.equal(r2.status, 201); assert.equal(r2.data.nc.stato, 'RISPOSTA_SEDE');
});

test('trattamento, RCA, CAPA, chiusura con notifica, verifica efficacia', async () => {
  let cur = (await admin.get(`/nc/${nc.id}`)).data.nc;
  const t = await admin.post(`/nc/${nc.id}/trattamento`, { trattamento_tipo: 'NUOVO_CAMPIONE', conservazione: '4 °C fino al ricevimento', trattamento_note: 'Esami K e LDH sospesi.', version: cur.version });
  assert.equal(t.status, 200); assert.equal(t.data.stato, 'IN_TRATTAMENTO');
  const stale = await admin.post(`/nc/${nc.id}/trattamento`, { trattamento_tipo: 'DEROGA', version: cur.version }); assert.equal(stale.status, 409);
  cur = t.data;
  const rca = await admin.post(`/nc/${nc.id}/rca`, { rca_metodo: '5 perché', rca_categoria: 'PRELIEVO', rca_causa: 'Prelievo con ago 23G e aspirazione forzata da operatore neoassunto.', version: cur.version }); assert.equal(rca.status, 200);
  const az = await admin.post(`/nc/${nc.id}/azioni`, { tipo: 'PREVENTIVA', descrizione: 'Affiancamento operatore su tecnica di prelievo', responsabile: 'Coordinatore PP Novoli', scadenza: '2026-10-31' }); assert.equal(az.status, 201);
  cur = (await admin.get(`/nc/${nc.id}`)).data.nc;
  const close = await admin.post(`/nc/${nc.id}/chiudi`, { esito: 'Nuovo campione idoneo ricevuto e processato. Referto emesso.', notifica_sede: true, version: cur.version });
  assert.equal(close.status, 200, JSON.stringify(close.data)); assert.equal(close.data.nc.stato, 'CHIUSA'); assert.equal(close.data.email.tipo, 'NC_CHIUSA');
  // verifica efficace bloccata con CAPA aperta
  cur = close.data.nc;
  const v1 = await admin.post(`/nc/${nc.id}/verifica`, { verifica_esito: 'EFFICACE', version: cur.version }); assert.equal(v1.status, 400);
  const upd = await admin.put(`/nc/${nc.id}/azioni/${az.data.id}`, { stato: 'COMPLETATA' }); assert.equal(upd.status, 200); assert.ok(upd.data.completata_at);
  cur = (await admin.get(`/nc/${nc.id}`)).data.nc;
  const v2 = await admin.post(`/nc/${nc.id}/verifica`, { verifica_esito: 'EFFICACE', verifica_note: 'Nessuna emolisi dalla stessa sede nei 30 giorni successivi.', version: cur.version });
  assert.equal(v2.status, 200); assert.equal(v2.data.stato, 'VERIFICATA');
  const sedeClosed = await sedeUser.post(`/nc/${nc.id}/messaggi`, { tipo: 'RISPOSTA', testo: 'x', contatto_nome: 'a', contatto_email: 'a@b.it', contatto_tel: '1' }); assert.equal(sedeClosed.status, 400);
});

test('ricorrenza: terza NC dello stesso tipo sulla stessa sede viene marcata e richiede RCA', async () => {
  const tipi = (await admin.get('/tipi')).data; const emolisi = tipi.find((x) => x.codice === 'EMOLISI');
  const accs = (await admin.get(`/accettazioni?sede=${sede.id}`)).data;
  const mk = (a) => admin.post('/nc', { accettazione_id: a.id, macro: 'FISICA', tipo_id: emolisi.id, gravita: 'MINORE', descrizione: 'Emolisi lieve del campione.', azione_attesa: 'Nuovo prelievo', invia: false });
  const r2 = await mk(accs[1]); assert.equal(r2.status, 201); assert.equal(r2.data.ricorrente, false);
  const r3 = await mk(accs[2]); assert.equal(r3.status, 201); assert.equal(r3.data.ricorrente, true); assert.equal(r3.data.rca_richiesta, true); assert.equal(r3.data.ricorrenza.n, 3);
});

test('rapporto PDF, export XLSX, statistiche, registro', async () => {
  const pdf = await admin.get(`/nc/${nc.id}/rapporto.pdf`); assert.equal(pdf.status, 200); assert.ok(pdf.ct.includes('pdf')); assert.ok(pdf.data.length > 2000); assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  const pdfSede = await sedeUser.get(`/nc/${nc.id}/rapporto.pdf`); assert.equal(pdfSede.status, 200);
  const x = await admin.get('/nc/export.xlsx'); assert.equal(x.status, 200); assert.ok(x.ct.includes('sheet')); assert.equal(x.data.subarray(0, 2).toString(), 'PK');
  const xSede = await sedeUser.get('/nc/export.xlsx'); assert.equal(xSede.status, 403);
  const st = await admin.get('/stats'); assert.equal(st.status, 200); assert.ok(st.data.totali.totale >= 3); assert.ok(st.data.perSede.length >= 1); assert.ok(st.data.perTipo[0].n >= 1);
  const stSede = await sedeUser.get('/stats'); assert.equal(stSede.status, 200); assert.ok(stSede.data.perSede.every((s) => s.id === sede.id));
  const au = await admin.get(`/audit?nc=${nc.id}`); assert.equal(au.status, 200); assert.ok(au.data.some((a) => a.action === 'NC_CREATED')); assert.ok(au.data.some((a) => a.action === 'NC_CLOSED'));
  const em = await admin.get('/email'); assert.equal(em.status, 200); assert.ok(em.data.length >= 4);
});

test('SLA: scadenza calcolata in ore lavorative; scheduler invia sollecito su NC scaduta', async () => {
  const { addWorkingHours } = await import('../src/lib/sla.js');
  // venerdì 9 ottobre 2026 17:30 Roma (+02:00) + 24 h lavorative (08-18): 0,5 h ven + 10 h lun + 10 h mar + 3,5 h mer -> mercoledì 14 ottobre 11:30
  const due = addWorkingHours(new Date('2026-10-09T15:30:00Z'), 24, '08:00-18:00');
  assert.equal(due.toISOString(), '2026-10-14T09:30:00.000Z');
  // mezzanotte di sabato -> lunedì 08:00 + 1 h = 09:00 (07:00Z)
  assert.equal(addWorkingHours(new Date('2026-10-10T22:00:00Z'), 1, '08:00-18:00').toISOString(), '2026-10-12T07:00:00.000Z');
  // forza una NC scaduta e lancia lo scheduler
  const tipi = (await admin.get('/tipi')).data; const vol = tipi.find((x) => x.codice === 'VOLUME');
  const accs = (await admin.get(`/accettazioni?sede=${sede.id}`)).data;
  const r = await admin.post('/nc', { accettazione_id: accs[3].id, macro: 'FISICA', tipo_id: vol.id, gravita: 'MINORE', descrizione: 'Provetta citrato riempita a metà.', azione_attesa: 'Nuovo prelievo', invia: true });
  assert.equal(r.status, 201);
  const { pool } = await import('../src/db.js');
  await pool.query(`UPDATE nc SET sla_due_at = '2026-09-21T10:00:00Z' WHERE id=$1`, [r.data.id]);   // lunedì, in orario lavorativo, nel passato
  const run1 = await admin.post('/scheduler/run'); assert.equal(run1.status, 200); assert.ok(run1.data.reminders >= 1);
  const run2 = await admin.post('/scheduler/run'); assert.ok(run1.data.escalations + run2.data.escalations >= 1);
  const d = await admin.get(`/nc/${r.data.id}`); assert.ok(d.data.nc.sla_reminder_at); assert.ok(d.data.nc.sla_escalated_at);
  assert.ok(d.data.email.some((e) => e.tipo === 'NC_SOLLECITO')); assert.ok(d.data.email.some((e) => e.tipo === 'NC_ESCALATION'));
  await pool.end();
});

test('canali LIS: push e HL7 rifiutati senza segreto', async () => {
  const p = await fetch(BASE + '/api/lis/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IdAccettazione: '1' }) });
  assert.ok([401, 503].includes(p.status));
  const { parseHl7, ack } = await import('../src/lib/hl7.js');
  const msg = 'MSH|^~\\&|STUDIOLAB|PP-FIRENZE-01|TDNC|TD|20261004120000||ORM^O01|MSG0001|P|2.5\rPID|1||RSSMRA61C12D612X^^^CF||ROSSI^MARIO||19610312|M\rORC|NW|CLI-77|26100999|||||||20261004115500\rOBR|1|CLI-77|26100999|EMO^Emocromo\rOBR|2|CLI-77|26100999|K^Potassio\r';
  const parsed = parseHl7(msg);
  assert.equal(parsed.accettazione.id, '26100999'); assert.equal(parsed.accettazione.sede_codice, 'PP-FIRENZE-01'); assert.equal(parsed.accettazione.paziente.cognome, 'ROSSI'); assert.equal(parsed.accettazione.esami.length, 2);
  assert.match(ack(parsed, true), /MSA\|AA\|MSG0001/);
});
