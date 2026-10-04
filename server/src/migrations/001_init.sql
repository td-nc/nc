-- td-nc · schema iniziale
-- Gestione delle non conformità pre-analitiche del Laboratorio di Analisi di Toscana Diagnostica
-- (Via di Pratignone 13/4, Sesto Fiorentino). Riferimenti: ISO 15189:2022 §7.5 (gestione delle NC),
-- §8.7 (azioni correttive), §8.6 (miglioramento); ISO 9001:2015 §8.7 e §10.2.

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sedi invianti: punti prelievo e centri medici Toscana Diagnostica, clienti Service (laboratori e strutture terze).
-- Il codice coincide con CodiceCliente di StudioLAB; email_nc viene da Cliente.EmailNonConformita del LIS
-- e può essere sovrascritta qui (email_nc_override).
CREATE TABLE sedi (
  id                 SERIAL PRIMARY KEY,
  codice             TEXT NOT NULL,                 -- CodiceCliente StudioLAB
  nome               TEXT NOT NULL,
  tipo               TEXT NOT NULL DEFAULT 'SERVICE' CHECK (tipo IN ('PUNTO_PRELIEVO','CENTRO_MEDICO','SERVICE','LABORATORIO','ALTRO')),
  email_nc           TEXT,                          -- dal LIS (EmailNonConformita)
  email_nc_override  TEXT,                          -- impostata in td-nc, prevale sul LIS
  email_cc           TEXT,                          -- destinatari in copia (separati da virgola)
  telefono           TEXT,
  referente          TEXT,
  indirizzo          TEXT,
  citta              TEXT,
  sla_ore            INT,                           -- ore lavorative per la risposta; NULL = valore globale
  attiva             BOOLEAN NOT NULL DEFAULT TRUE,
  note               TEXT,
  lis_json           JSONB,                         -- ultimo oggetto Cliente ricevuto dal LIS
  lis_synced_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sedi_codice_uq ON sedi (lower(codice));

-- Utenti. TD: Microsoft 365 (auto-abilitati per dominio). Sedi e clienti Service: credenziali locali
-- fornite in fase di contrattualizzazione, vincolate a una o più sedi (users_sedi).
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'SEDE' CHECK (role IN ('ADMIN','QUALITA','LAB','SEDE','VIEWER')),
  status               TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('ACTIVE','PENDING','DISABLED')),
  auth_provider        TEXT NOT NULL DEFAULT 'ENTRA' CHECK (auth_provider IN ('LOCAL','ENTRA','BOTH')),
  organization         TEXT,
  telefono             TEXT,
  entra_tid            TEXT,
  entra_oid            TEXT,
  password_hash        TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_logins        INT NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  notify_email         BOOLEAN NOT NULL DEFAULT TRUE,   -- riceve le notifiche NC (lab: risposte/escalation; sede: nuove NC)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE users_sedi (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sede_id INT NOT NULL REFERENCES sedi(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, sede_id)
);

-- Catalogo delle tipologie di NC (macro-area + dettaglio). Modificabile dalla Qualità.
CREATE TABLE nc_tipi (
  id               SERIAL PRIMARY KEY,
  macro            TEXT NOT NULL CHECK (macro IN ('FISICA','INFORMATICA','DOCUMENTALE')),
  codice           TEXT NOT NULL,
  label            TEXT NOT NULL,
  descrizione      TEXT,
  gravita_default  TEXT NOT NULL DEFAULT 'MINORE' CHECK (gravita_default IN ('MINORE','MAGGIORE','CRITICA')),
  azione_attesa    TEXT,                                -- testo proposto per il campo "azione attesa"
  richiede_nuovo_campione BOOLEAN NOT NULL DEFAULT FALSE,
  lis_tipo         INT,                                 -- TipoNonConformita di StudioLAB (se mappato)
  posizione        INT NOT NULL DEFAULT 0,
  attivo           BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (macro, codice)
);

