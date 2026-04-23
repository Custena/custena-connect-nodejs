import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';

vi.mock('fs/promises');
vi.mock('child_process');

import fs from 'fs/promises';
import { execFileSync } from 'child_process';
import { CodxAdapter, patchTomlSection, removeTomlSection } from '../adapters/codex.js';
import { MCP_URL } from '../config.js';

const HOME = os.homedir();
const CODEX_DIR = path.join(HOME, '.codex');
const CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const MOCK_OAUTH = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: 9_999_999_999,
  clientId: 'custena-connect-cli',
};

describe('patchTomlSection()', () => {
  it('adds a new section to empty content', () => {
    const result = patchTomlSection('', 'mcp_servers.custena', {
      url: 'https://api.custena.com/mcp',
      bearer_token: 'tok123',
    });
    expect(result).toContain('[mcp_servers.custena]');
    expect(result).toContain('url = "https://api.custena.com/mcp"');
    expect(result).toContain('bearer_token = "tok123"');
  });

  it('replaces an existing custena section leaving other sections intact', () => {
    const existing = [
      '[mcp_servers.custena]',
      'url = "https://old.com"',
      'bearer_token = "old-token"',
      '',
      '[mcp_servers.other]',
      'command = "other-server"',
      '',
    ].join('\n');

    const result = patchTomlSection(existing, 'mcp_servers.custena', {
      url: 'https://new.com',
      bearer_token: 'new-token',
    });

    expect(result).not.toContain('"https://old.com"');
    expect(result).not.toContain('"old-token"');
    expect(result).toContain('url = "https://new.com"');
    expect(result).toContain('bearer_token = "new-token"');
    expect(result).toContain('[mcp_servers.other]');
    expect(result).toContain('command = "other-server"');
  });

  it('preserves content that appears before the target section', () => {
    const existing = 'model = "gpt-4o"\n\n[mcp_servers.custena]\nurl = "old"\n';
    const result = patchTomlSection(existing, 'mcp_servers.custena', { url: 'new' });
    expect(result).toContain('model = "gpt-4o"');
    expect(result).not.toContain('"old"');
  });

  it('handles section not present in file (appends)', () => {
    const existing = 'model = "gpt-4o"\n';
    const result = patchTomlSection(existing, 'mcp_servers.custena', { url: 'https://x.com' });
    expect(result).toContain('model = "gpt-4o"');
    expect(result).toContain('[mcp_servers.custena]');
    expect(result).toContain('url = "https://x.com"');
  });

  it('is idempotent — calling twice produces the same result as calling once', () => {
    const fields = { url: 'https://api.custena.com/mcp', bearer_token: 'tok' };
    const first = patchTomlSection('model = "gpt-4o"\n', 'mcp_servers.custena', fields);
    const second = patchTomlSection(first, 'mcp_servers.custena', fields);
    expect(second).toBe(first);
  });
});

describe('removeTomlSection()', () => {
  it('removes the target section and preserves everything else', () => {
    const existing = [
      '[mcp_servers.custena]',
      'url = "https://api.custena.com/mcp"',
      '',
      '[mcp_servers.other]',
      'command = "other-server"',
      '',
    ].join('\n');

    const result = removeTomlSection(existing, 'mcp_servers.custena');
    expect(result).not.toContain('[mcp_servers.custena]');
    expect(result).not.toContain('https://api.custena.com/mcp');
    expect(result).toContain('[mcp_servers.other]');
    expect(result).toContain('command = "other-server"');
  });

  it('returns content unchanged when section is not present', () => {
    const existing = '[mcp_servers.other]\ncommand = "other"\n';
    const result = removeTomlSection(existing, 'mcp_servers.custena');
    expect(result).toContain('[mcp_servers.other]');
    expect(result).not.toContain('[mcp_servers.custena]');
    expect(result).toBe(existing);
  });

  it('handles empty content gracefully', () => {
    const result = removeTomlSection('', 'mcp_servers.custena');
    expect(result).toBe('');
  });
});

describe('CodxAdapter.detect()', () => {
  let adapter: CodxAdapter;
  beforeEach(() => { adapter = new CodxAdapter(); vi.clearAllMocks(); });

  it('returns installed=true when ~/.codex directory exists', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(CONFIG_PATH);
    expect(fs.access).toHaveBeenCalledWith(CODEX_DIR);
  });

  it('falls back to `which codex` when ~/.codex is absent', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from('/usr/local/bin/codex'));
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith('which', ['codex'], { stdio: 'ignore' });
    expect(result.configPath).toBe(CONFIG_PATH);
  });

  it('returns installed=false when neither check succeeds', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('not found'); });
    const result = await adapter.detect();
    expect(result.installed).toBe(false);
    expect(result.configPath).toBeUndefined();
  });
});

describe('CodxAdapter.writeMcpConfig()', () => {
  let adapter: CodxAdapter;
  beforeEach(() => { adapter = new CodxAdapter(); vi.clearAllMocks(); });

  it('writes config.toml with [mcp_servers.custena] url and bearer_token', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await adapter.writeMcpConfig(MOCK_OAUTH);

    expect(fs.writeFile).toHaveBeenCalledOnce();
    const [writePath, content] = vi.mocked(fs.writeFile).mock.calls[0] as [string, string];
    expect(writePath).toBe(CONFIG_PATH);
    expect(content).toContain('[mcp_servers.custena]');
    expect(content).toContain(`url = ${JSON.stringify(MCP_URL)}`);
    expect(content).toContain('bearer_token = "test-access-token"');
    expect(content).toContain('default_tools_approval_mode = "approve"');
  });

  it('preserves existing non-custena TOML content', async () => {
    const existing = 'model = "gpt-4o"\nsandbox_mode = "workspace-write"\n';
    vi.mocked(fs.readFile).mockResolvedValueOnce(existing as any);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await adapter.writeMcpConfig(MOCK_OAUTH);

    const [, content] = vi.mocked(fs.writeFile).mock.calls[0] as [string, string];
    expect(content).toContain('model = "gpt-4o"');
    expect(content).toContain('sandbox_mode = "workspace-write"');
  });
});

describe('CodxAdapter.removeAll()', () => {
  let adapter: CodxAdapter;
  beforeEach(() => { adapter = new CodxAdapter(); vi.clearAllMocks(); });

  it('removes [mcp_servers.custena] section and preserves other content', async () => {
    const existing = [
      '[mcp_servers.custena]',
      'url = "https://api.custena.com/mcp"',
      'bearer_token = "tok"',
      '',
      '[mcp_servers.other]',
      'command = "other"',
      '',
    ].join('\n');
    vi.mocked(fs.readFile).mockResolvedValueOnce(existing as any);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await adapter.removeAll();

    const [, content] = vi.mocked(fs.writeFile).mock.calls[0] as [string, string];
    expect(content).not.toContain('[mcp_servers.custena]');
    expect(content).toContain('[mcp_servers.other]');
  });

  it('does nothing when config.toml does not exist', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await adapter.removeAll();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('does not write when the section is not present in the file', async () => {
    const existing = '[mcp_servers.other]\ncommand = "other"\n';
    vi.mocked(fs.readFile).mockResolvedValueOnce(existing as any);

    await adapter.removeAll();

    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
