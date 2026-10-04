// Rapporto di Non Conformità in PDF (fascicolo della NC, allegabile all'accettazione su StudioLAB)
// ed export XLSX dell'elenco NC per la Qualità / il riesame della direzione.
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { many } from '../db.js';
import { STATO_LABEL } from './nc.js';
import { MACRO, GRAVITA } from './mail.js';

const TEAL = '#1C505E', JET = '#01212C', BLUE = '#71B1BD', MUTED = '#5b6f75', LINE = '#dbe5e7';
const itDT = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '–');
const itD = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '–');
const TRATT = { CONSERVAZIONE: 'Conservazione in attesa di decisione', NUOVO_CAMPIONE: 'Richiesto nuovo campione', INTEGRAZIONE_DOCUMENTALE: 'Integrazione documentale', ACCETTAZIONE_LIS: 'Regolarizzazione accettazione LIS', DEROGA: 'Accettato in deroga (con nota sul referto)', ANNULLAMENTO_ESAMI: 'Esami annullati', ALTRO: 'Altro' };
const RCA_CAT = { PRELIEVO: 'Prelievo', IDENTIFICAZIONE: 'Identificazione', TRASPORTO: 'Trasporto', CONSERVAZIONE: 'Conservazione', LIS: 'Sistema informatico', DOCUMENTAZIONE: 'Documentazione', FORMAZIONE: 'Formazione', MATERIALI: 'Materiali', ORGANIZZAZIONE: 'Organizzazione', ALTRO: 'Altro' };
const MSG_TIPO = { APERTURA: 'Apertura', RICHIESTA: 'Richiesta del laboratorio', RISPOSTA: 'Risposta della sede', CHIARIMENTO: 'Chiarimento', TRATTAMENTO: 'Trattamento', CHIUSURA: 'Chiusura', RIAPERTURA: 'Riapertura', NOTA_INTERNA: 'Nota interna', SISTEMA: 'Sistema' };

