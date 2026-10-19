// Accesso con Microsoft Entra ID (multi-tenant) via OpenID Connect + PKCE, verifica dell'ID token con jose.
// Perché non openid-client: con l'authority "organizations" il campo `issuer` della discovery è un template
// ({tenantid}) che non supera la validazione stretta della libreria; qui l'issuer viene verificato
// rispetto al tenant (tid) dichiarato nel token, come raccomandato da Microsoft per le app multi-tenant.
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';

const AUTH_BASE = 'https://login.microsoftonline.com';
// Endpoint OAuth2 v2.0 (authorize/token): .../oauth2/v2.0/...; l'issuer degli ID token è invece https://login.microsoftonline.com/{tid}/v2.0
const oauth = () => `${AUTH_BASE}/${config.entra.authority}/oauth2/v2.0`;
let JWKS = null;
const jwks = () => (JWKS ||= createRemoteJWKSet(new URL(`${AUTH_BASE}/${config.entra.authority}/discovery/v2.0/keys`)));

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const redirectUri = () => `${config.baseUrl}/api/auth/entra/callback`;

export function beginLogin() {
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const p = new URLSearchParams({
    client_id: config.entra.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: 'openid profile email',
    state, nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${oauth()}/authorize?${p}`, state, nonce, verifier };
}

export async function completeLogin({ code, verifier, nonce }) {
  const body = new URLSearchParams({
    client_id: config.entra.clientId,
    client_secret: config.entra.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const res = await fetch(`${oauth()}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const tok = await res.json();
  if (!res.ok || !tok.id_token) throw new Error(`token endpoint: ${tok.error_description || tok.error || res.status}`);
  // 1) firma + audience; l'issuer viene controllato dopo, contro il tenant del token
  const { payload } = await jwtVerify(tok.id_token, jwks(), { audience: config.entra.clientId, clockTolerance: 120 });
  if (!payload.tid || payload.iss !== `${AUTH_BASE}/${payload.tid}/v2.0`) throw new Error('issuer non valido');
  if (payload.nonce !== nonce) throw new Error('nonce non valido');
  if (config.entra.allowedTenants.length && !config.entra.allowedTenants.includes(payload.tid)) {
    const e = new Error('Tenant Microsoft non autorizzato'); e.code = 'TENANT'; throw e;
  }
  const email = String(payload.email || payload.preferred_username || '').toLowerCase();
  if (!email || !email.includes('@')) throw new Error('email non presente nel token');
  return { email, name: payload.name || email, oid: payload.oid, tid: payload.tid };
}
