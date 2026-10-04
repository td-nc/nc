# Toscana Diagnostica · Non Conformità (td-nc)

Webapp per la gestione delle non conformità pre-analitiche del Laboratorio di Analisi di Toscana Diagnostica (Via di Pratignone 13/4, Sesto Fiorentino). Stessa architettura e stesso stile di td-integration e td-cash-management. Destinata a `nc.toscanadiagnostica.it`.

## Cosa fa

Tre macro-aree di NC (fisiche/biologiche, informatiche/LIS, documentali) con catalogo di tipologie modificabile, gravità (minore, maggiore, critica) e testi dell'azione attesa proposti all'operatore. Processo in cinque fasi, tutte tracciate sulla stessa scheda: rilevazione e blocco, trattamento immediato, analisi della causa radice, azioni correttive e preventive, chiusura e verifica dell'efficacia.

**Desk preanalitica.** Lettura barcode o digitazione del numero di accettazione: sede inviante, paziente, esami, stato LIS, NC già aperte. Apertura NC in tre passi con foto del campione. Codice progressivo `NC-anno-numero`. Se l'accettazione non è in archivio si registra a mano (o si apre la NC "accettazione non trasmessa al LIS").

**Dialogo con la sede.** Email da `laboratorio@toscanadiagnostica.it` alla sede inviante (indirizzo preso da StudioLAB, `Cliente.EmailNonConformita`, sovrascrivibile) con il link alla NC. La sede entra con le credenziali fornite dal laboratorio, vede solo le NC delle proprie sedi, risponde con nome, email e telefono obbligatori e può dichiarare l'azione eseguita. Il laboratorio riceve email e badge giallo "Risposta da gestire"; può riscrivere alla sede (nuovo SLA) o chiudere. Nessun dato del paziente viaggia via email.

**SLA, solleciti, escalation.** Scadenza di risposta in ore lavorative (lun-ven, finestra configurabile, fuso Roma), globale o per sede. Sollecito automatico alla sede alla scadenza, escalation interna dopo N ore lavorative. Rilevazione automatica delle ricorrenze (stessa tipologia e sede oltre soglia in 90 giorni) con RCA obbligatoria; RCA obbligatoria anche per maggiori e critiche. Verifica di efficacia della Qualità solo a CAPA completate; se non efficace la NC si riapre.

**Integrazione StudioLAB (CB Sistemi).** Lettura dell'accettazione via API ServiceNET (`X-API-KEY`), blocco/sblocco esami e caricamento del rapporto NC in PDF sull'accettazione (write-back opzionale), webhook push e ricezione ordini HL7 (`ORM^O01`) over HTTPS per popolare l'archivio accettazioni con sede e paziente. Senza LIS l'app lavora comunque con inserimento manuale.

**Statistiche ed evidenze.** Cruscotto, Pareto delle tipologie, trend mensile per macro-area, per sede (con NC/1.000 accettazioni), per gravità, cause radice, rispetto SLA, tempo medio di risposta e di chiusura, CAPA scadute. Export XLSX, rapporto NC in PDF, registro attività completo, registro email.

**Profili.** Amministratore (tutto), Qualità (RCA/CAPA/verifica, catalogo, sedi, accessi delle sedi, impostazioni, registro), Laboratorio (rileva, tratta, dialoga, chiude), Sede (solo le proprie NC), Sola lettura.

## Architettura

`server/` Node.js 22 + Express + PostgreSQL 16 (sessioni su database, Helmet, CSRF via header, rate limit sul login, audit log, scheduler interno per SLA e coda email); `web/` React 18 + Vite con lo stile condiviso (`web/src/styles.css`); Docker su Render tramite `render.yaml`. Email via Microsoft Graph (consigliato), SMTP o modalità `log` (simulazione). PDF con pdfkit, XLSX con exceljs. Eventi in tempo reale (SSE) filtrati per sede.

## Deploy su Render

1. Repository GitHub `tdintegration/td-nc` con questo codice. Su render.com: **New > Blueprint**, collegare il repository: `render.yaml` crea database e applicazione (Francoforte, piano Starter + database Basic).
2. Variabili da impostare nel pannello: `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_AUTHORITY` (tenant id TD), `SEED_ADMIN_PASSWORD` (facoltativa, min 12 caratteri), poi quelle di LIS ed email appena disponibili (sotto).
3. Primo avvio: schema, catalogo tipologie, sede interna `LAB-SESTO`, amministratore `francesco.epifani@toscanadiagnostica.it`. L'app risponde su `https://td-nc.onrender.com`.
4. Dominio: Settings > Custom Domains > `nc.toscanadiagnostica.it`, DNS `CNAME nc -> td-nc.onrender.com`, poi `BASE_URL=https://nc.toscanadiagnostica.it` e aggiornamento del redirect URI su Entra. Il link nelle email usa `BASE_URL`.

## Microsoft 365 (Entra ID)

Registrazione nuova, single tenant (solo account Toscana Diagnostica; le sedi non entrano con Microsoft):

1. Entra ID > App registrations > New registration: nome "TD Non Conformità", **Accounts in this organizational directory only**, piattaforma Web, redirect URI `https://td-nc.onrender.com/api/auth/entra/callback` (poi aggiungere quello del dominio ufficiale).
2. Certificates & secrets > New client secret (24 mesi).
3. Token configuration > Add optional claim > ID token > `email`. API permissions: `openid`, `profile`, `email` > Grant admin consent.
4. Variabili: `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_AUTHORITY=<tenant id>`. Gli account `@toscanadiagnostica.it` entrano al primo accesso come Laboratorio; l'amministratore assegna poi Qualità/Admin.

