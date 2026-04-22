#!/usr/bin/env node
import { Command } from 'commander';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { doctorCommand } from './commands/doctor.js';
import { hookCommand } from './commands/hook.js';

const program = new Command();
program
  .name('custena-connect')
  .description('Connect your AI coding agent to Custena')
  .version('0.1.0');

program.addCommand(installCommand());
program.addCommand(uninstallCommand());
program.addCommand(doctorCommand());
program.addCommand(hookCommand());

program.parse();
