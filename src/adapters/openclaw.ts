import { HostAdapter, HostPresence, OAuthConfig } from '../types.js';
import { MCP_URL, SKILL_TEXT } from '../config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { runSync } from '../shared/exec.js';

// Only the slice of ~/.openclaw/openclaw.json this adapter touches. Unknown
// keys flow through the index signature so round-tripping the file doesn't
// clobber fields OpenClaw added but we don't know about.
interface OpenClawMcpServer {
  url: string;
  headers?: Record<string, string>;
}
interface OpenClawConfig {
  mcp?: {
    servers?: Record<string, OpenClawMcpServer | undefined>;
  };
  [key: string]: unknown;
}

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
      runSync('which', ['openclaw'], { stdio: 'ignore' });
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
      runSync('openclaw', ['mcp', 'set', 'custena', serverJson], { stdio: 'inherit' });
    } catch {
      await this.writeConfigFallback(oauth.accessToken);
    }
  }

  private async writeConfigFallback(accessToken: string): Promise<void> {
    let config: OpenClawConfig = {};
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      try {
        config = JSON.parse(raw) as OpenClawConfig;
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

  async writeSkill(): Promise<void> {
    await fs.mkdir(path.dirname(this.skillPath), { recursive: true });
    await fs.writeFile(this.skillPath, SKILL_FRONTMATTER + SKILL_TEXT, 'utf-8');
  }

  async writeHooks(): Promise<void> {} // OpenClaw has no hook system.

  async removeAll(): Promise<void> {
    try { runSync('openclaw', ['mcp', 'unset', 'custena'], { stdio: 'ignore' }); } catch {}

    // Also clean up JSON directly in case CLI wasn't available during install.
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(raw) as OpenClawConfig;
      if (config.mcp?.servers?.custena) {
        delete config.mcp.servers.custena;
        await fs.writeFile(this.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      }
    } catch {}

    try { await fs.unlink(this.skillPath); } catch {}
  }
}
