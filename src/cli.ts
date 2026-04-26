#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { doctorCommand } from './commands/doctor.js';
import { hookCommand } from './commands/hook.js';

// Read version from package.json so `custena-connect --version` can never
// drift from the npm-registry-reported version. Works under both tsx (dev)
// and the compiled dist/ layout — package.json is always one level up.
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

const program = new Command();
program
  .name('custena-connect')
  .description('Connect your AI coding agent to Custena')
  .version(version);

program.addCommand(installCommand());
program.addCommand(uninstallCommand());
program.addCommand(doctorCommand());
program.addCommand(hookCommand());

program.parse();
