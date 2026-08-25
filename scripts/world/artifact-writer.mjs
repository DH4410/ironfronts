import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export function writeTypedArtifact(outputRoot, relativePath, typedArray) {
  const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  return writeFile(path.join(outputRoot, relativePath), bytes);
}
