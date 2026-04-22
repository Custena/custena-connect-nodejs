import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { adapters } from '../adapters/registry.js';

export function uninstallCommand(): Command {
  return new Command('uninstall')
    .description('Remove Custena Connect from a coding agent host')
    .action(async () => {
      for (const adapter of adapters) {
        const presence = await adapter.detect();
        if (presence.installed) {
          const spinner = ora(`Removing from ${adapter.displayName}...`).start();
          await adapter.removeAll();
          spinner.succeed(`Removed from ${adapter.displayName}`);
        }
      }
      console.log(chalk.green('✓ Custena Connect uninstalled'));
    });
}
