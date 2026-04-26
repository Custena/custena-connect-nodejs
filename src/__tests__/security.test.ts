import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs/promises');

import fs from 'fs/promises';
import { isStateValid, isOriginAllowed, loadToken } from '../auth/oauth.js';
import { shouldForwardHookEvent } from '../commands/hook.js';

// These tests guard security-critical branches where a silent regression
// reintroduces a known vulnerability with no functional test failure:
// CSRF on the OAuth callback, forged /setup-done POSTs from an adversarial
// page, personal-data leakage through hooks, and near-expired tokens being
// sent on requests that then 401.

describe('OAuth state validation (CSRF guard)', () => {
  it('rejects a null state parameter', () => {
    expect(isStateValid(null, 'abc')).toBe(false);
  });

  it('rejects a state that does not match the one we issued', () => {
    expect(isStateValid('attacker-state', 'our-state')).toBe(false);
  });

  it('accepts the exact state we issued', () => {
    expect(isStateValid('s', 's')).toBe(true);
  });
});

describe('Origin-lock on /setup-done', () => {
  const allowed = 'https://dashboard.custena.com';

  it('rejects when Origin header is absent (non-browser client)', () => {
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  it('rejects a foreign Origin (page the user might visit during install)', () => {
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
  });

  it('rejects when allowedOrigin is unset (setupUrl parse failed)', () => {
    expect(isOriginAllowed(allowed, null)).toBe(false);
  });

  it('accepts an exact match', () => {
    expect(isOriginAllowed(allowed, allowed)).toBe(true);
  });
});

describe('Hook GDPR filter (drop non-custena_ tool events at source)', () => {
  it('drops PRE_TOOL_USE for Bash', () => {
    expect(shouldForwardHookEvent('PRE_TOOL_USE', { tool_name: 'Bash' })).toBe(false);
  });

  it('drops POST_TOOL_USE for WebFetch (snake_case and camelCase)', () => {
    expect(shouldForwardHookEvent('POST_TOOL_USE', { toolName: 'WebFetch' })).toBe(false);
  });

  it('drops tool-use events with missing tool_name (no way to verify prefix)', () => {
    expect(shouldForwardHookEvent('PRE_TOOL_USE', {})).toBe(false);
  });

  it('forwards PRE_TOOL_USE for custena_pay_challenge', () => {
    expect(shouldForwardHookEvent('PRE_TOOL_USE', { tool_name: 'custena_pay_challenge' })).toBe(true);
  });

  it('forwards lifecycle events (USER_PROMPT, STOP) regardless of tool_name', () => {
    expect(shouldForwardHookEvent('USER_PROMPT', {})).toBe(true);
    expect(shouldForwardHookEvent('STOP', { tool_name: 'Bash' })).toBe(true);
  });
});

describe('Token expiry (loadToken must treat near-expired tokens as absent)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when the stored token expires within 60 seconds', async () => {
    const token = JSON.stringify({
      accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 30_000, clientId: 'c',
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(token as any);
    expect(await loadToken()).toBeNull();
  });

  it('returns null for an already-expired token', async () => {
    const token = JSON.stringify({
      accessToken: 't', refreshToken: 'r', expiresAt: Date.now() - 1000, clientId: 'c',
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(token as any);
    expect(await loadToken()).toBeNull();
  });

  it('returns the token when expiry is comfortably in the future', async () => {
    const token = JSON.stringify({
      accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 10 * 60_000, clientId: 'c',
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(token as any);
    const loaded = await loadToken();
    expect(loaded).not.toBeNull();
    expect(loaded!.accessToken).toBe('t');
  });

  it('returns null when the token file is missing', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await loadToken()).toBeNull();
  });
});
