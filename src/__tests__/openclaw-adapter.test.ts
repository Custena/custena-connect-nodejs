import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';

vi.mock('fs/promises');
vi.mock('child_process');

import fs from 'fs/promises';
import { execSync } from 'child_process';
import { OpenClawAdapter } from '../adapters/openclaw.js';

const HOME = os.homedir();
const OPENCLAW_DIR = path.join(HOME, '.openclaw');
const CONFIG_PATH = path.join(OPENCLAW_DIR, 'openclaw.json');
const SKILL_PATH = path.join(OPENCLAW_DIR, 'skills', 'custena-pay.md');
const MOCK_OAUTH = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: 9_999_999_999,
  clientId: 'custena-connect-cli',
};

describe('OpenClawAdapter.detect()', () => {
  let adapter: OpenClawAdapter;
  beforeEach(() => { adapter = new OpenClawAdapter(); vi.clearAllMocks(); });

  it('returns installed=true when ~/.openclaw directory exists', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(CONFIG_PATH);
    expect(fs.access).toHaveBeenCalledWith(OPENCLAW_DIR);
  });

  it('falls back to `which openclaw` when ~/.openclaw is absent', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(execSync).mockReturnValueOnce(Buffer.from('/usr/bin/openclaw'));
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(CONFIG_PATH);
    expect(execSync).toHaveBeenCalledWith('which openclaw', { stdio: 'ignore' });
  });

  it('returns installed=false when neither check succeeds', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('not found'); });
    const result = await adapter.detect();
    expect(result.installed).toBe(false);
    expect(result.configPath).toBeUndefined();
  });
});
