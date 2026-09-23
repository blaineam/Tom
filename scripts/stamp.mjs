// Stamp every relative module/asset reference in a built site with ?v=<version>
// so a deploy's files are always loaded together (no stale mix from caches).
//   node scripts/stamp.mjs _site <version>
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !version) { console.error('usage: stamp.mjs <dir> <version>'); process.exit(2); }
const v = encodeURIComponent(version);
const JS_REF = /(\bfrom\s*|\bimport\s*\(\s*|new URL\(\s*)(['"])(\.{1,2}\/[^'"?#]+\.m?js)\2/g;
const HTML_REF = /(\s(?:src|href)=")((?!https?:|\/\/|#|data:)[^"?#]+\.(?:js|mjs|css))"/g;

let files = 0, refs = 0;
async function walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { await walk(p); continue; }
    const ext = extname(p);
    if (!['.js', '.mjs', '.html'].includes(ext)) continue;
    const src = await readFile(p, 'utf8');
    const out = ext === '.html'
      ? src.replace(HTML_REF, (_, a, path) => { refs++; return `${a}${path}?v=${v}"`; })
      : src.replace(JS_REF, (_, a, q, path) => { refs++; return `${a}${q}${path}?v=${v}${q}`; });
    if (out !== src) { await writeFile(p, out); files++; }
  }
}
await walk(dir);
console.log(`stamped ${refs} references in ${files} files with v=${version}`);
