import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CLOUDFLARE_SAFE_FILE_BYTES = 20 * 1024 * 1024;
const INDEX_NAME = 'world-chunks.json';

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(fullPath));
    else files.push(fullPath);
  }
  return files;
}

export async function splitCloudflareWorld(worldDirectory, chunkSize = CLOUDFLARE_SAFE_FILE_BYTES) {
  const chunks = {};
  const files = await filesIn(worldDirectory);
  for (const filePath of files) {
    const relativeName = path.relative(worldDirectory, filePath).replaceAll(path.sep, '/');
    if (relativeName === INDEX_NAME) continue;
    const fileSize = (await stat(filePath)).size;
    if (fileSize <= chunkSize) continue;

    const bytes = await readFile(filePath);
    const chunkNames = [];
    for (let offset = 0, index = 0; offset < bytes.length; offset += chunkSize, index += 1) {
      const chunkName = `${relativeName}.chunk-${String(index).padStart(4, '0')}`;
      await writeFile(path.join(worldDirectory, chunkName), bytes.subarray(offset, offset + chunkSize));
      chunkNames.push(chunkName);
    }
    chunks[relativeName] = { size: bytes.length, files: chunkNames };
    await rm(filePath);
  }
  await writeFile(path.join(worldDirectory, INDEX_NAME), `${JSON.stringify({ version: 1, chunks }, null, 2)}\n`);
  return chunks;
}