import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { checkbox } from '@inquirer/prompts';
import { adapters } from '../adapters/registry.js';
import { runOAuthFlow } from '../auth/oauth.js';
import type { HostAdapter, HostPresence } from '../types.js';

interface Detected { adapter: HostAdapter; presence: HostPresence }

/** Returns which hosts to configure. Prompts with a checkbox when >1 detected. */
export async function selectHosts(detected: Detected[]): Promise<Detected[]> {
  if (detected.length <= 1) return detected;

  const selected = await checkbox<HostAdapter>({
    message: 'Multiple coding agent hosts found — select which to configure:',
    choices: detected.map(({ adapter }) => ({
      value: adapter,
      name: adapter.displayName,
      checked: true,
    })),
  });

  return detected.filter(({ adapter }) => selected.includes(adapter));
}

export function installCommand(): Command {
  return new Command('install')
    .description('Connect coding agent host(s) to your Custena buyer account')
    .action(async () => {
      console.log(chalk.bold('\nCustena Connect installer\n'));

      const spinner = ora('Detecting installed hosts...').start();
      const detected: Detected[] = [];
      for (const adapter of adapters) {
        const presence = await adapter.detect();
        if (presence.installed) detected.push({ adapter, presence });
      }
      spinner.stop();

      if (detected.length === 0) {
        console.log(chalk.yellow('No supported coding agent hosts found on this system.'));
        console.log('\nManual setup:');
        console.log(chalk.cyan('  claude mcp add --transport http --scope user custena https://api.custena.com/mcp'));
        return;
      }

      const targets = await selectHosts(detected);

      if (targets.length === 0) {
        console.log(chalk.yellow('No hosts selected — nothing installed.'));
        return;
      }

      console.log('\nOpening browser for Custena login...');
      const oauth = await runOAuthFlow();
      console.log(chalk.green('✓ Authenticated'));

      for (const { adapter } of targets) {
        const label = adapter.displayName;

        const s1 = ora(`Writing MCP config for ${label}...`).start();
        await adapter.writeMcpConfig(oauth);
        s1.succeed(`MCP config written (${label})`);

        if (!adapter.capabilities.mcpPrompts) {
          const s2 = ora(`Writing skill file for ${label}...`).start();
          await adapter.writeSkill();
          s2.succeed(`Skill file written (${label})`);
        }

        if (adapter.capabilities.hooks) {
          const s3 = ora(`Writing hooks for ${label}...`).start();
          await adapter.writeHooks();
          s3.succeed(`Hooks configured (${label})`);
        }
      }

      const names = targets.map(t => t.adapter.displayName).join(', ');
      console.log(chalk.bold(`\n✓ Custena Connect is ready on: ${names}`));
      console.log('These agents will now pay HTTP 402 responses from your Custena account.');
    });
}
