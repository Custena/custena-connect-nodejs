import spawn from 'cross-spawn';

/**
 * Preserves execFileSync semantics (throw on spawn error, throw on non-zero exit)
 * while going through cross-spawn so that Windows .cmd/.bat/.ps1 shims — which
 * is how every npm-installed CLI binary ships on Windows — resolve through
 * PATHEXT. Going straight to execFileSync calls CreateProcess directly and
 * skips PATHEXT entirely, so `claude`, `codex`, `openclaw` all ENOENT on
 * Windows even when installed. cross-spawn does the lookup in JS before
 * spawning, keeping the argv-array injection-safety property.
 */
export function runSync(
  command: string,
  args: string[],
  options: Parameters<typeof spawn.sync>[2] = {},
): void {
  const result = spawn.sync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with status ${result.status ?? 'null'}`,
    );
  }
}

/** Runs a command interactively (stdio passes through to the user's terminal). Returns the exit code. */
export function runInteractive(command: string, args: string[]): number | null {
  const result = spawn.sync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status;
}
