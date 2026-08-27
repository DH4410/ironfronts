import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const LEGACY_ONLY = new Set(['First_Sighting.mp3', 'Elusive_Predator.mp3']);

const archiveArgument = process.argv[2] ?? process.env.IRONFRONTS_MUSIC_ARCHIVE;
const importAll = process.argv.includes('--all');

if (!archiveArgument) {
  console.error('Usage: npm run import:music -- <path-to-0-AD-Music_updated_May2015.zip> [--all]');
  console.error('Without --all, only First_Sighting.mp3 and Elusive_Predator.mp3 are imported.');
  process.exitCode = 1;
} else {
  const archivePath = resolve(archiveArgument);
  const outputDirectory = resolve('public/audio/music');
  const archive = readFileSync(archivePath);
  const entries = readZipEntries(archive);
  const musicEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith('.mp3'));
  const selected = importAll
    ? musicEntries
    : musicEntries.filter((entry) => LEGACY_ONLY.has(basename(entry.name)));

  if (importAll && musicEntries.length !== 31) {
    throw new Error(`Expected 31 MP3 tracks in the May 2015 archive, found ${musicEntries.length}`);
  }
  if (!importAll && selected.length !== LEGACY_ONLY.size) {
    throw new Error('The archive does not contain both legacy combat tracks expected by Ironfronts.');
  }

  mkdirSync(outputDirectory, { recursive: true });
  for (const entry of selected) {
    const filename = basename(entry.name);
    const data = extractEntry(archive, entry);
    const target = resolve(outputDirectory, filename);
    writeFileSync(target, data);
    console.log(`Imported ${filename} (${(data.byteLength / 1_048_576).toFixed(2)} MiB)`);
  }

  console.log(importAll
    ? `Imported all ${selected.length} soundtrack tracks into public/audio/music/.`
    : 'Imported the two legacy combat tracks missing from the archived 0ad/0ad GitHub mirror.');
}

function findEndOfCentralDirectory(archive) {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error('Invalid ZIP: end-of-central-directory record not found.');
}

function readZipEntries(archive) {
  const eocd = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error(`Invalid ZIP: central directory entry ${index} is corrupt.`);
    }

    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function extractEntry(archive, entry) {
  const offset = entry.localHeaderOffset;
  if (archive.readUInt32LE(offset) !== LOCAL_FILE_HEADER) {
    throw new Error(`Invalid ZIP: local header is corrupt for ${entry.name}.`);
  }

  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = archive.subarray(dataOffset, dataOffset + entry.compressedSize);

  let data;
  if (entry.method === 0) data = Buffer.from(compressed);
  else if (entry.method === 8) data = inflateRawSync(compressed);
  else throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);

  if (data.byteLength !== entry.uncompressedSize) {
    throw new Error(`ZIP size mismatch for ${entry.name}: expected ${entry.uncompressedSize}, got ${data.byteLength}.`);
  }
  return data;
}
