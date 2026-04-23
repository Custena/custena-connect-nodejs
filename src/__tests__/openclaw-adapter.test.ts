import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';

vi.mock('fs/promises');
vi.mock('child_process');

import fs from 'fs/promises';
import { execSync, execFileSync } from 'child_process';
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

describe('OpenClawAdapter.writeMcpConfig()', () => {
  let adapter: OpenClawAdapter;
  beforeEach(() => { adapter = new OpenClawAdapter(); vi.clearAllMocks(); });

  it('uses the openclaw CLI when available', async () => {
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from(''));

    await adapter.writeMcpConfig(MOCK_OAUTH);

    expect(execFileSync).toHaveBeenCalledOnce();
    const [cmd, args] = vi.mocked(execFileSync).mock.calls[0] as [string, string[]];
    expect(cmd).toBe('openclaw');
    expect(args[0]).toBe('mcp');
    expect(args[1]).toBe('set');
    expect(args[2]).toBe('custena');
    const json = JSON.parse(args[3]);
    expect(json.url).toBe('https://api.custena.com/mcp');
    expect(json.headers.Authorization).toBe('Bearer test-access-token');
  });

  it('falls back to direct JSON write when CLI throws', async () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('command not found'); });
    vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await adapter.writeMcpConfig(MOCK_OAUTH);

    expect(fs.writeFile).toHaveBeenCalledOnce();
    const [writePath, content] = vi.mocked(fs.writeFile).mock.calls[0] as [string, string];
    expect(writePath).toBe(CONFIG_PATH);
    const written = JSON.parse(content);
    expect(written.mcp.servers.custena.url).toBe('https://api.custena.com/mcp');
    expect(written.mcp.servers.custena.headers.Authorization).toBe('Bearer test-access-token');
  });

  it('merges into existing JSON config without clobbering other keys', async () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('not found'); });
    const existing = JSON.stringify({ agents: { defaults: { skills: ['github'] } } });
    vi.mocked(fs.readFile).mockResolvedValueOnce(existing as any);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await adapter.writeMcpConfig(MOCK_OAUTH);

    const [, content] = vi.mocked(fs.writeFile).mock.calls[0] as [string, string];
    const written = JSON.parse(content);
    expect(written.agents.defaults.skills).toContain('github');
    expect(written.mcp.servers.custena.url).toBe('https://api.custena.com/mcp');
  });

  it('throws a helpful message when the config file exists but cannot be parsed', async () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('not found'); });
    const json5Content = '{ agents: { defaults: { skills: [] } } }'; // unquoted keys = invalid JSON
    vi.mocked(fs.readFile).mockResolvedValueOnce(json5Content as any);

    await expect(adapter.writeMcpConfig(MOCK_OAUTH)).rejects.toThrow(
      /Could not parse.*openclaw\.json.*openclaw mcp set custena/
    );
  });
});