export async function rapportoPdf(nc, { messaggi, azioni, settings, includiNoteInterne = true }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Rapporto di non conformità ${nc.codice}`, Author: settings.lab_nome } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = doc.page.width - 96;

  // intestazione
  doc.rect(0, 0, doc.page.width, 86).fill(JET);
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(8.5).text('TOSCANA DIAGNOSTICA · LABORATORIO DI ANALISI', 48, 26, { characterSpacing: 1.5 });
  doc.fillColor('#fff').fontSize(18).text(`Rapporto di non conformità ${nc.codice}`, 48, 42);
  doc.fillColor('#cfe3e7').font('Helvetica').fontSize(9).text(`${settings.lab_indirizzo} · ${settings.lab_email}`, 48, 66);
  doc.moveDown(); doc.y = 104; doc.fillColor(JET);

  const section = (title) => { doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEAL).text(title.toUpperCase(), { characterSpacing: 1 }); doc.moveTo(48, doc.y + 2).lineTo(48 + W, doc.y + 2).strokeColor(LINE).lineWidth(0.8).stroke(); doc.moveDown(0.4); doc.fillColor(JET); };
  const kv = (rows) => {
    for (const [k, v] of rows) {
      if (v == null || v === '') continue;
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, 48, y, { width: 150 });
      doc.font('Helvetica').fontSize(10).fillColor(JET).text(String(v), 205, y, { width: W - 157 });
      doc.y = Math.max(doc.y, y + 14); doc.moveDown(0.15);
    }
  };

  section('Identificazione');
  kv([['Codice NC', nc.codice], ['Stato', STATO_LABEL[nc.stato]], ['Accettazione', `${nc.accettazione_id}${nc.id_richiesta_cliente ? ` (rif. cliente ${nc.id_richiesta_cliente})` : ''}`], ['Data accettazione', itDT(nc.data_accettazione)],
    ['Sede inviante', `${nc.sede_nome} (${nc.sede_codice})`], ['Paziente', [nc.paziente_cognome, nc.paziente_nome].filter(Boolean).join(' ') + (nc.paziente_nascita ? ` · nato/a il ${itD(nc.paziente_nascita)}` : '')],
    ['Esami coinvolti', (nc.esami_coinvolti || []).map((e) => `${e.cod}${e.descrizione ? ` ${e.descrizione}` : ''}`).join('; ') || 'Tutti gli esami dell\'accettazione'],
    ['Rilevata da', `${nc.opened_by_name || '–'} · ${itDT(nc.opened_at)}`]]);

  section('1 · Rilevazione');
  kv([['Macro-area', MACRO[nc.macro]], ['Tipologia', nc.tipo_label || '–'], ['Specifica', nc.tipo_altro], ['Gravità', GRAVITA[nc.gravita] + (nc.ricorrente ? ' · RICORRENTE' : '')], ['Descrizione', nc.descrizione], ['Azione attesa dalla sede', nc.azione_attesa],
    ['Campione bloccato', nc.campione_bloccato ? 'Sì' : 'No'], ['Blocco esami su LIS', nc.blocco_lis ? `Sì · ${nc.blocco_lis_esito || ''}` : (nc.blocco_lis_esito || 'No')]]);

  section('2 · Trattamento immediato');
  kv([['Trattamento', TRATT[nc.trattamento_tipo] || (nc.trattamento_tipo ? nc.trattamento_tipo : 'Non ancora definito')], ['Conservazione', nc.conservazione], ['Note', nc.trattamento_note], ['Inviata alla sede', itDT(nc.sent_at)], ['Prima risposta della sede', itDT(nc.first_response_at)], ['Scadenza risposta (SLA)', itDT(nc.sla_due_at)]]);

  section('3 · Analisi della causa radice');
  kv([['Richiesta', nc.rca_richiesta ? 'Sì' : 'No (NC minore non ricorrente)'], ['Metodo', nc.rca_metodo], ['Categoria causa', RCA_CAT[nc.rca_categoria] || nc.rca_categoria], ['Causa radice', nc.rca_causa]]);

  section('4 · Azioni correttive e preventive');
  if (!azioni.length) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Nessuna azione pianificata.');
  for (const a of azioni) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(JET).text(`${a.tipo === 'CORRETTIVA' ? 'Correttiva' : 'Preventiva'} · ${a.stato.replace('_', ' ').toLowerCase()}${a.scadenza ? ` · scadenza ${itD(a.scadenza)}` : ''}${a.responsabile ? ` · ${a.responsabile}` : ''}`);
    doc.font('Helvetica').fontSize(10).text(a.descrizione, { width: W });
    if (a.note) doc.fillColor(MUTED).fontSize(9).text(a.note, { width: W }).fillColor(JET);
    doc.moveDown(0.3);
  }

  section('5 · Chiusura e verifica dell\'efficacia');
  kv([['Chiusa da', nc.closed_at ? `${nc.closed_by_name || '–'} · ${itDT(nc.closed_at)}` : 'Non ancora chiusa'], ['Esito', nc.esito_chiusura], ['Verifica efficacia', nc.verifica_esito ? `${nc.verifica_esito.replace('_', ' ')} · ${itDT(nc.verifica_at)}` : '–'], ['Note verifica', nc.verifica_note]]);

  section('Comunicazioni');
  for (const m of messaggi) {
    if (!includiNoteInterne && m.direzione === 'INTERNO' && m.tipo !== 'SISTEMA') continue;
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEAL).text(`${itDT(m.created_at)} · ${MSG_TIPO[m.tipo] || m.tipo} · ${m.user_name || m.contatto_nome || 'sistema'}${m.contatto_email ? ` (${m.contatto_email}${m.contatto_tel ? `, ${m.contatto_tel}` : ''})` : ''}${m.azione_eseguita ? ' · azione eseguita' : ''}`);
    doc.font('Helvetica').fontSize(9.5).fillColor(JET).text(m.testo, { width: W });
    doc.moveDown(0.35);
  }

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Documento generato il ${itDT(new Date())} dal sistema td-nc · Gestione delle non conformità pre-analitiche · ISO 15189:2022 §7.5, ISO 9001:2015 §8.7 / §10.2. Contiene dati personali: conservare nel fascicolo del caso.`, { width: W });
  doc.end();
  return done;
}

