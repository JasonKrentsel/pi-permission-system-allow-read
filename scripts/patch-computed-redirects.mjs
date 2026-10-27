import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const modes = args.filter(arg => arg.startsWith('--'));
if (modes.some(mode => !['--check', '--apply', '--revert'].includes(mode)) || modes.length > 1) {
  throw new Error('Usage: node scripts/patch-computed-redirects.mjs [package-directory] [--check|--apply|--revert]');
}
const mode = modes[0] || '--check';
const directory = path.resolve(args.find(arg => !arg.startsWith('--')) || process.env.PI_PERMISSION_PACKAGE || path.join(os.homedir(), '.pi/agent/npm/node_modules/@gotgenes/pi-permission-system'));
const spec = JSON.parse(fs.readFileSync(new URL('../patches/computed-redirects.json', import.meta.url), 'utf8'));
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
if (metadata.name !== spec.package || metadata.version !== spec.version) {
  throw new Error(`This patch requires ${spec.package}@${spec.version}; found ${metadata.name}@${metadata.version}.`);
}
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const changes = [];
for (const file of spec.files) {
  const target = path.resolve(directory, file.relative);
  if (!target.startsWith(directory + path.sep)) throw new Error('Patch target escaped the package');
  const original = fs.readFileSync(target, 'utf8');
  const digest = hash(original);
  if (![file.before, file.after].includes(digest)) throw new Error(`Unexpected source in ${file.relative}; nothing was written.`);
  const want = mode === '--revert' ? file.before : file.after;
  if (digest === want) continue;
  let updated = original;
  const replacements = mode === '--revert' ? [...file.replacements].reverse().map(({from,to}) => ({from:to,to:from})) : file.replacements;
  for (const {from,to} of replacements) {
    if (updated.split(from).length !== 2) throw new Error(`Patch match is not unique in ${file.relative}`);
    updated = updated.replace(from, () => to);
  }
  if (hash(updated) !== want) throw new Error(`Result hash mismatch for ${file.relative}`);
  changes.push({ target, updated });
}
// Validate every file before changing any file. --check is read-only.
if (mode !== '--check') for (const {target,updated} of changes) fs.writeFileSync(target, updated);
console.log(mode === '--check'
  ? (changes.length ? `Patch not applied: ${changes.length} files need changes.` : 'Computed-redirect patch is applied and verified.')
  : `${mode === '--revert' ? 'Reverted' : 'Applied'} ${changes.length} files.`);
