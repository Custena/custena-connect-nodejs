import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';

// We mock 'fs/promises' and the shared exec wrapper before importing the adapter.
// The adapter now goes through runSync (which wraps cross-spawn) instead of
// execFileSync directly, so PATHEXT resolution works on Windows.
vi.mock('fs/promises');
vi.mock('../shared/exec.js');

import fs from 'fs/promises';
import { runSync } from '../shared/exec.js';
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
    // runSync('which', ['claude']) succeeds (no throw, returns void)
    vi.mocked(runSync).mockReturnValueOnce(undefined);

    const result = await adapter.detect();

    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(SETTINGS_PATH);
    expect(runSync).toHaveBeenCalledWith('which', ['claude'], { stdio: 'ignore' });
  });

  it('falls back to VS Code extension scan when directory and binary are absent', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(runSync).mockImplementationOnce(() => { throw new Error('not found'); });
    vi.mocked(fs.readdir).mockResolvedValueOnce(
      ['anthropic.claude-vscode-1.0.0'] as any
    );

    const result = await adapter.detect();

    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(SETTINGS_PATH);
    expect(fs.readdir).toHaveBeenCalledWith(VSCODE_EXTENSIONS);
  });

  it('returns installed=false when none of the three checks find Claude', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(runSync).mockImplementationOnce(() => { throw new Error('not found'); });
    vi.mocked(fs.readdir).mockResolvedValueOnce(
      ['ms-vscode.csharp-1.0.0', 'esbenp.prettier-vscode-1.0.0'] as any
    );

    const result = await adapter.detect();

    expect(result.installed).toBe(false);
    expect(result.configPath).toBeUndefined();
  });

  it('returns installed=false when VS Code extensions directory does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(runSync).mockImplementationOnce(() => { throw new Error('not found'); });
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error('ENOENT'));

    const result = await adapter.detect();

    expect(result.installed).toBe(false);
  });
});
