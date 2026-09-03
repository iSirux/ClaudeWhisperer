#!/usr/bin/env node
// Build the `ow` CLI (cli/) and stage it as a Tauri external binary at
// src-tauri/binaries/ow-<target-triple>[.exe], which `bundle.externalBin` ships
// next to the app executable (and tauri-build copies next to the dev build).
// Runs from `beforeDevCommand` / `beforeBuildCommand`, where Tauri exposes the
// build target as TAURI_ENV_TARGET_TRIPLE (set for cross builds in CI).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'cli', 'Cargo.toml');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
  if (result.error) {
    console.error(`Failed to run ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result;
}

function hostTriple() {
  const out = run('rustc', ['-vV']).stdout;
  const match = /^host:\s*(\S+)/m.exec(out);
  if (!match) {
    console.error('Could not determine the host target triple from `rustc -vV`');
    process.exit(1);
  }
  return match[1];
}

const explicitTarget = process.env.TAURI_ENV_TARGET_TRIPLE || process.argv[2];
const host = hostTriple();
const triple = explicitTarget || host;
const isWindows = triple.includes('windows');
const exe = isWindows ? 'ow.exe' : 'ow';

const cargoArgs = ['build', '--release', '--manifest-path', manifest];
// Only pass --target for a real cross build: with --target, cargo nests the
// output under target/<triple>/release even for the host.
if (triple !== host) cargoArgs.push('--target', triple);
run('cargo', cargoArgs, { stdio: 'inherit' });

const built = join(root, 'cli', 'target', ...(triple !== host ? [triple] : []), 'release', exe);
if (!existsSync(built)) {
  console.error(`Build did not produce ${built}`);
  process.exit(1);
}

const stagedDir = join(root, 'src-tauri', 'binaries');
mkdirSync(stagedDir, { recursive: true });
const staged = join(stagedDir, `ow-${triple}${isWindows ? '.exe' : ''}`);
copyFileSync(built, staged);
console.log(`Staged CLI: ${staged}`);
