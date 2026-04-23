import { HostAdapter, HostPresence, OAuthConfig } from '../types.js';
import { MCP_URL, SKILL_TEXT } from '../config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync, execFileSync } from 'child_process';

const SKILL_FRONTMATTER = `---
name: custena-pay
description: Pay HTTP 402 payment gates automatically through Custena
---

`;

export class OpenClawAdapter implements HostAdapter {
  id = 'openclaw';
  displayName = 'OpenClaw';
  capabilities = { mcpPrompts: false, hooks: false };

  private get configDir() { return path.join(os.homedir(), '.openclaw'); }
  private get configPath() { return path.join(this.configDir, 'openclaw.json'); }
  private get skillPath() { return path.join(this.configDir, 'skills', 'custena-pay.md'); }

  async detect(): Promise<HostPresence> {
    try {
      await fs.access(this.configDir);
      return { installed: true, configPath: this.configPath };
    } catch {}
    try {
      execSync('which openclaw', { stdio: 'ignore' });
      return { installed: true, configPath: this.configPath };
    } catch {}
    return { installed: false };
  }

  async writeMcpConfig(oauth: OAuthConfig): Promise<void> {
    const serverJson = JSON.stringify({
      url: MCP_URL,
      headers: { Authorization: `Bearer ${oauth.accessToken}` },
    });

    try {
      execFileSync('openclaw', ['mcp', 'set', 'custena', serverJson], { stdio: 'inherit' });
    } catch {
      await this.writeConfigFallback(oauth.accessToken);
    }
  }

  private async writeConfigFallback(accessToken: string): Promise<void> {
    let config: any = {};
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      try {
        config = JSON.parse(raw);
      } catch {
        const serverJson = JSON.stringify({
          url: MCP_URL,
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        throw new Error(
          `Could not parse ~/.openclaw/openclaw.json (may be JSON5 format). ` +
          `Run manually: openclaw mcp set custena '${serverJson}'`,
        );
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
    }

    config.mcp = config.mcp ?? {};
    config.mcp.servers = config.mcp.servers ?? {};
    config.mcp.servers.custena = {
      url: MCP_URL,
      headers: { Authorization: `Bearer ${accessToken}` },
    };

    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  async writeSkill(): Promise<void> {}
  async writeHooks(): Promise<void> {} // OpenClaw has no hook system.
  async removeAll(): Promise<void> {}
}
