import { describe, it, expect, vi } from 'vitest';
import { selectHosts } from '../commands/install.js';
import type { HostAdapter, HostPresence } from '../types.js';

vi.mock('@inquirer/prompts', () => ({
  checkbox: vi.fn(),
}));

import { checkbox } from '@inquirer/prompts';

function makeDetected(ids: string[]) {
  return ids.map(id => ({
    adapter: { id, displayName: id.toUpperCase() } as unknown as HostAdapter,
    presence: { installed: true } as HostPresence,
  }));
}

describe('selectHosts()', () => {
  it('returns the single entry without prompting when only one host is detected', async () => {
    const detected = makeDetected(['claude-code']);
    const result = await selectHosts(detected);
    expect(result).toEqual(detected);
    expect(checkbox).not.toHaveBeenCalled();
  });

  it('calls checkbox and returns user selection when multiple hosts are detected', async () => {
    const detected = makeDetected(['claude-code', 'codex', 'openclaw']);
    const claudeEntry = detected[0];
    const codexEntry = detected[1];
    vi.mocked(checkbox).mockResolvedValueOnce([claudeEntry.adapter, codexEntry.adapter] as any);

    const result = await selectHosts(detected);

    expect(checkbox).toHaveBeenCalledOnce();
    const [{ choices }] = vi.mocked(checkbox).mock.calls[0] as any;
    expect(choices).toHaveLength(3);
    expect(choices.every((c: any) => c.checked)).toBe(true);
    expect(result.map(d => d.adapter.id)).toEqual(['claude-code', 'codex']);
  });

  it('returns empty array when user deselects all', async () => {
    const detected = makeDetected(['claude-code', 'codex']);
    vi.mocked(checkbox).mockResolvedValueOnce([] as any);
    const result = await selectHosts(detected);
    expect(result).toHaveLength(0);
  });
});
