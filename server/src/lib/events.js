// Eventi in tempo reale (Server-Sent Events). Un'unica istanza applicativa: bus in memoria.
// Gli utenti SEDE ricevono solo gli eventi delle proprie sedi.
const clients = new Set();

export function publish(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    if (c.user?.role === 'SEDE' && event.sedeId != null && !(c.user.sedi || []).includes(event.sedeId)) continue;
    if (c.user?.role === 'SEDE' && event.type === 'acc.updated') continue;
    try { c.res.write(payload); } catch { clients.delete(c); }
  }
}

export function sseHandler(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write('retry: 3000\n');
  res.write(`data: ${JSON.stringify({ type: 'hello', at: new Date().toISOString() })}\n\n`);
  const c = { res, user: req.user };
  clients.add(c);
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* chiuso */ } }, 25000);
  req.on('close', () => { clearInterval(hb); clients.delete(c); });
}

export const clientCount = () => clients.size;
