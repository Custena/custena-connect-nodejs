import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';

// We mock 'fs/promises' and 'child_process' before importing the adapter
vi.mock('fs/promises');
vi.mock('child_process');

import fs from 'fs/promises';
import { execFileSync } from 'child_process';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');
const VSCODE_EXTENSIONS = path.join(HOME, '.vscode', 'extensions');

describe('ClaudeCodeAdapter.detect()', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns installed=true when ~/.claude directory exists', async () => {
    // fs.access resolves (no throw) → directory exists
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);

    const result = await adapter.detect();

    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(SETTINGS_PATH);
    expect(fs.access).toHaveBeenCalledWith(CLAUDE_DIR);
  });

  it('falls back to `which claude` binary check when ~/.claude is absent', async () => {
    // First access call throws (directory not found)
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    // execFileSync('which', ['claude']) succeeds (no throw)
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from('/usr/local/bin/claude'));

    const result = await adapter.detect();

    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(SETTINGS_PATH);
    expect(execFileSync).toHaveBeenCalledWith('which', ['claude'], { stdio: 'ignore' });
  });

  it('falls back to VS Code extension scan when directory and binary are absent', async () => {
    // ~/.claude access fails
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    // which claude fails
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('not found'); });
    // readdir returns a list containing a claude extension
    vi.mocked(fs.readdir).mockResolvedValueOnce(
      ['anthropic.claude-vscode-1.0.0'] as any
    );

    const result = await adapter.detect();

    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(SETTINGS_PATH);
    expect(fs.readdir).toHaveBeenCalledWith(VSCODE_EXTENSIONS);
  });

  it('returns installed=false when none of the three checks find Claude', async () => {
    // ~/.claude access fails
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    // which claude fails
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('not found'); });
    // VS Code extensions dir has no claude entries
    vi.mocked(fs.readdir).mockResolvedValueOnce(
      ['ms-vscode.csharp-1.0.0', 'esbenp.prettier-vscode-1.0.0'] as any
    );

    const result = await adapter.detect();

    expect(result.installed).toBe(false);
    expect(result.configPath).toBeUndefined();
  });

  it('returns installed=false when VS Code extensions directory does not exist', async () => {
    // ~/.claude access fails
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    // which claude fails
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('not found'); });
    // readdir throws (no .vscode/extensions dir)
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error('ENOENT'));

    const result = await adapter.detect();

    expect(result.installed).toBe(false);
  });
});
