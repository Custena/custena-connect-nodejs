import crypto from 'crypto';
import http from 'http';
import { OAuthConfig } from '../types.js';
import { TOKEN_STORE_PATH } from '../config.js';
import fs from 'fs/promises';
import path from 'path';

// The OAuth endpoints — in prod these come from the resource metadata
const KEYCLOAK_BASE = process.env.CUSTENA_KEYCLOAK_URL ?? 'https://api.custena.com/auth/realms/custena';
const CLIENT_ID = 'custena-connect-cli';

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function runOAuthFlow(): Promise<OAuthConfig> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const redirectUri = 'http://localhost:9874/callback';
  const authUrl = new URL(`${KEYCLOAK_BASE}/protocol/openid-connect/auth`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'custena:buyer');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Start server and open browser concurrently — server must be listening before the redirect arrives
  const callbackPromise = startCallbackServer(state);
  const { default: open } = await import('open');
  await open(authUrl.toString());

  const { code } = await callbackPromise;

  // Exchange code for tokens
  const tokenRes = await fetch(`${KEYCLOAK_BASE}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
  const tokens = await tokenRes.json() as any;

  const config: OAuthConfig = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    clientId: CLIENT_ID,
  };

  await saveToken(config);
  return config;
}

async function startCallbackServer(expectedState: string): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code && state === expectedState) {
        res.end('<html><body><h2>Custena connected! You can close this tab.</h2></body></html>');
        server.close();
        resolve({ code });
      } else {
        res.end('Error');
        server.close();
        reject(new Error('OAuth callback error'));
      }
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth login timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    server.listen(9874);
    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    server.on('close', () => clearTimeout(timeout));
  });
}

export async function loadToken(): Promise<OAuthConfig | null> {
  try {
    const content = await fs.readFile(TOKEN_STORE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function saveToken(config: OAuthConfig): Promise<void> {
  await fs.mkdir(path.dirname(TOKEN_STORE_PATH), { recursive: true });
  await fs.writeFile(TOKEN_STORE_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
}
