import { Command } from 'commander';
import chalk from 'chalk';
import { adapters } from '../adapters/registry.js';
import { loadToken } from '../auth/oauth.js';
import { API_BASE_URL } from '../config.js';

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Check connection health')
    .action(async () => {
      console.log(chalk.bold('Custena Connect — diagnostics\n'));

      for (const adapter of adapters) {
        const presence = await adapter.detect();
        console.log(`${adapter.displayName}: ${presence.installed ? chalk.green('detected') : chalk.gray('not found')}`);
        if (presence.configPath) console.log(`  Config: ${presence.configPath}`);
      }

      const token = await loadToken();
      if (token) {
        const expired = Date.now() > token.expiresAt;
        console.log(`\nOAuth token: ${expired ? chalk.yellow('expired') : chalk.green('valid')}`);
      } else {
        console.log('\nOAuth token: ' + chalk.red('not found') + ' (run `custena-connect install`)');
      }

      // Check backend reachability
      try {
        const res = await fetch(`${API_BASE_URL}/actuator/health`);
        console.log(`Backend: ${res.ok ? chalk.green('reachable') : chalk.red(`${res.status}`)}`);
      } catch {
        console.log(`Backend: ${chalk.red('unreachable')}`);
      }
    });
}