-- Cache delle accettazioni lette da StudioLAB (o inserite manualmente se il LIS non risponde).
-- Dati paziente minimi: servono al laboratorio per identificare il campione; non viaggiano mai via email.
CREATE TABLE accettazioni (
  id                 TEXT PRIMARY KEY,                 -- numero accettazione StudioLAB
  sede_id            INT REFERENCES sedi(id),
  id_richiesta_cliente TEXT,                           -- IdRichiestaCliente (riferimento del Service)
  data_accettazione  TIMESTAMPTZ,
  data_ritiro        TIMESTAMPTZ,
  stato_lis          INT,                              -- StatoAvanzamento StudioLAB (0,10,20,25,40)
  paziente_cognome   TEXT,
  paziente_nome      TEXT,
  paziente_nascita   DATE,
  paziente_sesso     TEXT,
  paziente_cf        TEXT,
  esami              JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{cod, descrizione, stato, bloccato, numReferto, tipoNc, nc}]
  origine            TEXT NOT NULL DEFAULT 'LIS' CHECK (origine IN ('LIS','HL7','PUSH','MANUALE')),
  lis_json           JSONB,
  fetched_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accettazioni_sede_idx ON accettazioni (sede_id, data_accettazione DESC);
CREATE INDEX accettazioni_data_idx ON accettazioni (data_accettazione DESC);

CREATE SEQUENCE nc_codice_seq;

