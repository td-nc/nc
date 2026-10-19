// Configurazione da variabili d'ambiente (stesso schema di td-integration / td-cash-management)
const env = process.env;
const list = (v, lower = false) => (v || '').split(',').map((s) => (lower ? s.trim().toLowerCase() : s.trim())).filter(Boolean);

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || 'http://localhost:3000',
  databaseUrl: env.DATABASE_URL || 'postgres://postgres@localhost:5432/tdnc',
  sessionSecret: env.SESSION_SECRET || 'dev-only-change-me',
  secureCookies: env.NODE_ENV === 'production',
  sessionHours: Number(env.SESSION_HOURS || 10),
  appName: 'Toscana Diagnostica · Non Conformità',
  entra: {
    // Single-tenant di default: entrano solo gli account Microsoft 365 di Toscana Diagnostica.
    // Le sedi e i clienti Service accedono con credenziali locali fornite dal laboratorio.
    authority: env.ENTRA_AUTHORITY || env.ENTRA_TENANT_ID || 'organizations',
    clientId: env.ENTRA_CLIENT_ID || '',
    clientSecret: env.ENTRA_CLIENT_SECRET || '',
    allowedTenants: list(env.ENTRA_ALLOWED_TENANTS),
    get enabled() { return Boolean(this.clientId && this.clientSecret); },
  },
  // domini email abilitati in automatico al primo accesso Microsoft (ruolo LAB); gli altri restano in attesa
  autoLabDomains: list(env.AUTO_LAB_DOMAINS || 'toscanadiagnostica.it', true),
  seed: {
    adminEmail: (env.SEED_ADMIN_EMAIL || '').toLowerCase(),
    adminName: env.SEED_ADMIN_NAME || 'Amministratore',
    adminPassword: env.SEED_ADMIN_PASSWORD || '',
    demo: (env.SEED_DEMO || 'false') === 'true',   // sedi e accettazioni di esempio (solo ambienti di prova)
  },
  // StudioLAB ServiceNET (CB Sistemi)
  lis: {
    baseUrl: (env.LIS_BASE_URL || 'https://servicenet.studiolab.it').replace(/\/$/, ''),
    apiKey: env.LIS_API_KEY || '',
    codiceCliente: env.LIS_CODICE_CLIENTE || '',           // codice del nodo laboratorio, se richiesto dalle chiamate
    mittente: env.LIS_MITTENTE || 'td-nc',
    pushSecret: env.LIS_PUSH_SECRET || '',                 // segreto condiviso per il webhook /api/lis/push e /api/hl7
    writeBack: (env.LIS_WRITE_BACK || 'false') === 'true', // blocco/sblocco esami e allegati su StudioLAB
    timeoutMs: Number(env.LIS_TIMEOUT_MS || 12000),
    get enabled() { return Boolean(this.apiKey); },
  },
  // Email in uscita: Microsoft Graph (consigliato) oppure SMTP; MAIL_PROVIDER=log scrive solo nel registro
  mail: {
    provider: env.MAIL_PROVIDER || 'log',               // graph | smtp | log
    from: env.MAIL_FROM || 'laboratorio@toscanadiagnostica.it',
    fromName: env.MAIL_FROM_NAME || 'Laboratorio Toscana Diagnostica',
    labNotify: list(env.MAIL_LAB_NOTIFY || 'laboratorio@toscanadiagnostica.it', true), // destinatari lab per risposte/escalation
    graph: {
      tenantId: env.GRAPH_TENANT_ID || '',
      clientId: env.GRAPH_CLIENT_ID || env.ENTRA_CLIENT_ID || '',
      clientSecret: env.GRAPH_CLIENT_SECRET || env.ENTRA_CLIENT_SECRET || '',
    },
    smtp: {
      host: env.SMTP_HOST || 'smtp.office365.com',
      port: Number(env.SMTP_PORT || 587),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
    },
  },
  schedulerMinutes: Number(env.SCHEDULER_MINUTES || 5),
};

if (env.NODE_ENV === 'production' && config.sessionSecret === 'dev-only-change-me') {
  throw new Error('SESSION_SECRET obbligatorio in produzione');
}
