import { describe, it, expect, vi, beforeEach } from 'vitest';

// cross-spawn's sync export is the default export. vi.mock replaces the whole
// module so we can control spawn.sync's return value and verify runSync
// translates both failure modes into the execFileSync-equivalent throws.
vi.mock('cross-spawn', () => ({
  default: { sync: vi.fn() },
}));

import spawn from 'cross-spawn';
import { runSync } from '../shared/exec.js';

describe('runSync', () => {
  beforeEach(() => {
    vi.mocked(spawn.sync).mockReset();
  });

  it('returns normally when spawn exits with status 0', () => {
    vi.mocked(spawn.sync).mockReturnValueOnce({
      pid: 1, output: [], stdout: Buffer.from(''), stderr: Buffer.from(''),
      status: 0, signal: null,
    });
    expect(() => runSync('which', ['claude'])).not.toThrow();
    expect(spawn.sync).toHaveBeenCalledWith('which', ['claude'], {});
  });

  it('rethrows spawn.error when the binary cannot be spawned', () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.mocked(spawn.sync).mockReturnValueOnce({
      pid: 0, output: [], stdout: Buffer.from(''), stderr: Buffer.from(''),
      status: null, signal: null, error: err,
    });
    expect(() => runSync('nonexistent-bin', [])).toThrow(err);
  });

  it('throws when spawn exits with a non-zero status (matches execFileSync semantics)', () => {
    vi.mocked(spawn.sync).mockReturnValueOnce({
      pid: 1, output: [], stdout: Buffer.from(''), stderr: Buffer.from(''),
      status: 1, signal: null,
    });
    expect(() => runSync('which', ['does-not-exist'])).toThrow(
      /which does-not-exist exited with status 1/,
    );
  });

  it('passes the options object through to spawn.sync unchanged', () => {
    vi.mocked(spawn.sync).mockReturnValueOnce({
      pid: 1, output: [], stdout: Buffer.from(''), stderr: Buffer.from(''),
      status: 0, signal: null,
    });
    runSync('claude', ['mcp', 'add'], { stdio: 'inherit' });
    expect(spawn.sync).toHaveBeenCalledWith('claude', ['mcp', 'add'], { stdio: 'inherit' });
  });
});
