import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { QUIZ_QUESTIONS } from '../shared/questions.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function syncDotnet() {
  const dataDir = path.join(ROOT, 'Data');
  fs.mkdirSync(dataDir, { recursive: true });
  const questionsPath = path.join(dataDir, 'questions.json');
  fs.writeFileSync(questionsPath, JSON.stringify(QUIZ_QUESTIONS, null, 2), 'utf8');
  console.log(`Synced ${QUIZ_QUESTIONS.length} questions -> Data/questions.json`);

  const wwwrootDir = path.join(ROOT, 'wwwroot');
  await viteBuild({
    root: ROOT,
    base: './',
    build: {
      outDir: wwwrootDir,
      emptyOutDir: true,
    },
    logLevel: 'info',
  });
  fs.rmSync(path.join(wwwrootDir, 'assets', 'aistudio'), { recursive: true, force: true });
  console.log('Built Vite production assets -> wwwroot/');
}

syncDotnet().catch((err) => {
  console.error('Failed to sync .NET assets:', err);
  process.exit(1);
});
