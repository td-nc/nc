// Finto nodo ServiceNET per i test: replica le risposte osservate sul nodo di produzione (WebApi 10.3.2.0)
import http from 'node:http';
const KEY = process.env.LIS_API_KEY || 'test-key';
export const calls = [];
export function startMockLis(port = 3999) {
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'); const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : null });
      if (req.headers['x-api-key'] !== KEY) return json(401, { Message: 'Authorization has been denied for this request.' });
      if (u.pathname === '/api') return json(200, { Result: 'ServiceNET WebApi server ready!', Version: '10.3.2.0' });
      if (u.pathname === '/api/whoami') return json(200, { Result: 'You are authenticated!', CodiceServiceNet: 'GIPONEXT' });
      if (u.pathname === '/api/esami') return u.searchParams.get('CodiceCliente') === 'TD' ? json(400, { ErrorMessage: 'Codice cliente non valido' }) : json(200, [{ CodEsame: 'EMO' }]);
      if (u.pathname === '/api/accettazioni' && req.method === 'GET') {
        const id = u.searchParams.get('id');
        if (id !== 'LIS-2026-500') return json(400, { Message: `Accettazione ${id} non trovata.` });
        return json(200, { IdAccettazione: id, IdRichiestaCliente: 'RC-9', DataAccettazione: '2026-10-20T08:15:00', StatoAvanzamento: 10,
          Paziente: { IdAnagrafica: 'A1', Cognome: 'ROSSI', Nome: 'MARIO', Sesso: 'M', DataNascita: '1970-05-04T00:00:00', CodiceFiscale: 'RSSMRA70E04D612Q' },
          Esami: [{ FillerId: 1, PlacerId: 'P1', CodEsame: 'EMO', Descrizione: 'Emocromo', StatoAvanzamento: 10, Bloccato: false }, { FillerId: 2, PlacerId: 'P2', CodEsame: 'GLU', Descrizione: 'Glucosio', StatoAvanzamento: 10, Bloccato: false }],
          Referti: [], Allegati: [], Fatture: [] });
      }
      if (u.pathname === '/api/accettazioni/segnalazioni' && req.method === 'POST') return json(200, '4711');
      if (/\/api\/accettazioni\/.+\/segnalazioni\/\d+\/(commenti|presa-in-carico|risolto)$/.test(u.pathname)) return json(200, {});
      if (/\/esami\/(blocca|sblocca)$/.test(u.pathname)) return json(200, { Esito: true });
      if (u.pathname === '/api/accettazioni/allegati') return json(200, { Esito: true, Id: 'ALL-1' });
      json(404, { Message: 'not mocked: ' + u.pathname });
    });
  });
  return new Promise((ok) => srv.listen(port, () => ok(srv)));
}
if (process.argv[1] && process.argv[1].endsWith('mock-lis.mjs')) startMockLis(Number(process.env.MOCK_LIS_PORT || 3999)).then(() => console.log('mock LIS on', process.env.MOCK_LIS_PORT || 3999));
