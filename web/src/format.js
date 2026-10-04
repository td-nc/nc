export const itDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d) ? '' : d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }); };
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const ROLE = { ADMIN: 'Amministratore', QUALITA: 'Qualità (RSQ)', LAB: 'Laboratorio', SEDE: 'Sede inviante', VIEWER: 'Sola lettura' };
export const USTATUS = { ACTIVE: { label: 'Attivo', tone: 'green' }, PENDING: { label: 'In attesa di abilitazione', tone: 'mauve' }, DISABLED: { label: 'Disabilitato', tone: 'grey' } };
export const AUTH = { ENTRA: 'Microsoft 365', LOCAL: 'Email e password', BOTH: 'Microsoft 365 o password' };
export const STATO = {
  APERTA: { label: 'Aperta', tone: 'blue' }, INVIATA_SEDE: { label: 'In attesa della sede', tone: 'mauve' }, RISPOSTA_SEDE: { label: 'Risposta da gestire', tone: 'yellow' },
  IN_TRATTAMENTO: { label: 'In trattamento', tone: 'teal' }, CHIUSA: { label: 'Chiusa', tone: 'green' }, VERIFICATA: { label: 'Verificata', tone: 'green' }, ANNULLATA: { label: 'Annullata', tone: 'grey' },
};
export const STATO_SEDE = { ...STATO, INVIATA_SEDE: { label: 'Da rispondere', tone: 'yellow' }, RISPOSTA_SEDE: { label: 'In valutazione al laboratorio', tone: 'mauve' } };
export const APERTE = ['APERTA', 'INVIATA_SEDE', 'RISPOSTA_SEDE', 'IN_TRATTAMENTO'];
export const MACRO = { FISICA: { label: 'Fisica / biologica', sub: 'Emolisi, coaguli, volume, provetta, deterioramento' }, INFORMATICA: { label: 'Informatica / LIS', sub: 'Accettazione non trasmessa, ordine incoerente, anagrafica' }, DOCUMENTALE: { label: 'Documentale', sub: 'Consensi, moduli, schede cliniche, firme' } };
export const GRAVITA = { MINORE: 'Minore', MAGGIORE: 'Maggiore', CRITICA: 'Critica' };
export const GRAVITA_HELP = { MINORE: 'Non compromette il risultato se corretta: si risolve con la sede, RCA facoltativa.', MAGGIORE: 'Impedisce l\'esecuzione o ritarda il referto: RCA obbligatoria.', CRITICA: 'Rischio per il paziente (identificazione, valenza medico-legale): RCA obbligatoria e segnalazione alla Qualità.' };
export const TRATT = { CONSERVAZIONE: 'Conservazione in attesa di decisione', NUOVO_CAMPIONE: 'Richiesto nuovo campione', INTEGRAZIONE_DOCUMENTALE: 'Integrazione documentale', ACCETTAZIONE_LIS: 'Regolarizzazione accettazione LIS', DEROGA: 'Accettato in deroga (nota sul referto)', ANNULLAMENTO_ESAMI: 'Esami annullati', ALTRO: 'Altro' };
export const RCA_CAT = { PRELIEVO: 'Prelievo', IDENTIFICAZIONE: 'Identificazione', TRASPORTO: 'Trasporto', CONSERVAZIONE: 'Conservazione', LIS: 'Sistema informatico', DOCUMENTAZIONE: 'Documentazione', FORMAZIONE: 'Formazione', MATERIALI: 'Materiali', ORGANIZZAZIONE: 'Organizzazione', ALTRO: 'Altro' };
export const AZ_STATO = { PIANIFICATA: { label: 'Pianificata', tone: 'grey' }, IN_CORSO: { label: 'In corso', tone: 'blue' }, COMPLETATA: { label: 'Completata', tone: 'green' }, ANNULLATA: { label: 'Annullata', tone: 'grey' } };
export const MSG_TIPO = { APERTURA: 'Apertura', RICHIESTA: 'Richiesta del laboratorio', RISPOSTA: 'Risposta della sede', CHIARIMENTO: 'Chiarimento', TRATTAMENTO: 'Trattamento', CHIUSURA: 'Chiusura', RIAPERTURA: 'Riapertura', NOTA_INTERNA: 'Nota interna', SISTEMA: 'Sistema' };
export const SEDE_TIPO = { PUNTO_PRELIEVO: 'Punto prelievo', CENTRO_MEDICO: 'Centro medico', SERVICE: 'Cliente Service', LABORATORIO: 'Laboratorio', ALTRO: 'Altro' };
export const STATO_LIS = { 0: 'Prenotato', 10: 'In lavorazione', 20: 'Refertazione', 25: 'Refertato parziale', 40: 'Chiuso' };
export const slaClass = (nc) => { if (!nc.sla_due_at || nc.stato !== 'INVIATA_SEDE') return ''; const d = new Date(nc.sla_due_at) - Date.now(); return d < 0 ? 'sla-late' : d < 4 * 3600e3 ? 'sla-soon' : 'sla-ok'; };
export const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const fileToB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
