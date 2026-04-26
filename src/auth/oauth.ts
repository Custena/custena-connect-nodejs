import crypto from 'crypto';
import http from 'http';
import { OAuthConfig } from '../types.js';
import { API_BASE_URL, TOKEN_STORE_PATH } from '../config.js';
import fs from 'fs/promises';
import path from 'path';

// The OAuth endpoints — in prod these come from the resource metadata
const KEYCLOAK_BASE = process.env.CUSTENA_KEYCLOAK_URL ?? 'https://api.custena.com/auth/realms/custena';
const CLIENT_ID = 'custena-connect-cli';
const CALLBACK_PORT = 9874;
const CALLBACK_PATH = '/callback';
const SETUP_DONE_PATH = '/setup-done';

export type RunOAuthOptions = {
  /**
   * When true, the callback server stays open after the browser is redirected
   * so the same port can later receive the `/setup-done` signal from the
   * dashboard setup page. The returned `waitForSetup()` resolves once that
   * signal arrives (or rejects on timeout).
   */
  awaitSetupCompletion?: boolean;
};

export type RunOAuthResult = {
  config: OAuthConfig;
  /** Only present when `awaitSetupCompletion: true`. */
  waitForSetup?: () => Promise<{ agentName: string; connectedAgentId: string }>;
};

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

// Exported so security-regression tests can exercise these predicates
// without spinning up the callback server. Each guards a path where the
// wrong answer silently reintroduces a known vulnerability class.
export function isStateValid(received: string | null, expected: string): boolean {
  return received !== null && received === expected;
}

export function isOriginAllowed(origin: string | null, allowed: string | null): boolean {
  return origin !== null && allowed !== null && origin === allowed;
}

export async function runOAuthFlow(options: RunOAuthOptions = {}): Promise<RunOAuthResult> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
  const authUrl = new URL(`${KEYCLOAK_BASE}/protocol/openid-connect/auth`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid custena:buyer offline_access');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const callbackFlow = startCallbackServer({
    expectedState,
    codeVerifier,
    redirectUri,
    keepOpen: options.awaitSetupCompletion === true,
  });
  const { default: open } = await import('open');
  await open(authUrl.toString());

  const { config, waitForSetup } = await callbackFlow;
  await saveToken(config);
  return { config, waitForSetup };

  function expectedState() {
    return state;
  }
}

type CallbackFlowArgs = {
  expectedState: () => string;
  codeVerifier: string;
  redirectUri: string;
  keepOpen: boolean;
};

