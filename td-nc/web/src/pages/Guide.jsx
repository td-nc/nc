import React from 'react';
import { useAuth, isSede } from '../auth.jsx';
import { Card } from '../components/ui.jsx';

export default function Guide() {
  const { user } = useAuth();
  if (isSede(user)) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Guida per le sedi</h1><div className="sub">Come rispondere a una non conformità in due minuti.</div></div></div>
        <div className="grid g2">
          <Card title="Cosa succede"><p>Quando il laboratorio rileva un problema su un campione inviato dalla vostra sede (emolisi, provetta errata, accettazione non trasmessa, consenso mancante…) il campione viene <b>bloccato</b> e ricevete un'email con un pulsante. Il pulsante apre questa applicazione: accedete con le credenziali fornite da Toscana Diagnostica.</p><p>L'email non contiene dati del paziente: li vedete qui, dopo l'accesso.</p></Card>
          <Card title="Come rispondere"><p>Nella pagina della non conformità leggete la <b>descrizione</b> e l'<b>azione attesa</b>. Eseguite l'azione (nuovo prelievo, invio del documento, correzione dell'accettazione) oppure chiedete un chiarimento. Poi scrivete la risposta indicando <b>nome, email e telefono</b> di chi l'ha gestita e, se avete eseguito l'azione, spuntate la conferma. Potete allegare foto o documenti.</p><p>Il laboratorio riceve subito la notifica e, se tutto è a posto, chiude la NC: ricevete un'email di chiusura.</p></Card>
          <Card title="I tempi"><p>Ogni NC ha una <b>scadenza di risposta</b> in ore lavorative. Alla scadenza ricevete un sollecito automatico; se la sede non risponde, il laboratorio vi contatta telefonicamente e decide autonomamente il trattamento del campione (nel peggiore dei casi l'annullamento degli esami).</p></Card>
          <Card title="Statistiche"><p>Nella sezione Statistiche vedete l'andamento delle NC delle vostre sedi per tipologia e nel tempo: è lo strumento per migliorare insieme la fase pre-analitica (tecnica di prelievo, trasporto, modulistica).</p></Card>
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1>Guida all'uso</h1><div className="sub">Il processo in cinque fasi e come si lavora in td-nc.</div></div></div>
      <div className="grid g2">
        <Card title="1 · Rilevazione e blocco (desk preanalitica)"><p>Nel <b>Desk accettazioni</b> leggi il barcode o digita il numero: vedi sede inviante, paziente, esami, stato LIS e NC già aperte. <b>Nuova NC</b>: scegli macro-area e tipologia (il catalogo propone gravità e azione attesa), seleziona gli esami coinvolti, descrivi, allega la foto, conferma. La NC riceve un codice progressivo (NC-anno-numero) e parte l'email alla sede con lo SLA. Se l'accettazione non è in archivio puoi registrarla a mano.</p><p>Apporre comunque il cartellino "Materiale non conforme" sul campione e conservarlo come previsto.</p></Card>
        <Card title="2 · Trattamento immediato"><p>Decidi cosa fare del campione: conservazione in attesa, richiesta di nuovo campione, integrazione documentale, regolarizzazione dell'accettazione, deroga con nota sul referto, annullamento degli esami. Registra dove e come è conservato.</p><p>Quando la sede risponde, la NC compare come <b>Risposta da gestire</b> (badge giallo nel menu). Puoi scrivere ancora alla sede (richiesta con nuovo SLA, chiarimento) oppure procedere.</p></Card>
        <Card title="3 · Analisi della causa radice"><p>Obbligatoria per NC <b>maggiori</b> e <b>critiche</b> e per le <b>ricorrenti</b> (stessa tipologia e sede oltre la soglia in 90 giorni). Metodo (5 perché, Ishikawa), categoria della causa e descrizione: perché è successo, non cosa.</p></Card>
        <Card title="4 · Azioni correttive e preventive"><p>Pianifica le azioni con responsabile e scadenza: formazione, affiancamento, istruzione operativa, blocco software sull'accettazione, modifica della modulistica. Segna il completamento. Le azioni scadute compaiono nelle statistiche.</p></Card>
        <Card title="5 · Chiusura e verifica dell'efficacia"><p>Chiudi la NC con l'esito sul caso clinico (nuovo campione processato, esame annullato…): la sede riceve la notifica, gli esami possono essere sbloccati sul LIS e il rapporto PDF allegato all'accettazione. La <b>Qualità</b> registra poi la verifica di efficacia: se le azioni non hanno funzionato, la NC si riapre.</p></Card>
        <Card title="Profili e regole"><p><b>Laboratorio</b> rileva, tratta, dialoga e chiude. <b>Qualità</b> in più gestisce RCA/CAPA/verifica, catalogo, sedi, accessi delle sedi, impostazioni. <b>Amministratore</b> gestisce anche gli utenti interni e le integrazioni. <b>Sede</b> vede e risponde solo alle NC delle proprie sedi.</p><p>Nessun dato del paziente viaggia via email. Tutto è tracciato nel registro attività. Il rapporto PDF è il documento di registrazione ISO 15189 §7.5 / ISO 9001 §8.7 e §10.2.</p></Card>
      </div>
    </div>
  );
}
