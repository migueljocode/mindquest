import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeAotRuntimeId = process.platform === 'win32'
  ? 'win-x64'
  : process.platform === 'linux'
    ? 'linux-x64'
    : null;

if (!nativeAotRuntimeId) {
  throw new Error(`Native AOT publish is not configured for platform '${process.platform}'.`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, ['scripts/sync-dotnet.mjs']);

for (const runtimeId of ['linux-x64', 'win-x64']) {
  const isNativeAot = runtimeId === nativeAotRuntimeId;
  const args = [
    'publish',
    'MindQuest.csproj',
    '-c', 'Release',
    '-r', runtimeId,
    '-o', path.join('publish', runtimeId),
    `-p:PublishAot=${isNativeAot}`,
  ];
  if (isNativeAot) {
    args.push('-p:IlcOptimizationPreference=Size');
  }
  run('dotnet', args);
}
