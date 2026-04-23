import { HostAdapter, HostPresence, OAuthConfig } from '../types.js';
import { MCP_URL, OAUTH_CLIENT_ID, SKILL_TEXT } from '../config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

// Only the slice of ~/.claude/settings.json this adapter actually reads or
// writes. The index signature preserves unknown keys on round-trip so we
// never clobber fields Claude Code added but we don't know about.
interface ClaudeHookEntry {
  type: 'command';
  command: string;
}
interface ClaudeHookMatcher {
  matcher?: string;
  hooks?: ClaudeHookEntry[];
}
interface ClaudeHooks {
  PreToolUse?: ClaudeHookMatcher[];
  PostToolUse?: ClaudeHookMatcher[];
  UserPromptSubmit?: ClaudeHookMatcher[];
  Stop?: ClaudeHookMatcher[];
  [key: string]: ClaudeHookMatcher[] | undefined;
}
interface ClaudeSettings {
  mcpServers?: Record<string, unknown>;
  hooks?: ClaudeHooks;
  [key: string]: unknown;
}

export class ClaudeCodeAdapter implements HostAdapter {
  id = 'claude-code';
  displayName = 'Claude Code';
  capabilities = { mcpPrompts: true, hooks: true };

  private get settingsPath() {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  private get skillPath() {
    return path.join(os.homedir(), '.claude', 'skills', 'custena-pay.md');
  }

  async detect(): Promise<HostPresence> {
    const claudeDir = path.join(os.homedir(), '.claude');
    // Check ~/.claude/ exists
    try {
      await fs.access(claudeDir);
      return { installed: true, configPath: this.settingsPath };
    } catch {}
    // Check claude binary on PATH
    try {
      execFileSync('which', ['claude'], { stdio: 'ignore' });
      return { installed: true, configPath: this.settingsPath };
    } catch {}
    // Check VS Code extension
    const vscodePath = path.join(os.homedir(), '.vscode', 'extensions');
    try {
      const entries = await fs.readdir(vscodePath);
      if (entries.some(e => e.includes('claude'))) {
        return { installed: true, configPath: this.settingsPath };
      }
    } catch {}
    return { installed: false };
  }

  async writeMcpConfig(_oauth: OAuthConfig): Promise<void> {
    // Register via the `claude mcp add` CLI — that's the authoritative path
    // (`claude mcp list` and runtime MCP resolution both read the registry
    // this CLI maintains in ~/.claude.json, NOT ~/.claude/settings.json).
    // Remove first for idempotency; ignore failure when no entry exists.
    try {
      execFileSync('claude', ['mcp', 'remove', 'custena', '--scope', 'user'], { stdio: 'ignore' });
    } catch {}
    // `claude mcp add` takes URL as a positional arg (not --url):
    //   claude mcp add --transport http --scope user --client-id <id> <name> <url>
    // Passing --client-id tells Claude Code's MCP SDK to skip Dynamic Client
    // Registration and use the pre-registered Keycloak client that already has
    // the right scopes (custena:buyer, offline_access), redirect URIs, and
    // PKCE config. Without this flag, the SDK creates a fresh client per
    // install attempt with minimal scopes, which then 400s on /authorize.
    // argv form (not a shell string) so OAUTH_CLIENT_ID and MCP_URL — both
    // env-overridable — can't inject shell metacharacters. See review:
    // strings passed to execSync are parsed by /bin/sh; argv arrays aren't.
    execFileSync(
      'claude',
      [
        'mcp', 'add',
        '--transport', 'http',
        '--scope', 'user',
        '--client-id', OAUTH_CLIENT_ID,
        'custena', MCP_URL,
      ],
      { stdio: 'inherit' },
    );

    // Also clean up any legacy mcpServers.custena entry that earlier versions
    // of this adapter wrote directly to ~/.claude/settings.json — that entry
    // uses the wrong field name and was never picked up by Claude Code.
    const settings = await this.readSettings();
    if (settings.mcpServers?.custena) {
      delete settings.mcpServers.custena;
      if (Object.keys(settings.mcpServers).length === 0) {
        delete settings.mcpServers;
      }
      await this.writeSettings(settings);
    }
  }

  async writeSkill(): Promise<void> {
    // Claude Code with mcpPrompts=true loads skill from MCP prompt,
    // but we also write the file as a fallback
    await fs.mkdir(path.dirname(this.skillPath), { recursive: true });
    await fs.writeFile(this.skillPath, SKILL_TEXT, 'utf-8');
  }

  async writeHooks(): Promise<void> {
    const settings = await this.readSettings();
    settings.hooks = settings.hooks ?? {};

    const makeHook = (cmd: string): ClaudeHookEntry[] => [{ type: 'command', command: cmd }];
    const hookExists = (arr: ClaudeHookMatcher[], cmd: string) =>
      arr.some(h => h?.hooks?.some(x => x?.command === cmd));

    const preCmd = 'npx custena-connect hook pre-tool-use';
    const postCmd = 'npx custena-connect hook post-tool-use';
    const promptCmd = 'npx custena-connect hook user-prompt';
    const stopCmd = 'npx custena-connect hook stop';

    if (!hookExists(settings.hooks.PreToolUse ?? [], preCmd)) {
      settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), { matcher: '.*', hooks: makeHook(preCmd) }];
    }
    if (!hookExists(settings.hooks.PostToolUse ?? [], postCmd)) {
      settings.hooks.PostToolUse = [...(settings.hooks.PostToolUse ?? []), { matcher: '.*', hooks: makeHook(postCmd) }];
    }
    if (!hookExists(settings.hooks.UserPromptSubmit ?? [], promptCmd)) {
      settings.hooks.UserPromptSubmit = [...(settings.hooks.UserPromptSubmit ?? []), { hooks: makeHook(promptCmd) }];
    }
    if (!hookExists(settings.hooks.Stop ?? [], stopCmd)) {
      settings.hooks.Stop = [...(settings.hooks.Stop ?? []), { hooks: makeHook(stopCmd) }];
    }

    await this.writeSettings(settings);
  }

  async removeAll(): Promise<void> {
    // Remove the MCP server via the claude CLI — the authoritative path for
    // anything installed after the writeMcpConfig fix. Try both scopes in
    // case an older local-scope entry is lying around. Ignore failures.
    for (const scope of ['user', 'local'] as const) {
      try {
        execFileSync('claude', ['mcp', 'remove', 'custena', '--scope', scope], { stdio: 'ignore' });
      } catch {}
    }

    const settings = await this.readSettings();

    // Backward compat: strip the legacy mcpServers.custena entry that earlier
    // versions of this adapter wrote directly to ~/.claude/settings.json.
    if (settings.mcpServers?.custena) delete settings.mcpServers.custena;

    // Remove custena hooks from every hook category.
    const hooks = settings.hooks ?? {};
    for (const key of Object.keys(hooks)) {
      const arr = hooks[key];
      if (Array.isArray(arr)) {
        hooks[key] = arr.filter(h => !JSON.stringify(h).includes('custena-connect'));
      }
    }
    await this.writeSettings(settings);

    // Remove skill file
    try { await fs.unlink(this.skillPath); } catch {}
  }

  private async readSettings(): Promise<ClaudeSettings> {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf-8');
      return JSON.parse(content) as ClaudeSettings;
    } catch {
      return {};
    }
  }

  private async writeSettings(settings: ClaudeSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  }
}
