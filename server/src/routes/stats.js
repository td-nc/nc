import { Router } from 'express';
import { many, one } from '../db.js';
import { ah } from '../lib/util.js';
import { isSede } from '../lib/access.js';
import { getSettings } from '../lib/settings.js';
import { workingHoursBetween } from '../lib/sla.js';

const r = Router();

// Statistiche: periodo (from/to), eventuale sede. Gli utenti SEDE vedono solo le proprie sedi.
r.get('/stats', ah(async (req, res) => {
  const { from, to, sede } = req.query;
  const p = [], w = ["n.stato <> 'ANNULLATA'"];
  if (isSede(req.user)) { p.push(req.user.sedi || []); w.push(`n.sede_id = ANY($${p.length}::int[])`); w.push('n.sent_at IS NOT NULL'); }
  if (sede) { p.push(Number(sede)); w.push(`n.sede_id = $${p.length}`); }
  if (from) { p.push(from); w.push(`n.opened_at >= $${p.length}::date`); }
  if (to) { p.push(to); w.push(`n.opened_at < ($${p.length}::date + 1)`); }
  const W = `WHERE ${w.join(' AND ')}`;
  const s = await getSettings();

  const totali = await one(`SELECT count(*)::int AS totale,
      count(*) FILTER (WHERE n.stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO'))::int AS aperte,
      count(*) FILTER (WHERE n.stato IN ('CHIUSA','VERIFICATA'))::int AS chiuse,
      count(*) FILTER (WHERE n.gravita='CRITICA')::int AS critiche, count(*) FILTER (WHERE n.gravita='MAGGIORE')::int AS maggiori,
      count(*) FILTER (WHERE n.ricorrente)::int AS ricorrenti,
      count(*) FILTER (WHERE n.sent_at IS NOT NULL)::int AS inviate,
      count(*) FILTER (WHERE n.first_response_at IS NOT NULL)::int AS con_risposta,
      count(*) FILTER (WHERE n.first_response_at IS NOT NULL AND n.sla_due_at IS NOT NULL AND n.first_response_at <= n.sla_due_at)::int AS risposte_in_sla,
      count(*) FILTER (WHERE n.sla_escalated_at IS NOT NULL)::int AS escalation,
      count(*) FILTER (WHERE n.rca_causa IS NOT NULL)::int AS con_rca,
      count(*) FILTER (WHERE n.verifica_esito='EFFICACE')::int AS verificate_efficaci,
      avg(EXTRACT(EPOCH FROM (n.closed_at - n.opened_at))/3600) FILTER (WHERE n.closed_at IS NOT NULL) AS ore_chiusura_media,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (n.closed_at - n.opened_at))/3600) FILTER (WHERE n.closed_at IS NOT NULL) AS ore_chiusura_mediana
    FROM nc n ${W}`, p);

  // tempo medio di risposta della sede in ore lavorative (calcolo in applicazione)
  const risposte = await many(`SELECT n.sent_at, n.first_response_at FROM nc n ${W} AND n.sent_at IS NOT NULL AND n.first_response_at IS NOT NULL`, p);
  const oreRisposta = risposte.map((x) => workingHoursBetween(x.sent_at, x.first_response_at, s.orario_lavoro));
  const mediaRisposta = oreRisposta.length ? Math.round((oreRisposta.reduce((a, b) => a + b, 0) / oreRisposta.length) * 10) / 10 : null;

  const perSede = await many(`SELECT s.id, s.nome, s.codice, s.tipo, count(*)::int AS totale,
      count(*) FILTER (WHERE n.stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO'))::int AS aperte,
      count(*) FILTER (WHERE n.gravita <> 'MINORE')::int AS rilevanti, count(*) FILTER (WHERE n.ricorrente)::int AS ricorrenti,
      count(*) FILTER (WHERE n.first_response_at IS NOT NULL AND n.first_response_at <= n.sla_due_at)::int AS in_sla,
      count(*) FILTER (WHERE n.first_response_at IS NOT NULL)::int AS con_risposta,
      (SELECT count(*)::int FROM accettazioni a WHERE a.sede_id = s.id ${from ? `AND coalesce(a.data_accettazione, a.created_at) >= $${p.indexOf(from) + 1}::date` : ''} ${to ? `AND coalesce(a.data_accettazione, a.created_at) < ($${p.indexOf(to) + 1}::date + 1)` : ''}) AS accettazioni
    FROM nc n JOIN sedi s ON s.id=n.sede_id ${W} GROUP BY s.id ORDER BY totale DESC`, p);

  const perTipo = await many(`SELECT n.macro, coalesce(t.label, coalesce(n.tipo_altro,'Altro')) AS tipo, count(*)::int AS n, count(*) FILTER (WHERE n.gravita <> 'MINORE')::int AS rilevanti
    FROM nc n LEFT JOIN nc_tipi t ON t.id=n.tipo_id ${W} GROUP BY n.macro, tipo ORDER BY n DESC`, p);
  const perMacro = await many(`SELECT n.macro, count(*)::int AS n FROM nc n ${W} GROUP BY n.macro ORDER BY n DESC`, p);
  const perGravita = await many(`SELECT n.gravita, count(*)::int AS n FROM nc n ${W} GROUP BY n.gravita`, p);
  const perStato = await many(`SELECT n.stato, count(*)::int AS n FROM nc n ${W} GROUP BY n.stato`, p);
  const perCausa = await many(`SELECT n.rca_categoria AS categoria, count(*)::int AS n FROM nc n ${W} AND n.rca_categoria IS NOT NULL GROUP BY n.rca_categoria ORDER BY n DESC`, p);
  const trend = await many(`SELECT to_char(date_trunc('month', n.opened_at), 'YYYY-MM') AS mese, count(*)::int AS n,
      count(*) FILTER (WHERE n.macro='FISICA')::int AS fisiche, count(*) FILTER (WHERE n.macro='INFORMATICA')::int AS informatiche, count(*) FILTER (WHERE n.macro='DOCUMENTALE')::int AS documentali,
      count(*) FILTER (WHERE n.gravita <> 'MINORE')::int AS rilevanti
    FROM nc n ${W} GROUP BY mese ORDER BY mese`, p);
  const perGiornoSettimana = await many(`SELECT EXTRACT(ISODOW FROM n.opened_at AT TIME ZONE 'Europe/Rome')::int AS dow, count(*)::int AS n FROM nc n ${W} GROUP BY dow ORDER BY dow`, p);
  const perOra = await many(`SELECT EXTRACT(HOUR FROM n.opened_at AT TIME ZONE 'Europe/Rome')::int AS ora, count(*)::int AS n FROM nc n ${W} GROUP BY ora ORDER BY ora`, p);
  const accTot = await one(`SELECT count(*)::int AS n FROM accettazioni a WHERE 1=1 ${isSede(req.user) ? `AND a.sede_id = ANY($1::int[])` : ''} ${sede ? `AND a.sede_id = $${p.indexOf(Number(sede)) + 1}` : ''} ${from ? `AND coalesce(a.data_accettazione, a.created_at) >= $${p.indexOf(from) + 1}::date` : ''} ${to ? `AND coalesce(a.data_accettazione, a.created_at) < ($${p.indexOf(to) + 1}::date + 1)` : ''}`, p);
  const capa = await one(`SELECT count(*)::int AS totale, count(*) FILTER (WHERE z.stato='COMPLETATA')::int AS completate, count(*) FILTER (WHERE z.stato NOT IN ('COMPLETATA','ANNULLATA') AND z.scadenza < current_date)::int AS scadute
    FROM nc_azioni z JOIN nc n ON n.id=z.nc_id ${W}`, p);

  res.json({
    periodo: { from: from || null, to: to || null }, totali: { ...totali, ore_risposta_media_lavorative: mediaRisposta, accettazioni_in_archivio: accTot.n,
      tasso_nc_per_1000: accTot.n ? Math.round((totali.totale / accTot.n) * 10000) / 10 : null,
      sla_rispetto_pct: totali.con_risposta ? Math.round((totali.risposte_in_sla / totali.con_risposta) * 1000) / 10 : null },
    perSede, perTipo, perMacro, perGravita, perStato, perCausa, trend, perGiornoSettimana, perOra, capa,
    nota_denominatore: 'Il tasso NC/1000 accettazioni usa come denominatore le accettazioni presenti in archivio td-nc (ricevute via HL7/push o richiamate dal LIS). Senza flusso completo delle accettazioni il tasso è sovrastimato.',
  });
}));

export default r;
