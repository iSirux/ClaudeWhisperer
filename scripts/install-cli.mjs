#!/usr/bin/env node
// Build the `ow` CLI (cli/) and install it: binary → user bin dir, user PATH,
// agent skills. See docs/cli-scheduling-spec.md.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'cli', 'Cargo.toml');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  if (result.error) {
    console.error(`Failed to run ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('cargo', ['build', '--release', '--manifest-path', manifest]);

const exe = join(root, 'cli', 'target', 'release', process.platform === 'win32' ? 'ow.exe' : 'ow');
if (!existsSync(exe)) {
  console.error(`Build did not produce ${exe}`);
  process.exit(1);
}

run(exe, ['self-install']);
