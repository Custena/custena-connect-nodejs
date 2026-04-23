import { HostAdapter, HostPresence, OAuthConfig } from '../types.js';
import { MCP_URL } from '../config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

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
  const lines = content.split('\n');
  const out: string[] = [];
  let inTarget = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
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

  async detect(): Promise<HostPresence> { return { installed: false }; }
  async writeMcpConfig(_oauth: OAuthConfig): Promise<void> {}
  async writeSkill(): Promise<void> {}
  async writeHooks(): Promise<void> {}
  async removeAll(): Promise<void> {}
}
