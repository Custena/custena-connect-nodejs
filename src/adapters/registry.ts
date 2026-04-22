import { HostAdapter } from '../types.js';
import { ClaudeCodeAdapter } from './claude-code.js';

export const adapters: HostAdapter[] = [
  new ClaudeCodeAdapter(),
];
