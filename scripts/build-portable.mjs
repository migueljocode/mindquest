import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORTABLE_DIR = path.join(ROOT, 'portable');
const PUBLIC_DIR = path.join(PORTABLE_DIR, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');

async function buildPortable() {
  console.log('1/3 Building Vite production bundle into portable/public ...');
  await viteBuild({
    root: ROOT,
    base: './',
    build: {
      outDir: PUBLIC_DIR,
      emptyOutDir: true,
    },
    logLevel: 'info',
  });
  fs.rmSync(path.join(ASSETS_DIR, 'aistudio'), { recursive: true, force: true });

  console.log('2/3 Bundling shared multiplayer engine into portable/engine.mjs ...');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'scripts', 'portable-engine-entry.ts')],
    outfile: path.join(PORTABLE_DIR, 'engine.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
  });

  console.log('3/3 Building classic IIFE offline-solo.html sharing portable/public/assets ...');
  const builtAssetFiles = fs.readdirSync(ASSETS_DIR);
  const cssFile = builtAssetFiles.find((f) => f.endsWith('.css'));
  const cssContent = cssFile ? fs.readFileSync(path.join(ASSETS_DIR, cssFile), 'utf8') : '';

  const assetMapPlugin = {
    name: 'map-vite-jpg-assets',
    setup(build) {
      build.onResolve({ filter: /\.(jpg|jpeg|png|webp|svg)$/i }, (args) => {
        const parsed = path.parse(args.path);
        const match = builtAssetFiles.find(
          (f) => f.startsWith(`${parsed.name}-`) && f.endsWith(parsed.ext)
        ) || builtAssetFiles.find((f) => f === parsed.base);

        if (!match) {
          throw new Error(`Could not locate built asset for ${args.path} in ${ASSETS_DIR}`);
        }
        return {
          path: `./assets/${match}`,
          namespace: 'mapped-asset',
        };
      });

      build.onLoad({ filter: /.*/, namespace: 'mapped-asset' }, (args) => ({
        contents: `export default ${JSON.stringify(args.path)};`,
        loader: 'js',
      }));
    },
  };

  const iifeResult = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.tsx')],
    bundle: true,
    write: false,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [assetMapPlugin],
  });

  const jsCode = iifeResult.outputFiles[0].text;
  const safeJsCode = jsCode.replace(/<\/script>/gi, '<\\/script>');
  const safeCssCode = cssContent.replace(/<\/style>/gi, '<\\/style>');

  const offlineHtml = `<!doctype html>
<html lang="fa" dir="rtl" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MindQuest - نسخه آفلاین تک‌نفره</title>
    <style>${safeCssCode}</style>
  </head>
  <body class="bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
    <div id="root"></div>
    <script>${safeJsCode}</script>
  </body>
</html>
`;

  fs.writeFileSync(path.join(PUBLIC_DIR, 'offline-solo.html'), offlineHtml, 'utf8');
  console.log('Portable build complete!');
}

buildPortable().catch((err) => {
  console.error('Portable build failed:', err);
  process.exit(1);
});
