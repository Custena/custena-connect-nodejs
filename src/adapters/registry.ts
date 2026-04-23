import { HostAdapter } from '../types.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CodxAdapter } from './codex.js';
import { OpenClawAdapter } from './openclaw.js';

export const adapters: HostAdapter[] = [
  new ClaudeCodeAdapter(),
  new CodxAdapter(),
  new OpenClawAdapter(),
];
