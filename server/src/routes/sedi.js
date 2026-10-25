import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { one, many } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireQualita, isSede } from '../lib/access.js';

const r = Router();
const TIPI = ['PUNTO_PRELIEVO', 'CENTRO_MEDICO', 'SERVICE', 'LABORATORIO', 'ALTRO'];
const cols = `s.*, coalesce(s.email_nc_override, s.email_nc) AS email_effettiva,
  (SELECT count(*)::int FROM nc n WHERE n.sede_id=s.id AND n.stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO')) AS nc_aperte,
  (SELECT count(*)::int FROM nc n WHERE n.sede_id=s.id AND n.opened_at > now() - interval '90 days' AND n.stato <> 'ANNULLATA') AS nc_90gg,
  (SELECT count(*)::int FROM users_sedi us JOIN users u ON u.id=us.user_id WHERE us.sede_id=s.id AND u.status='ACTIVE') AS n_utenti`;

// Elenco: interno completo; utente SEDE solo le proprie
r.get('/sedi', ah(async (req, res) => {
  if (isSede(req.user)) return res.json(await many(`SELECT ${cols} FROM sedi s WHERE s.id = ANY($1::int[]) ORDER BY s.nome`, [req.user.sedi || []]));
  const attive = req.query.tutte === '1' ? '' : 'WHERE s.attiva';
  res.json(await many(`SELECT ${cols} FROM sedi s ${attive} ORDER BY s.attiva DESC, s.tipo, s.nome`));
}));

const schema = z.object({
  codice: z.string().min(1).max(40), nome: z.string().min(2).max(200), tipo: z.enum(TIPI).default('SERVICE'),
  email_nc_override: z.string().max(400).nullable().optional(), email_cc: z.string().max(400).nullable().optional(),
  telefono: z.string().max(60).nullable().optional(), referente: z.string().max(160).nullable().optional(),
  indirizzo: z.string().max(200).nullable().optional(), citta: z.string().max(120).nullable().optional(),
  sla_ore: z.number().int().min(1).max(240).nullable().optional(), attiva: z.boolean().optional(), note: z.string().max(2000).nullable().optional(),
});

r.post('/sedi', requireQualita, ah(async (req, res) => {
  const b = parse(schema, req.body);
  if (await one('SELECT 1 FROM sedi WHERE lower(codice)=lower($1)', [b.codice])) throw bad('Esiste già una sede con questo codice');
  const s = await one(
    `INSERT INTO sedi (codice, nome, tipo, email_nc_override, email_cc, telefono, referente, indirizzo, citta, sla_ore, attiva, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [b.codice.trim(), b.nome, b.tipo, b.email_nc_override || null, b.email_cc || null, b.telefono || null, b.referente || null, b.indirizzo || null, b.citta || null, b.sla_ore ?? null, b.attiva ?? true, b.note || null]);
  await audit(req, 'SEDE_CREATED', { entity: 'sede', entityId: s.id, label: `${s.nome} (${s.codice})` });
  res.status(201).json(s);
}));

r.put('/sedi/:id', requireQualita, ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(schema.partial(), req.body);
  const cur = await one('SELECT * FROM sedi WHERE id=$1', [id]);
  if (!cur) throw notFound('Sede non trovata');
  if (b.codice && b.codice.toLowerCase() !== cur.codice.toLowerCase() && await one('SELECT 1 FROM sedi WHERE lower(codice)=lower($1)', [b.codice])) throw bad('Codice già in uso');
  const s = await one(
    `UPDATE sedi SET codice=coalesce($2,codice), nome=coalesce($3,nome), tipo=coalesce($4,tipo), email_nc_override=$5, email_cc=$6, telefono=$7, referente=$8, indirizzo=$9, citta=$10, sla_ore=$11, attiva=coalesce($12,attiva), note=$13, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, b.codice?.trim() ?? null, b.nome ?? null, b.tipo ?? null, 'email_nc_override' in b ? (b.email_nc_override || null) : cur.email_nc_override, 'email_cc' in b ? (b.email_cc || null) : cur.email_cc,
      'telefono' in b ? (b.telefono || null) : cur.telefono, 'referente' in b ? (b.referente || null) : cur.referente, 'indirizzo' in b ? (b.indirizzo || null) : cur.indirizzo, 'citta' in b ? (b.citta || null) : cur.citta,
      'sla_ore' in b ? (b.sla_ore ?? null) : cur.sla_ore, b.attiva ?? null, 'note' in b ? (b.note || null) : cur.note]);
  await audit(req, 'SEDE_UPDATED', { entity: 'sede', entityId: id, label: `${s.nome} (${s.codice})`, data: b });
  res.json(s);
}));

