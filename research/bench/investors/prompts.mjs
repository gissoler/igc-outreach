import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../prompts/investor');
const hash = value => createHash('sha256').update(value).digest('hex');

export function loadInvestorPrompt(id, version = 'v1', { promptRoot = root, manifest: manifestFile = 'manifest.json' } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(promptRoot, manifestFile), 'utf8'));
  const entry = manifest.prompts.find(x => x.id === id && x.version === version);
  if (!entry) throw new Error(`Unknown investor prompt ${id}@${version}`);
  const files = [...entry.files].sort();
  const contents = new Map(files.map(file => [file, readFileSync(resolve(promptRoot, file), 'utf8')]));
  const actual = hash(files.map(file => `${file}\n${contents.get(file)}\n`).join(''));
  if (actual !== entry.sha256) throw new Error(`Investor prompt integrity failed for ${id}@${version}`);
  const base = { id, version, sha256: actual };
  if (id === 'b0_templates') return { ...base, templates: JSON.parse(contents.get(files[0])).templates };
  return { ...base, system: contents.get(`${id}/${version}/system.md`), user: contents.get(`${id}/${version}/user.md`) };
}