// Consolidates three responsibilities the flow used to split across callers:
//   1. wait for the OAuth redirect
//   2. exchange the code for tokens
//   3. redirect the browser to the dashboard setup page (so the user never sees
//      a placeholder "you can close this tab" page in between)
// If `keepOpen` is true, the server stays listening for the `/setup-done`
// signal that the dashboard setup page pings once authorization is complete.
async function startCallbackServer(
  args: CallbackFlowArgs,
): Promise<{ config: OAuthConfig; waitForSetup?: () => Promise<{ agentName: string; connectedAgentId: string }> }> {
  return new Promise((resolveCallback, rejectCallback) => {
    let setupResolver: ((v: { agentName: string; connectedAgentId: string }) => void) | null = null;
    let setupRejecter: ((e: Error) => void) | null = null;
    let setupTimer: NodeJS.Timeout | null = null;
    let server: http.Server | null = null;
    // Dashboard origin the /setup-done POST is expected from. Locked in once we
    // receive the setupUrl from the backend — adversarial pages the user visits
    // during install can't forge a completion signal because we reject Origin
    // headers that don't match. Keeps wildcard CORS off the callback server.
    let allowedOrigin: string | null = null;

    const closeServer = () => {
      if (setupTimer) clearTimeout(setupTimer);
      if (server) server.close();
    };

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === CALLBACK_PATH) {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !isStateValid(state, args.expectedState())) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end('<html><body>OAuth error. Re-run <code>custena-connect install</code>.</body></html>');
          rejectCallback(new Error('OAuth callback state mismatch'));
          closeServer();
          return;
        }

        try {
          const config = await exchangeCodeForTokens(code, args.redirectUri, args.codeVerifier);
          // Hit the backend with the fresh access token to get a setupUrl the
          // browser can be redirected to. The backend resolves the new
          // connected_agent row from the JWT azp — no ID needed client-side.
          const setupResponse = await requestSetupToken(config.accessToken);
          try {
            allowedOrigin = new URL(setupResponse.setupUrl).origin;
          } catch {
            // Malformed setupUrl — leave allowedOrigin null and the POST path
            // below rejects everything. User re-runs install.
          }

          res.writeHead(302, { Location: setupResponse.setupUrl }).end();

          if (args.keepOpen) {
            resolveCallback({
              config,
              waitForSetup: () =>
                new Promise((resolveSetup, rejectSetup) => {
                  setupResolver = resolveSetup;
                  setupRejecter = rejectSetup;
                  // 30 minutes matches the setup-token TTL on the backend
                  // (ConnectSetupService). After that window the backend
                  // reaps the orphan row; re-running install is the only
                  // recovery path.
                  setupTimer = setTimeout(() => {
                    rejectSetup(new Error('Setup not completed within 30 minutes'));
                    closeServer();
                  }, 30 * 60 * 1000);
                }),
            });
          } else {
            resolveCallback({ config });
            closeServer();
          }
        } catch (e) {
          res
            .writeHead(500, { 'Content-Type': 'text/html' })
            .end('<html><body>Token exchange failed. Re-run <code>custena-connect install</code>.</body></html>');
          rejectCallback(e as Error);
          closeServer();
        }
        return;
      }

      if (args.keepOpen && url.pathname === SETUP_DONE_PATH) {
        // Origin-lock: reject unless the Origin header matches the dashboard
        // URL returned by the backend. Any web page the user might visit
        // during install that POSTs to localhost:9874 is filtered out —
        // wildcard CORS would let them forge a completion signal.
        const origin = req.headers.origin ?? null;
        const originOk = isOriginAllowed(origin, allowedOrigin);

        if (req.method === 'OPTIONS') {
          if (!originOk) {
            res.writeHead(403).end();
            return;
          }
          res.writeHead(204, {
            'Access-Control-Allow-Origin': allowedOrigin!,
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          }).end();
          return;
        }

        if (req.method === 'POST') {
          if (!originOk) {
            res.writeHead(403).end();
            return;
          }
          let body = '';
          for await (const chunk of req) body += chunk;
          let parsed: { agentName?: string; connectedAgentId?: string } = {};
          try { parsed = JSON.parse(body); } catch {}
          res.writeHead(204, {
            'Access-Control-Allow-Origin': allowedOrigin!,
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST',
          }).end();
          if (setupResolver) {
            setupResolver({
              agentName: parsed.agentName ?? 'Agent',
              connectedAgentId: parsed.connectedAgentId ?? '',
            });
            setupResolver = null;
            setupRejecter = null;
            closeServer();
          }
          return;
        }
      }

      res.writeHead(404).end();
    });

    const oauthTimeout = setTimeout(() => {
      if (server) server.close();
      rejectCallback(new Error('OAuth login timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    server.listen(CALLBACK_PORT);
    server.on('error', (err) => {
      clearTimeout(oauthTimeout);
      rejectCallback(err);
    });
    server.on('close', () => clearTimeout(oauthTimeout));
  });
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<OAuthConfig> {
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
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    clientId: CLIENT_ID,
  };
}

async function requestSetupToken(accessToken: string): Promise<{ token: string; setupUrl: string; expiresAt: string }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/buyer/connected-agents/setup-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Failed to issue setup token: ${res.status}`);
  return res.json() as Promise<{ token: string; setupUrl: string; expiresAt: string }>;
}

export async function loadToken(): Promise<OAuthConfig | null> {
  try {
    const content = await fs.readFile(TOKEN_STORE_PATH, 'utf-8');
    const config = JSON.parse(content) as OAuthConfig;
    // Treat tokens expiring within 60 s as absent so callers fall through to the queue path
    // rather than sending a request that will return 401, filling the queue with unsendable events.
    if (config.expiresAt < Date.now() + 60_000) return null;
    return config;
  } catch {
    return null;
  }
}

export async function saveToken(config: OAuthConfig): Promise<void> {
  await fs.mkdir(path.dirname(TOKEN_STORE_PATH), { recursive: true });
  await fs.writeFile(TOKEN_STORE_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
}
