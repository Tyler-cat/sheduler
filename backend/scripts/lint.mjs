import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function walk(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function checkFile(file) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--check', file], (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  const files = await walk(new URL('../src', import.meta.url).pathname);
  await Promise.all(files.map(checkFile));
  console.log(`Syntax OK for ${files.length} file(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
