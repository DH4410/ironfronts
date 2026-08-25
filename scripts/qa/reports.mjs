import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export function writeJsonReport(outputDirectory, filename, report) {
  return writeFile(path.join(outputDirectory, filename), `${JSON.stringify(report, null, 2)}\n`);
}

export function writeTextReport(outputDirectory, filename, contents) {
  return writeFile(path.join(outputDirectory, filename), contents);
}
