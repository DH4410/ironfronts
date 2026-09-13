import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const helper = resolve(root, 'scripts/blender_export_tank.py');

const sources = [
  ['Tank_Pack_Light.fbx', 'public/models/tank-light.glb'],
  ['Tank_Pack_Medium.fbx', 'public/models/tank-medium.glb'],
];

function findBlender() {
  if (process.env.BLENDER_BIN && existsSync(process.env.BLENDER_BIN)) return process.env.BLENDER_BIN;
  const candidates = process.platform === 'win32'
    ? ['C:/Program Files/Blender Foundation'].flatMap((base) => (existsSync(base)
      ? readdirSync(base).map((entry) => `${base}/${entry}/blender.exe`)
      : []))
    : ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/usr/local/bin/blender'];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      'Blender was not found. Install it, or set BLENDER_BIN to the executable path.\n'
      + `Checked: ${candidates.join(', ') || '(none)'}`,
    );
  }
  return found;
}

const blender = findBlender();
for (const [source, output] of sources) {
  const inputPath = resolve(root, source);
  if (!existsSync(inputPath)) throw new Error(`Missing tank source asset: ${source}`);
  const outputPath = resolve(root, output);
  console.log(`Converting ${source} -> ${output} ...`);
  const stdout = execFileSync(blender, ['--background', '--python', helper, '--', inputPath, outputPath], {
    encoding: 'utf8',
  });
  if (!stdout.includes('BUILD_TANK_MODEL_OK')) {
    throw new Error(`Blender did not report success for ${source}:\n${stdout}`);
  }
  console.log(`Built ${output}`);
}
