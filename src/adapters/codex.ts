import { HostAdapter, HostPresence, OAuthConfig } from '../types.js';
import { MCP_URL } from '../config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

/**
 * Replaces (or appends) a dotted-key TOML section in `content`.
 * Uses JSON.stringify for string values — valid TOML because both formats
 * use the same escape sequences for double-quoted strings.
 */
export function patchTomlSection(
  content: string,
  sectionKey: string,
  fields: Record<string, string>,
): string {
  const header = `[${sectionKey}]`;
  const lines = content ? content.split('\n') : [];
  const out: string[] = [];
  let inTarget = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    // Note: does not handle TOML array-of-tables ([[header]]) — not used in Codex config.toml.
    if (trimmed.startsWith('[')) {
      if (inTarget) inTarget = false;
      if (trimmed === header) { inTarget = true; continue; }
    }
    if (!inTarget) out.push(line);
  }

  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  out.push('', header);
  for (const [k, v] of Object.entries(fields)) {
    out.push(`${k} = ${JSON.stringify(v)}`);
  }
  out.push('');
  return out.join('\n');
}

/** Strips a TOML section by key, leaving all other content intact. */
export function removeTomlSection(content: string, sectionKey: string): string {
  if (!content) return '';
  const header = `[${sectionKey}]`;
  const lines = content.split('\n');
  const out: string[] = [];
  let inTarget = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    // Note: does not handle TOML array-of-tables ([[header]]) — not used in Codex config.toml.
    if (trimmed.startsWith('[')) {
      if (inTarget) inTarget = false;
      if (trimmed === header) { inTarget = true; continue; }
    }
    if (!inTarget) out.push(line);
  }

  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  if (out.length > 0) out.push('');
  return out.join('\n');
}

export class CodxAdapter implements HostAdapter {
  id = 'codex';
  displayName = 'OpenAI Codex';
  capabilities = { mcpPrompts: true, hooks: false };

  private get configDir() { return path.join(os.homedir(), '.codex'); }
  private get configPath() { return path.join(this.configDir, 'config.toml'); }

  async detect(): Promise<HostPresence> {
    try {
      await fs.access(this.configDir);
      return { installed: true, configPath: this.configPath };
    } catch {}
    try {
      execFileSync('which', ['codex'], { stdio: 'ignore' });
      return { installed: true, configPath: this.configPath };
    } catch {}
    return { installed: false };
  }

  async writeMcpConfig(oauth: OAuthConfig): Promise<void> {
    const existing = await fs.readFile(this.configPath, 'utf-8').catch(() => '');
    const patched = patchTomlSection(existing, 'mcp_servers.custena', {
      url: MCP_URL,
      bearer_token: oauth.accessToken,
      default_tools_approval_mode: 'approve',
    });
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(this.configPath, patched, 'utf-8');
  }

  // Codex reads prompts from the MCP server natively (mcpPrompts: true → never called by installer).
  async writeSkill(): Promise<void> {}

  // Codex has no hook system (hooks: false → never called by installer).
  async writeHooks(): Promise<void> {}

  async removeAll(): Promise<void> {
    const existing = await fs.readFile(this.configPath, 'utf-8').catch(() => '');
    if (!existing) return;
    const patched = removeTomlSection(existing, 'mcp_servers.custena');
    if (patched !== existing) {
      await fs.writeFile(this.configPath, patched, 'utf-8');
    }
  }
}