-- Non conformità. Stati:
--   APERTA            rilevata e registrata (campione bloccato), non ancora inviata alla sede
--   INVIATA_SEDE      comunicata alla sede inviante, in attesa di risposta (SLA attivo)
--   RISPOSTA_SEDE     la sede ha risposto: da gestire dal laboratorio (badge)
--   IN_TRATTAMENTO    il laboratorio ha definito il trattamento / attende il nuovo campione
--   CHIUSA            trattamento concluso, caso clinico chiuso
--   VERIFICATA        efficacia delle azioni verificata dalla Qualità (solo NC con CAPA)
--   ANNULLATA         aperta per errore
CREATE TABLE nc (
  id                 SERIAL PRIMARY KEY,
  codice             TEXT NOT NULL UNIQUE,              -- NC-AAAA-NNNN
  accettazione_id    TEXT NOT NULL REFERENCES accettazioni(id),
  sede_id            INT NOT NULL REFERENCES sedi(id),
  macro              TEXT NOT NULL CHECK (macro IN ('FISICA','INFORMATICA','DOCUMENTALE')),
  tipo_id            INT REFERENCES nc_tipi(id),
  tipo_altro         TEXT,
  gravita            TEXT NOT NULL DEFAULT 'MINORE' CHECK (gravita IN ('MINORE','MAGGIORE','CRITICA')),
  stato              TEXT NOT NULL DEFAULT 'APERTA' CHECK (stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO','CHIUSA','VERIFICATA','ANNULLATA')),
  descrizione        TEXT NOT NULL,
  azione_attesa      TEXT NOT NULL,
  esami_coinvolti    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{cod, descrizione, idEsame}]
  campione_bloccato  BOOLEAN NOT NULL DEFAULT TRUE,
  blocco_lis         BOOLEAN NOT NULL DEFAULT FALSE,      -- blocco esami applicato su StudioLAB
  blocco_lis_esito   TEXT,
  -- Fase 2: trattamento immediato
  trattamento_tipo   TEXT CHECK (trattamento_tipo IN ('CONSERVAZIONE','NUOVO_CAMPIONE','INTEGRAZIONE_DOCUMENTALE','ACCETTAZIONE_LIS','DEROGA','ANNULLAMENTO_ESAMI','ALTRO')),
  trattamento_note   TEXT,
  conservazione      TEXT,                                -- es. "4 °C fino al 12/10", "congelato -20 °C"
  -- Fase 3: analisi della causa radice
  rca_richiesta      BOOLEAN NOT NULL DEFAULT FALSE,
  rca_metodo         TEXT,                                -- 5 perché, Ishikawa, altro
  rca_causa          TEXT,
  rca_categoria      TEXT CHECK (rca_categoria IN ('PRELIEVO','IDENTIFICAZIONE','TRASPORTO','CONSERVAZIONE','LIS','DOCUMENTAZIONE','FORMAZIONE','MATERIALI','ORGANIZZAZIONE','ALTRO')),
  rca_by             INT REFERENCES users(id),
  rca_at             TIMESTAMPTZ,
  -- Fase 5: chiusura e verifica efficacia
  esito_chiusura     TEXT,
  verifica_esito     TEXT CHECK (verifica_esito IN ('EFFICACE','NON_EFFICACE','NON_APPLICABILE')),
  verifica_note      TEXT,
  verifica_by        INT REFERENCES users(id),
  verifica_at        TIMESTAMPTZ,
  -- SLA
  sla_due_at         TIMESTAMPTZ,
  sla_reminder_at    TIMESTAMPTZ,
  sla_escalated_at   TIMESTAMPTZ,
  ricorrente         BOOLEAN NOT NULL DEFAULT FALSE,     -- stessa tipologia sulla stessa sede ≥ soglia negli ultimi 90 giorni
  -- tracciatura
  opened_by          INT REFERENCES users(id),
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at            TIMESTAMPTZ,
  first_response_at  TIMESTAMPTZ,
  closed_by          INT REFERENCES users(id),
  closed_at          TIMESTAMPTZ,
  version            INT NOT NULL DEFAULT 1,
  updated_by         INT REFERENCES users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX nc_stato_idx ON nc (stato, opened_at DESC);
CREATE INDEX nc_sede_idx ON nc (sede_id, opened_at DESC);
CREATE INDEX nc_acc_idx ON nc (accettazione_id);
CREATE INDEX nc_sla_idx ON nc (sla_due_at) WHERE stato = 'INVIATA_SEDE';

-- Azioni correttive e preventive (fase 4)
CREATE TABLE nc_azioni (
  id            SERIAL PRIMARY KEY,
  nc_id         INT NOT NULL REFERENCES nc(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('CORRETTIVA','PREVENTIVA')),
  descrizione   TEXT NOT NULL,
  responsabile  TEXT,
  scadenza      DATE,
  stato         TEXT NOT NULL DEFAULT 'PIANIFICATA' CHECK (stato IN ('PIANIFICATA','IN_CORSO','COMPLETATA','ANNULLATA')),
  completata_at TIMESTAMPTZ,
  note          TEXT,
  created_by    INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thread di comunicazione laboratorio <-> sede (e note interne)
CREATE TABLE nc_messaggi (
  id             SERIAL PRIMARY KEY,
  nc_id          INT NOT NULL REFERENCES nc(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('APERTURA','RICHIESTA','RISPOSTA','CHIARIMENTO','TRATTAMENTO','CHIUSURA','RIAPERTURA','NOTA_INTERNA','SISTEMA')),
  direzione      TEXT NOT NULL CHECK (direzione IN ('LAB_SEDE','SEDE_LAB','INTERNO')),
  testo          TEXT NOT NULL,
  azione_eseguita BOOLEAN,                 -- la sede dichiara di aver eseguito l'azione richiesta
  contatto_nome  TEXT,                     -- obbligatori per le risposte della sede
  contatto_email TEXT,
  contatto_tel   TEXT,
  user_id        INT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX nc_messaggi_nc_idx ON nc_messaggi (nc_id, created_at);

-- Allegati (foto del campione, moduli scansionati, rapporto NC in PDF)
CREATE TABLE nc_allegati (
  id           SERIAL PRIMARY KEY,
  nc_id        INT NOT NULL REFERENCES nc(id) ON DELETE CASCADE,
  messaggio_id INT REFERENCES nc_messaggi(id) ON DELETE SET NULL,
  nome_file    TEXT NOT NULL,
  mime         TEXT NOT NULL,
  dimensione   INT NOT NULL,
  contenuto    BYTEA NOT NULL,
  caricato_da  INT REFERENCES users(id),
  lis_allegato_id TEXT,                    -- id allegato su StudioLAB se caricato anche lì
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX nc_allegati_nc_idx ON nc_allegati (nc_id);

-- Email inviate dall'applicazione (laboratorio@toscanadiagnostica.it)
CREATE TABLE email_log (
  id         SERIAL PRIMARY KEY,
  nc_id      INT REFERENCES nc(id) ON DELETE SET NULL,
  tipo       TEXT NOT NULL,                -- NC_APERTA | NC_RICHIESTA | NC_RISPOSTA | NC_SOLLECITO | NC_ESCALATION | NC_CHIUSA | TEST
  destinatari TEXT NOT NULL,
  cc         TEXT,
  oggetto    TEXT NOT NULL,
  corpo_html TEXT NOT NULL,
  stato      TEXT NOT NULL DEFAULT 'IN_CODA' CHECK (stato IN ('IN_CODA','INVIATA','ERRORE','SIMULATA')),
  errore     TEXT,
  tentativi  INT NOT NULL DEFAULT 0,
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_stato_idx ON email_log (stato, created_at);

-- Notifiche ricevute dal LIS (push / HL7), per diagnostica
CREATE TABLE lis_eventi (
  id         SERIAL PRIMARY KEY,
  canale     TEXT NOT NULL,                -- PUSH | HL7 | API
  esito      TEXT NOT NULL,                -- OK | ERRORE
  accettazione_id TEXT,
  dettaglio  TEXT,
  payload    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lis_eventi_at_idx ON lis_eventi (created_at DESC);

-- Registro attività (chi ha fatto cosa, prima/dopo)
CREATE TABLE audit_log (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  nc_id     INT,
  label     TEXT,
  data      JSONB,
  ip        TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_nc_idx ON audit_log (nc_id);

-- Sessioni (connect-pg-simple)
CREATE TABLE "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

-- Impostazioni iniziali
INSERT INTO app_settings (key, value) VALUES
  ('sla_ore_default', '24'),            -- ore lavorative per la risposta della sede
  ('sla_sollecito_ore', '0'),           -- sollecito alla scadenza (0 = alla scadenza)
  ('sla_escalation_ore', '24'),         -- escalation al laboratorio dopo N ore lavorative dalla scadenza
  ('ricorrenza_soglia', '3'),           -- NC della stessa tipologia sulla stessa sede in 90 giorni
  ('orario_lavoro', '08:00-18:00'),     -- finestra lavorativa lun-ven per il calcolo degli SLA
  ('lab_nome', 'Laboratorio di Analisi Toscana Diagnostica'),
  ('lab_indirizzo', 'Via di Pratignone 13/4, 50019 Sesto Fiorentino (FI)'),
  ('lab_email', 'laboratorio@toscanadiagnostica.it'),
  ('lab_telefono', '');

-- Catalogo tipologie (rivedibile dalla Qualità). Le "azioni attese" sono i testi proposti all'operatore.
INSERT INTO nc_tipi (macro, codice, label, descrizione, gravita_default, azione_attesa, richiede_nuovo_campione, posizione) VALUES
  ('FISICA','EMOLISI','Emolisi','Siero/plasma emolizzato; interferenza analitica su K, LDH, AST, bilirubina e altri analiti.','MINORE','Ripetere il prelievo del paziente e inviare un nuovo campione con la stessa richiesta. Verificare tecnica di prelievo (ago, aspirazione, agitazione) e tempi di centrifugazione.',TRUE,10),
  ('FISICA','COAGULO','Coaguli / microcoaguli','Presenza di coaguli in provetta con anticoagulante (EDTA, citrato): campione non idoneo per emocromo e coagulazione.','MINORE','Ripetere il prelievo rispettando il numero di inversioni della provetta e inviare un nuovo campione.',TRUE,20),
  ('FISICA','VOLUME','Volume insufficiente / rapporto errato','Quantità non sufficiente per gli esami richiesti oppure rapporto sangue/anticoagulante non rispettato (es. citrato).','MINORE','Inviare un nuovo campione con volume adeguato, riempiendo la provetta fino alla tacca.',TRUE,30),
  ('FISICA','PROVETTA','Provetta / contenitore errato','Materiale non idoneo agli esami richiesti (tipo di anticoagulante o contenitore).','MINORE','Inviare un nuovo campione nella provetta corretta indicata dal vademecum (MOD221 Elenco provette).',TRUE,40),
  ('FISICA','DETERIORAMENTO','Deterioramento (tempo / temperatura)','Campione pervenuto oltre i tempi di stabilità o fuori dalla temperatura di conservazione prevista.','MAGGIORE','Inviare un nuovo campione rispettando tempi e temperatura di trasporto previsti dalle istruzioni di raccolta.',TRUE,50),
  ('FISICA','ETICHETTA','Etichetta assente, illeggibile o non corrispondente','Campione non identificabile con certezza o dati etichetta diversi dalla richiesta.','CRITICA','Confermare per iscritto l''identità del paziente e, se non possibile con certezza, inviare un nuovo campione correttamente identificato.',FALSE,60),
  ('FISICA','CONTENITORE','Contenitore danneggiato / perdita di materiale','Provetta rotta, tappo aperto, materiale fuoriuscito nel sacchetto di trasporto.','MAGGIORE','Inviare un nuovo campione; verificare l''imballaggio secondario e l''uso dei sacchetti con tasca.',TRUE,70),
  ('FISICA','CAMPIONE_MANCANTE','Campione mancante rispetto alla richiesta','Esame richiesto senza il relativo campione (provetta/contenitore non pervenuto).','MINORE','Inviare il campione mancante oppure confermare l''annullamento dell''esame.',TRUE,80),
  ('FISICA','LIPEMIA_ITTERO','Lipemia / ittero marcati','Interferenza ottica rilevante su alcuni analiti.','MINORE','Valutare ripetizione del prelievo a digiuno; in alternativa confermare l''esecuzione con nota di interferenza sul referto.',FALSE,90),
  ('FISICA','ALTRO','Altra NC fisica/biologica',NULL,'MINORE',NULL,FALSE,99),
  ('INFORMATICA','ACCETTAZIONE_MANCANTE','Accettazione non trasmessa al LIS','Il campione fisico è pervenuto ma l''ordine informatico non è presente in StudioLAB.','MAGGIORE','Trasmettere l''accettazione su StudioLAB (o inviare la richiesta cartacea completa) indicando il numero di campione.',FALSE,10),
  ('INFORMATICA','ESAME_NON_RICHIESTO','Campione senza esame corrispondente nell''ordine','Pervenuto materiale per esami non presenti nell''accettazione informatica.','MINORE','Integrare l''accettazione con gli esami mancanti oppure confermare che il materiale non va processato.',FALSE,20),
  ('INFORMATICA','ANAGRAFICA','Discrepanza anagrafica','Dati del paziente in accettazione diversi da quelli riportati sull''etichetta o sulla richiesta.','CRITICA','Verificare l''identità del paziente e correggere l''anagrafica in accettazione, confermando per iscritto.',FALSE,30),
  ('INFORMATICA','BARCODE','Barcode non leggibile / non associato','Etichetta non riconosciuta dal LIS o non associata ad alcuna accettazione.','MINORE','Comunicare il numero di accettazione corrispondente al campione.',FALSE,40),
  ('INFORMATICA','DUPLICATO','Accettazione duplicata','Stessa richiesta trasmessa più volte.','MINORE','Confermare quale accettazione mantenere; le altre verranno annullate.',FALSE,50),
  ('INFORMATICA','ALTRO','Altra NC informatica/LIS',NULL,'MINORE',NULL,FALSE,99),
  ('DOCUMENTALE','CONSENSO','Consenso informato mancante','Esame che richiede consenso scritto (es. HIV MOD222, genetica MOD250) pervenuto senza modulo firmato.','MAGGIORE','Inviare il consenso informato firmato dal paziente. L''esame resta sospeso fino al ricevimento.',FALSE,10),
  ('DOCUMENTALE','SCHEDA_CLINICA','Scheda clinica / notizie cliniche non compilate','Informazioni cliniche obbligatorie per l''esame assenti o incomplete.','MINORE','Compilare e inviare la scheda clinica richiesta per l''esame.',FALSE,20),
  ('DOCUMENTALE','MODULO_RICHIESTA','Modulo di richiesta mancante o incompleto','Richiesta specifica assente o non compilata (es. MOD200/210/211/212 citologia e istologia, Allegato 8).','MINORE','Inviare il modulo di richiesta compilato in ogni parte.',FALSE,30),
  ('DOCUMENTALE','CATENA_CUSTODIA','Catena di custodia incompleta','Analisi a valenza medico-legale senza MOD232 completo o sigilli non conformi.','CRITICA','Integrare la catena di custodia; in assenza, il campione non ha valenza medico-legale e l''analisi verrà eseguita solo a valenza clinica previa conferma.',FALSE,40),
  ('DOCUMENTALE','PRESCRIZIONE','Prescrizione / impegnativa mancante','Documento del medico prescrittore assente dove richiesto.','MINORE','Inviare la prescrizione medica.',FALSE,50),
  ('DOCUMENTALE','FIRMA','Firma mancante','Modulo presente ma non firmato dal paziente o dal medico.','MINORE','Far firmare il modulo e inviarlo.',FALSE,60),
  ('DOCUMENTALE','ALTRO','Altra NC documentale',NULL,'MINORE',NULL,FALSE,99);