// Esportazione XLSX dell'anagrafica sedi (stesse colonne della tabella + contatti e note). Importabile di nuovo: le intestazioni
// CodiceCliente / RagSoc / TipoCliente / email / Telefono1 / PersonaDiRiferimento / Indirizzo / Cap / Citta / Provincia sono quelle di StudioLAB.
r.get('/sedi/export.xlsx', requireQualita, ah(async (req, res) => {
  const rows = await many(`SELECT ${cols} FROM sedi s ${req.query.tutte === '1' ? '' : 'WHERE s.attiva'} ORDER BY s.attiva DESC, s.tipo, s.nome`);
  const wb = new ExcelJS.Workbook(); wb.creator = 'td-nc · Toscana Diagnostica';
  const ws = wb.addWorksheet('Sedi invianti', { views: [{ state: 'frozen', ySplit: 1 }] });
  const TIPO = { PUNTO_PRELIEVO: 'Punto Prelievi', CENTRO_MEDICO: 'Centro Medico', SERVICE: 'Service', LABORATORIO: 'Laboratorio', ALTRO: 'Altro' };
  ws.columns = [
    { header: 'CodiceCliente', key: 'codice', width: 14 }, { header: 'RagSoc', key: 'nome', width: 44 }, { header: 'TipoCliente', key: 'tipo', width: 16 },
    { header: 'email', key: 'email_nc', width: 34 }, { header: 'Email NC override', key: 'email_nc_override', width: 34 }, { header: 'Email effettiva', key: 'email_effettiva', width: 34 }, { header: 'Email CC', key: 'email_cc', width: 30 },
    { header: 'Telefono1', key: 'telefono', width: 18 }, { header: 'PersonaDiRiferimento', key: 'referente', width: 26 }, { header: 'Indirizzo', key: 'indirizzo', width: 30 }, { header: 'Citta', key: 'citta', width: 26 },
    { header: 'SLA ore', key: 'sla_ore', width: 9 }, { header: 'Attiva', key: 'attiva', width: 8 }, { header: 'NC aperte', key: 'nc_aperte', width: 10 }, { header: 'NC 90 gg', key: 'nc_90gg', width: 10 }, { header: 'Utenti', key: 'n_utenti', width: 8 },
    { header: 'Note', key: 'note', width: 40 }, { header: 'Ultimo import LIS', key: 'lis_synced_at', width: 18 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF01212C' } };
  for (const r2 of rows) ws.addRow({ ...r2, tipo: TIPO[r2.tipo] || r2.tipo, attiva: r2.attiva ? 'Sì' : 'No', sla_ore: r2.sla_ore ?? '', lis_synced_at: r2.lis_synced_at ? new Date(r2.lis_synced_at) : null });
  ws.getColumn('lis_synced_at').numFmt = 'dd/mm/yyyy hh:mm';
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + ws.columns.length)}1` };
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="td-nc_sedi_${new Date().toISOString().slice(0, 10)}.xlsx"` });
  await audit(req, 'SEDI_EXPORTED', { entity: 'sede', label: `${rows.length} sedi esportate` });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

// Eliminazione: solo se la sede non ha non conformità. Le accettazioni in archivio perdono il riferimento (sede da riassegnare),
// gli utenti di sede perdono l'associazione. Con NC presenti si usa la disattivazione, per non rompere lo storico e le statistiche.
r.delete('/sedi/:id', requireQualita, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one('SELECT * FROM sedi WHERE id=$1', [id]);
  if (!cur) throw notFound('Sede non trovata');
  if (cur.tipo === 'LABORATORIO' && cur.codice === 'LAB-SESTO') throw bad('La sede interna del laboratorio non si elimina');
  const n = await one('SELECT count(*)::int AS n FROM nc WHERE sede_id=$1', [id]);
  if (n.n > 0) throw bad(`La sede ha ${n.n} non conformità in archivio: va disattivata, non eliminata`);
  const acc = await one('SELECT count(*)::int AS n FROM accettazioni WHERE sede_id=$1', [id]);
  await one('UPDATE accettazioni SET sede_id=NULL, updated_at=now() WHERE sede_id=$1 RETURNING 1', [id]).catch(() => null);
  await one('DELETE FROM sedi WHERE id=$1 RETURNING id', [id]);
  await audit(req, 'SEDE_DELETED', { entity: 'sede', entityId: id, label: `${cur.nome} (${cur.codice})${acc.n ? ` · ${acc.n} accettazioni senza sede` : ''}` });
  res.json({ ok: true, accettazioni_scollegate: acc.n });
}));

