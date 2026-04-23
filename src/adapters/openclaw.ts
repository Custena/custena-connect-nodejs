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

  async writeMcpConfig(_oauth: OAuthConfig): Promise<void> {}
  async writeSkill(): Promise<void> {}
  async writeHooks(): Promise<void> {} // OpenClaw has no hook system.
  async removeAll(): Promise<void> {}
}