## Email da laboratorio@toscanadiagnostica.it

Opzione consigliata, **Microsoft Graph** (nessuna password di casella nell'app): nella stessa o in una nuova App registration aggiungere il permesso applicativo `Mail.Send` con admin consent, poi limitarlo alla sola casella con una Application Access Policy (`New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId <gruppo con laboratorio@> -AccessRight RestrictAccess`). Variabili: `MAIL_PROVIDER=graph`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `MAIL_FROM=laboratorio@toscanadiagnostica.it`.

Alternativa SMTP (richiede SMTP AUTH abilitato sulla casella): `MAIL_PROVIDER=smtp`, `SMTP_USER`, `SMTP_PASS`. In collaudo `MAIL_PROVIDER=log` registra le email senza inviarle (stato "simulata", visibile in Impostazioni).

`MAIL_LAB_NOTIFY` elenca gli indirizzi interni che ricevono risposte delle sedi ed escalation (oltre agli utenti Laboratorio/Qualità con notifiche attive).

## StudioLAB (CB Sistemi): cosa chiedere

Lo swagger pubblico (`https://servicenet.studiolab.it/swagger/ui/index`, versione 10.0.7.0) espone: lettura accettazione per numero (`GET /api/accettazioni?id=`), blocco/sblocco esame, allegati, notizie cliniche, `POST /api/push` (NotificaPush), `POST /hl7`. Il modello `Cliente` ha il campo `EmailNonConformita` e l'esame ha `TipoNonConformita`/`NonConformita`: td-nc li usa.

Limite: la lettura per numero **non restituisce paziente né cliente inviante** e non esiste un elenco accettazioni per data o sede. Per avere l'archivio completo serve uno dei due canali in ingresso:

- **HL7 ORM^O01 over HTTPS** da StudioLAB a `POST {BASE_URL}/api/hl7` con header `X-Push-Secret: <LIS_PUSH_SECRET>` (body testo HL7, risposta ACK). Mappatura implementata: MSH-4 sede, PID paziente, ORC-3/OBR-3 numero accettazione, OBR-4 esami. Da confermare con CB Sistemi sulla loro documentazione.
- **Notifica push** `POST {BASE_URL}/api/lis/push` con lo stesso header e body `{IdAccettazione, TipoNotifica, IdDocumento}`: td-nc rilegge l'accettazione via API.

Richiesta a CB Sistemi: (1) API key di nodo per `servicenet.studiolab.it` con `CodiceCliente` del laboratorio; (2) attivazione del flusso HL7 ordini (o push) verso l'endpoint td-nc; (3) conferma dei codici `StatoAvanzamento` (0/10/20/25/40) e della tabella `TipoNonConformita`; (4) abilitazione del nodo a blocco/sblocco esami e caricamento allegati (`LIS_WRITE_BACK=true`).

Senza nulla di tutto questo l'app è comunque operativa: la preanalitica registra l'accettazione a mano (sede dal menu, paziente, esami) e il flusso NC è identico. Le statistiche "NC per 1.000 accettazioni" diventano attendibili solo con il flusso completo.

## Sviluppo locale e test

```bash
docker run -d --name tdncdb -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=tdnc postgres:16-alpine
cd server && npm install
DATABASE_URL=postgres://postgres:dev@localhost:5432/tdnc SESSION_SECRET=x SEED_ADMIN_EMAIL=admin@test.it SEED_ADMIN_PASSWORD=Admin-Password-2026 SEED_DEMO=true DISABLE_SCHEDULER=true npm start
cd web && npm install && npm run dev        # http://localhost:5173, proxy API su :3000
# test end-to-end (database vuoto + seed demo): 14 scenari dal desk alla verifica di efficacia
cd server && BASE=http://localhost:3000 DATABASE_URL=postgres://postgres:dev@localhost:5432/tdnc npm test
```

Oppure `cp .env.example .env` e `docker compose up --build` (app su http://localhost:3000).

## API

Tutte sotto `/api`, sessione via cookie, header `X-Requested-With: td-nc` sulle richieste che modificano dati. Canali macchina senza sessione: `POST /api/lis/push`, `POST /api/hl7` (header `X-Push-Secret`).

- `auth`: config, login, logout, me, me/preferences, change-password, entra/login, entra/callback
- `accettazioni` GET (elenco, filtri) · `accettazioni/:id` GET (cache + refresh LIS) · POST (manuale) · `:id/sede` PATCH
- `nc` GET (filtri: stato, sede, macro, tipo, gravita, from, to, q, ricorrenti, scadute, aperte) · POST · `nc/counts` · `nc/export.xlsx`
- `nc/:id` GET · PATCH · `invia` · `messaggi` POST · `trattamento` · `rca` · `azioni` POST/PUT/DELETE · `chiudi` · `verifica` · `riapri` · `annulla` · `allegati` POST/GET/DELETE · `rapporto.pdf`
- `stats` GET (from, to, sede)
- `sedi` GET/POST/PUT · `tipi` GET/POST/PUT · `users` GET/POST/PUT, `users/:id/reset-password`
- `settings` GET/PUT · `email` GET, `email/:id`, `email/:id/retry`, `email/test` · `lis/status` · `audit` · `scheduler/run` · `events` (SSE)

## Riferimenti normativi

ISO 15189:2022 §7.5 (gestione delle non conformità), §8.7 (azioni correttive), §8.6 (miglioramento), §7.2.4/§7.2.6 (criteri di accettazione e rifiuto dei campioni); ISO 9001:2015 §8.7 (controllo degli output non conformi) e §10.2 (non conformità e azioni correttive). Il rapporto PDF è la registrazione; il registro attività è l'evidenza dell'audit trail.