export async function exportXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'td-nc · Toscana Diagnostica';
  const ws = wb.addWorksheet('Non conformità', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Codice', key: 'codice', width: 14 }, { header: 'Stato', key: 'stato', width: 20 }, { header: 'Aperta il', key: 'opened_at', width: 16 }, { header: 'Accettazione', key: 'accettazione_id', width: 14 },
    { header: 'Sede', key: 'sede_nome', width: 28 }, { header: 'Codice sede', key: 'sede_codice', width: 12 }, { header: 'Tipo sede', key: 'sede_tipo', width: 16 },
    { header: 'Macro-area', key: 'macro', width: 16 }, { header: 'Tipologia', key: 'tipo_label', width: 30 }, { header: 'Gravità', key: 'gravita', width: 10 }, { header: 'Ricorrente', key: 'ricorrente', width: 10 },
    { header: 'Esami', key: 'esami', width: 24 }, { header: 'Descrizione', key: 'descrizione', width: 50 }, { header: 'Azione attesa', key: 'azione_attesa', width: 40 },
    { header: 'Inviata alla sede', key: 'sent_at', width: 16 }, { header: 'Scadenza SLA', key: 'sla_due_at', width: 16 }, { header: 'Prima risposta', key: 'first_response_at', width: 16 }, { header: 'Ore lavorative risposta', key: 'ore_risposta', width: 12 },
    { header: 'Trattamento', key: 'trattamento_tipo', width: 22 }, { header: 'RCA categoria', key: 'rca_categoria', width: 16 }, { header: 'Causa radice', key: 'rca_causa', width: 40 },
    { header: 'Chiusa il', key: 'closed_at', width: 16 }, { header: 'Esito', key: 'esito_chiusura', width: 40 }, { header: 'Verifica efficacia', key: 'verifica_esito', width: 16 }, { header: 'Rilevata da', key: 'opened_by_name', width: 22 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF01212C' } };
  for (const r of rows) {
    ws.addRow({ ...r, stato: STATO_LABEL[r.stato] || r.stato, macro: MACRO[r.macro] || r.macro, gravita: GRAVITA[r.gravita] || r.gravita, ricorrente: r.ricorrente ? 'Sì' : 'No',
      esami: (r.esami_coinvolti || []).map((e) => e.cod).join(', '), opened_at: r.opened_at ? new Date(r.opened_at) : null, sent_at: r.sent_at ? new Date(r.sent_at) : null,
      sla_due_at: r.sla_due_at ? new Date(r.sla_due_at) : null, first_response_at: r.first_response_at ? new Date(r.first_response_at) : null, closed_at: r.closed_at ? new Date(r.closed_at) : null,
      trattamento_tipo: TRATT[r.trattamento_tipo] || r.trattamento_tipo || '', rca_categoria: RCA_CAT[r.rca_categoria] || r.rca_categoria || '', verifica_esito: r.verifica_esito ? r.verifica_esito.replace('_', ' ') : '' });
  }
  for (const k of ['opened_at', 'sent_at', 'sla_due_at', 'first_response_at', 'closed_at']) ws.getColumn(k).numFmt = 'dd/mm/yyyy hh:mm';
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + ws.columns.length)}1` };
  return wb.xlsx.writeBuffer();
}

export const listForExport = (where, params) => many(`SELECT n.*, s.nome AS sede_nome, s.codice AS sede_codice, s.tipo AS sede_tipo, t.label AS tipo_label, uo.full_name AS opened_by_name
  FROM nc n JOIN sedi s ON s.id=n.sede_id LEFT JOIN nc_tipi t ON t.id=n.tipo_id LEFT JOIN users uo ON uo.id=n.opened_by ${where} ORDER BY n.opened_at DESC`, params);
