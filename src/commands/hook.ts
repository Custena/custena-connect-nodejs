import { Command } from 'commander';
import { HOOKS_URL, HOOK_QUEUE_PATH } from '../config.js';
import { loadToken } from '../auth/oauth.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Event-scoped fallback UUID used when the host doesn't supply a session_id in the payload.
// Claude Code invokes this command as a new subprocess per event, so this UUID is unique
// per event — it is NOT shared across events from the same session.
const PROCESS_SESSION_ID = crypto.randomUUID();

const EVENT_TYPE_MAP: Record<string, string> = {
  'pre-tool-use': 'PRE_TOOL_USE',
  'post-tool-use': 'POST_TOOL_USE',
  'user-prompt': 'USER_PROMPT',
  'stop': 'STOP',
};

// The slice of the hook payload this command reads. Claude Code controls the
// full shape — we only name the fields we consume. Additional fields flow
// through unread without a type error.
export interface HookPayload {
  session_id?: string;
  sessionId?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  duration_ms?: number;
  error?: string;
  user_message?: string;
}

// GDPR data minimisation (Art. 5(1)(c)): for tool-use events, only forward
// events tied to Custena MCP tools. Bash commands, file paths, and other
// tool args have no lawful basis for collection and are silently dropped.
// USER_PROMPT and STOP are session lifecycle events with no sensitive args.
// Exported for regression tests — a silent regression here reintroduces a
// personal-data collection bug with no user-visible symptom.
export function shouldForwardHookEvent(
  eventType: string,
  payload: HookPayload,
): boolean {
  if (eventType !== 'PRE_TOOL_USE' && eventType !== 'POST_TOOL_USE') return true;
  const tool = payload.tool_name ?? payload.toolName ?? '';
  return tool.startsWith('custena_');
}

export function hookCommand(): Command {
  return new Command('hook')
    .argument('<event>', 'Event type: pre-tool-use | post-tool-use | user-prompt | stop')
    .description('Forward a hook event to Custena (invoked by host hook config)')
    .action(async (event: string) => {
      const eventType = EVENT_TYPE_MAP[event];
      if (!eventType) {
        process.stderr.write(`Unknown hook event: ${event}\n`);
        process.exit(1);
      }

      // Read hook payload from stdin
      let rawInput = '';
      for await (const chunk of process.stdin) rawInput += chunk;

      let payload: HookPayload = {};
      try { payload = JSON.parse(rawInput) as HookPayload; } catch {}

      if (!shouldForwardHookEvent(eventType, payload)) {
        process.exit(0);
      }

      const body = {
        sessionId: payload.session_id ?? payload.sessionId ?? PROCESS_SESSION_ID,
        eventType,
        toolName: payload.tool_name ?? payload.toolName ?? null,
        toolInputSummary: payload.tool_input ? JSON.stringify(payload.tool_input).slice(0, 4000) : null,
        toolOutputSummary: payload.tool_response ? JSON.stringify(payload.tool_response).slice(0, 4000) : null,
        durationMs: payload.duration_ms ?? null,
        error: payload.error ?? null,
        userPromptPreview: payload.user_message ? String(payload.user_message).slice(0, 200) : null,
        occurredAt: new Date().toISOString(),
      };

      await sendEvent(body);
    });
}

async function sendEvent(body: object): Promise<void> {
  const token = await loadToken();
  if (!token) {
    await appendToQueue(body);
    return;
  }

  try {
    const res = await fetch(HOOKS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.accessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      await drainQueue(token.accessToken);
    } else {
      await appendToQueue(body);
    }
  } catch {
    await appendToQueue(body);
  }
}

async function appendToQueue(body: object): Promise<void> {
  try {
    await fs.mkdir(path.dirname(HOOK_QUEUE_PATH), { recursive: true });
    await fs.appendFile(HOOK_QUEUE_PATH, JSON.stringify(body) + '\n', { encoding: 'utf-8', mode: 0o600 });
  } catch {}
}

async function drainQueue(accessToken: string): Promise<void> {
  try {
    const content = await fs.readFile(HOOK_QUEUE_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return;

    const failed: string[] = [];
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const res = await fetch(HOOKS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify(item),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) failed.push(line);
      } catch {
        failed.push(line);
      }
    }
    if (failed.length === 0) {
      await fs.unlink(HOOK_QUEUE_PATH);
    } else {
      await fs.writeFile(HOOK_QUEUE_PATH, failed.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
    }
  } catch {}
}
