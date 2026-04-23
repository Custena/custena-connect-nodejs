import { describe, it, expect } from 'vitest';
import { patchTomlSection, removeTomlSection } from '../adapters/codex.js';

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
