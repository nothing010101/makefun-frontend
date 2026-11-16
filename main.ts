// Leanboard's entry program (Node 22, standard library only).
//
// It hands the frontend in: copies this directory's app/ and screenshots/
// into the output directory and writes output/dossier.json, the summary the
// judge reads (the screenshots, the first load's files and bytes, and the
// source), using the kit's vendored library. vendor/makefun-frontend.ts
// must stay exactly as the kit shipped it: the scorer rebuilds the dossier
// with its own copy and requires a byte-for-byte match.
//
// Run locally to check the output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader MAKEFUN_OUTPUT_DIR is unset and /output is used.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function mustExistDir(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error('missing ' + label + ': ' + path);
}

function mustHoldShots(dir) {
  const shots = readdirSync(dir).filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isFile());
  if (shots.length !== 3) throw new Error('screenshots/ must hold exactly 3 images, found ' + shots.length);
  return shots;
}

mustExistDir(join(root, 'app'), 'app/');
mustExistDir(join(root, 'screenshots'), 'screenshots/');
const shots = mustHoldShots(join(root, 'screenshots'));

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'app'), join(outDir, 'app'), { recursive: true });
cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

// The scorer's caps from the kit's reference/gate.json: the dossier text is
// capped at 160 KiB, at most 3 screenshots of 256 KiB each, app/ at most 993
// files and directories and 16 MiB in all.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 3, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 16777216,
  }),
);

console.log('wrote ' + outDir + '/dossier.json from app/ (' + shots.join(', ') + ')');
