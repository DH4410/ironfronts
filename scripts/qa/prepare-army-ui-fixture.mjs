/**
 * Build an isolated save for army-counter and HUD visual QA.
 *
 * Usage:
 *   node scripts/qa/prepare-army-ui-fixture.mjs <source-save> <output-save> [account-id]
 *
 * The source save is never modified. The fixture gives the fixed qa-combat
 * account Finland and expands army-1 to exercise every counter/roster slot.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , sourceArg, outputArg, accountArg = 'cdaadc66-5682-4c98-8126-5e868b255c08'] = process.argv;

if (!sourceArg || !outputArg) {
  throw new Error('Expected <source-save> <output-save> [account-id].');
}

const sourcePath = path.resolve(sourceArg);
const outputPath = path.resolve(outputArg);

if (sourcePath === outputPath) {
  throw new Error('Refusing to overwrite the source save. Choose a separate fixture path.');
}

const envelope = JSON.parse(await readFile(sourcePath, 'utf8'));
const runtime = envelope?.runtime;
const state = runtime?.state;
const finland = state?.countries?.['1'];
const army = state?.armies?.['army-1'];

if (!runtime || !state || !finland || !army || !Array.isArray(runtime.seats)) {
  throw new Error('Source save does not contain the expected runtime, Finland, or army-1.');
}

runtime.seats = runtime.seats.filter(
  ([accountId, countryId]) => accountId !== accountArg && countryId !== 1,
);
runtime.seats.push([accountArg, 1]);
finland.controller = 'player';
army.units = [
  { typeId: 'infantry', count: 4, hp: 400, experience: 0 },
  { typeId: 'medium-tank', count: 3, hp: 570, experience: 0 },
  { typeId: 'engineer', count: 2, hp: 160, experience: 0 },
  { typeId: 'light-tank', count: 2, hp: 260, experience: 0 },
  { typeId: 'armored-car', count: 1, hp: 90, experience: 0 },
  { typeId: 'artillery', count: 1, hp: 70, experience: 0 },
];

await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
console.log(`Army UI QA fixture written to ${outputPath}`);