// ---- import anagrafica clienti da StudioLAB (esportazione Excel "Elenco clienti")
// Colonne riconosciute (intestazioni StudioLAB): CodiceCliente, CodiceClienteFatturazione, RagSoc, PersonaDiRiferimento, Indirizzo, Cap, Citta,
// Provincia, Telefono1, Telefono2, email, TipoCliente. Crea le sedi nuove e aggiorna nome/contatti di quelle esistenti senza toccare
// email_nc_override, email_cc, SLA e stato attiva (campi gestiti in td-nc).
const TIPO_MAP = (t) => { const x = (t || '').toLowerCase(); if (x.includes('prelie')) return 'PUNTO_PRELIEVO'; if (x.includes('centro')) return 'CENTRO_MEDICO'; if (x.includes('interna')) return 'LABORATORIO'; return 'SERVICE'; };
const firstEmail = (v) => { const m = String(v || '').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g); return m ? m[0].toLowerCase() : null; };
const str = (v) => (v == null ? '' : typeof v === 'object' && v.text != null ? String(v.text) : String(v)).trim();
export function parseClientiXlsx(ws) {
  const head = {}; ws.getRow(1).eachCell((c, i) => { head[str(c.value).toLowerCase()] = i; });
  const col = (row, ...names) => { for (const n of names) { const i = head[n.toLowerCase()]; if (i) return str(row.getCell(i).value); } return ''; };
  if (!head.codicecliente || !head.ragsoc) throw bad('Formato non riconosciuto: servono le colonne CodiceCliente e RagSoc dell\'esportazione StudioLAB');
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const codice = col(row, 'CodiceCliente'); if (!codice) return;
    const cap = col(row, 'Cap'), citta = col(row, 'Citta'), prov = col(row, 'Provincia');
    const capogruppo = col(row, 'CodiceClienteFatturazione');
    out.push({
      codice, nome: col(row, 'RagSoc') || codice, tipo: TIPO_MAP(col(row, 'TipoCliente')), email_nc: firstEmail(col(row, 'email', 'Email', 'EmailNonConformita')),
      telefono: [col(row, 'Telefono1'), col(row, 'Telefono2')].filter(Boolean).join(' / ') || null, referente: col(row, 'PersonaDiRiferimento') || null,
      indirizzo: col(row, 'Indirizzo') || null, citta: [cap, citta, prov ? `(${prov})` : ''].filter(Boolean).join(' ') || null,
      capogruppo: capogruppo && capogruppo !== codice ? capogruppo : null, raw: Object.fromEntries(Object.entries(head).map(([k, i]) => [k, str(row.getCell(i).value)])),
    });
  });
  return out;
}

r.post('/sedi/import', requireQualita, ah(async (req, res) => {
  const b = parse(z.object({ base64: z.string().min(10), disattiva_mancanti: z.boolean().optional().default(false) }), req.body);
  const buf = Buffer.from(b.base64, 'base64');
  if (buf.length > 5 * 1024 * 1024) throw bad('File troppo grande (max 5 MB)');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw bad('Il file non è un Excel valido (.xlsx)'); }
  const ws = wb.worksheets[0]; if (!ws) throw bad('Foglio vuoto');
  const rows = parseClientiXlsx(ws);
  const esito = { create: 0, aggiornate: 0, saltate: [], senza_email: 0, totale: rows.length };
  const byCode = new Map(rows.map((x) => [x.codice.toLowerCase(), x]));
  for (const x of rows) {
    if (/^prova$/i.test(x.codice) || /^prova$/i.test(x.nome)) { esito.saltate.push(`${x.codice} (record di prova)`); continue; }
    const padre = x.capogruppo ? byCode.get(x.capogruppo.toLowerCase()) : null;
    // sede figlia senza contatti: eredita email e telefono della capogruppo (es. reparti di una casa di cura)
    const email = x.email_nc || padre?.email_nc || null, tel = x.telefono || padre?.telefono || null;
    const note = x.capogruppo ? `Fatturazione a ${x.capogruppo}${padre ? ` (${padre.nome})` : ''}` : null;
    if (!email) esito.senza_email++;
    const cur = await one('SELECT id FROM sedi WHERE lower(codice)=lower($1)', [x.codice]);
    if (cur) {
      await one(`UPDATE sedi SET nome=$2, tipo=$3, email_nc=$4, telefono=coalesce($5, telefono), referente=coalesce($6, referente), indirizzo=coalesce($7, indirizzo), citta=coalesce($8, citta),
        note=coalesce(note, $9), lis_json=$10, lis_synced_at=now(), updated_at=now() WHERE id=$1 RETURNING id`, [cur.id, x.nome, x.tipo, email, tel, x.referente, x.indirizzo, x.citta, note, JSON.stringify(x.raw)]);
      esito.aggiornate++;
    } else {
      await one(`INSERT INTO sedi (codice, nome, tipo, email_nc, telefono, referente, indirizzo, citta, note, lis_json, lis_synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING id`,
        [x.codice, x.nome, x.tipo, email, tel, x.referente, x.indirizzo, x.citta, note, JSON.stringify(x.raw)]);
      esito.create++;
    }
  }
  if (b.disattiva_mancanti) {
    const r2 = await many(`UPDATE sedi SET attiva=false, updated_at=now() WHERE attiva AND tipo <> 'LABORATORIO' AND lower(codice) <> ALL($1::text[]) RETURNING codice`, [[...byCode.keys()]]);
    esito.disattivate = r2.map((s) => s.codice);
  }
  await audit(req, 'SEDI_IMPORTED', { entity: 'sede', label: `import StudioLAB: ${esito.create} create, ${esito.aggiornate} aggiornate, ${esito.saltate.length} saltate` });
  res.json(esito);
}));

export default r;
