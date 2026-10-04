// Calcolo degli SLA in ore lavorative (lunedì-venerdì, finestra oraria configurabile, fuso Europe/Rome).
// Esempio: NC inviata venerdì alle 17:30 con SLA 24 h lavorative e finestra 08-18 -> scadenza martedì alle 15:30.

const TZ = 'Europe/Rome';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });

function romeParts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// Offset (minuti) di Roma rispetto a UTC in un dato istante
function romeOffsetMin(date) {
  const p = romeParts(date);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - date.getTime()) / 60000);
}
// Costruisce l'istante UTC corrispondente a una data/ora "di Roma"
function fromRome(y, m, d, hh, mm) {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  guess = new Date(guess.getTime() - romeOffsetMin(guess) * 60000);
  // seconda passata per i cambi d'ora
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - romeOffsetMin(guess) * 60000);
}

export function parseWindow(s) {
  const m = String(s || '08:00-18:00').match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return { start: 8 * 60, end: 18 * 60 };
  return { start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] };
}

const isWorkday = (wd) => wd >= 1 && wd <= 5;

// Aggiunge `hours` ore lavorative a `from`
export function addWorkingHours(from, hours, windowStr) {
  const { start, end } = parseWindow(windowStr);
  if (!(hours > 0)) return new Date(from);
  let remaining = hours * 60;   // minuti
  let cur = new Date(from);
  for (let guard = 0; guard < 2000; guard++) {
    const p = romeParts(cur);
    const minOfDay = p.hh * 60 + p.mm;
    if (!isWorkday(p.wd) || minOfDay >= end) {
      // vai all'inizio del prossimo giorno lavorativo
      let next = fromRome(p.y, p.m, p.d, Math.floor(start / 60), start % 60);
      next = new Date(next.getTime() + 24 * 3600 * 1000);
      let np = romeParts(next);
      while (!isWorkday(np.wd)) { next = new Date(next.getTime() + 24 * 3600 * 1000); np = romeParts(next); }
      cur = fromRome(np.y, np.m, np.d, Math.floor(start / 60), start % 60);
      continue;
    }
    if (minOfDay < start) { cur = fromRome(p.y, p.m, p.d, Math.floor(start / 60), start % 60); continue; }
    const available = end - minOfDay;
    if (remaining <= available) return new Date(cur.getTime() + remaining * 60000);
    remaining -= available;
    cur = fromRome(p.y, p.m, p.d, Math.floor(end / 60), end % 60);
  }
  return cur;
}

// Ore lavorative trascorse tra due istanti (per le statistiche)
export function workingHoursBetween(a, b, windowStr) {
  const { start, end } = parseWindow(windowStr);
  let from = new Date(a), to = new Date(b);
  if (to <= from) return 0;
  let minutes = 0;
  let cur = from;
  for (let guard = 0; guard < 5000 && cur < to; guard++) {
    const p = romeParts(cur);
    const minOfDay = p.hh * 60 + p.mm;
    const dayStart = fromRome(p.y, p.m, p.d, Math.floor(start / 60), start % 60);
    const dayEnd = fromRome(p.y, p.m, p.d, Math.floor(end / 60), end % 60);
    if (isWorkday(p.wd) && minOfDay < end) {
      const s = cur > dayStart ? cur : dayStart;
      const e = to < dayEnd ? to : dayEnd;
      if (e > s) minutes += (e - s) / 60000;
    }
    // giorno successivo alle 00:00 di Roma
    cur = fromRome(p.y, p.m, p.d, 0, 0);
    cur = new Date(cur.getTime() + 24 * 3600 * 1000);
    const np = romeParts(cur); cur = fromRome(np.y, np.m, np.d, 0, 0);
  }
  return Math.round(minutes / 6) / 10;
}
