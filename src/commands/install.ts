import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { adapters } from '../adapters/registry.js';
import { runOAuthFlow } from '../auth/oauth.js';

export function installCommand(): Command {
  return new Command('install')
    .description('Connect a coding agent host to your Custena buyer account')
    .action(async () => {
      console.log(chalk.bold('\nCustena Connect installer\n'));

      // Detect installed hosts
      const spinner = ora('Detecting installed hosts...').start();
      const detected = [];
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

      // v0.1: single host, skip selection
      const { adapter, presence } = detected[0];
      console.log(`Detected: ${chalk.green(adapter.displayName)} at ${presence.configPath}`);

      // OAuth flow
      console.log('\nOpening browser for Custena login...');
      const oauth = await runOAuthFlow();
      console.log(chalk.green('✓ Authenticated'));

      // Write config
      const s2 = ora('Writing MCP config...').start();
      await adapter.writeMcpConfig(oauth);
      s2.succeed('MCP config written');

      if (!adapter.capabilities.mcpPrompts) {
        const s3 = ora('Writing skill file...').start();
        await adapter.writeSkill();
        s3.succeed('Skill file written');
      }

      if (adapter.capabilities.hooks) {
        const s4 = ora('Writing hooks...').start();
        await adapter.writeHooks();
        s4.succeed('Hooks configured');
      }

      console.log(chalk.bold('\n✓ Custena Connect is ready!'));
      console.log(`${adapter.displayName} will now pay HTTP 402 responses from your Custena account.`);
    });
}
