// Builds single-file versions of the editor and the player into dist/.
// They open straight from disk (double-click), no web server needed.
//
//   npm install && npm run build

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(root, 'vendor', 'three');
const dist = path.join(root, 'dist');
mkdirSync(dist, { recursive: true });

// Resolve the bare specifiers the import map provides at runtime.
const threePlugin = {
  name: 'three-vendor',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(vendor, 'three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, args => ({ path: path.join(vendor, 'addons', args.path.slice('three/addons/'.length)) }));
  },
};

const common = { bundle: true, format: 'esm', minify: true, write: false, plugins: [threePlugin], target: 'es2020', legalComments: 'none' };

async function bundleFile(entry) {
  const r = await build({ ...common, entryPoints: [entry] });
  return safeInline(r.outputFiles[0].text);
}
async function bundleSource(contents, resolveDir) {
  const r = await build({ ...common, stdin: { contents, resolveDir, loader: 'js', sourcefile: 'inline.js' } });
  return safeInline(r.outputFiles[0].text);
}
// A "</script" inside the bundle would end the inline script tag early.
const safeInline = js => js.replace(/<\/script/gi, '<\\/script');

const stripImportMap = html => html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');

// ----- editor -----
{
  let html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  let js = await bundleFile(path.join(root, 'js', 'main.js'));
  js = js.replace(/(["'])example\/player\.html\?embedded=1\1/g, '$1player.html?embedded=1$1'); // player sits next to it in dist/
  // Function replacers: a string replacement would interpret the "$" sequences in minified code.
  html = stripImportMap(html)
    .replace('<link rel="stylesheet" href="css/style.css" />', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="js/main.js"></script>', () => `<script type="module">\n${js}\n</script>`);
  if (html.includes('href="css/style.css"') || html.includes('src="js/main.js"')) throw new Error('index.html did not inline cleanly');
  writeFileSync(path.join(dist, 'blocky.html'), html);
  console.log('dist/blocky.html', (html.length / 1024).toFixed(0), 'KB');
}

// ----- player -----
{
  let html = readFileSync(path.join(root, 'example', 'player.html'), 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('player.html: module script not found');
  const js = await bundleSource(m[1], path.join(root, 'example'));
  html = stripImportMap(html).replace(m[0], () => `<script type="module">\n${js}\n</script>`);
  writeFileSync(path.join(dist, 'player.html'), html);
  copyFileSync(path.join(root, 'example', 'guard.glb'), path.join(dist, 'guard.glb'));
  console.log('dist/player.html', (html.length / 1024).toFixed(0), 'KB');
}
