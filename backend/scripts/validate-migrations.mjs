#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../prisma/migrations');

function sanitizeSql(sql) {
  return sql.replace(/CREATE\s+EXTENSION[^;]+;/gi, '');
}

async function applySql(db, sql, label, tracker) {
  const trimmed = sanitizeSql(sql).trim();
  if (!trimmed) {
    return;
  }
  try {
    await db.exec(trimmed);
    if (tracker) {
      const createTableRegex = /CREATE\s+TABLE\s+"?([A-Za-z0-9_]+)"?/gi;
      let match;
      while ((match = createTableRegex.exec(trimmed))) {
        tracker.tables.add(match[1]);
      }
      const dropTableRegex = /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi;
      while ((match = dropTableRegex.exec(trimmed))) {
        tracker.tables.delete(match[2]);
      }
    }
  } catch (error) {
    const message = error?.message || '';
    if (/already exists/i.test(message) && /CREATE\s+INDEX/i.test(trimmed)) {
      return;
    }
    error.message = `${label} failed: ${message}`;
    throw error;
  }
}

async function validateMigrations() {
  const folders = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (folders.length === 0) {
    return { applied: 0, rolledBack: 0, tables: [] };
  }
  const db = new PGlite();
  const tracker = { tables: new Set() };
  const applied = [];
  for (const folder of folders) {
    const migrationPath = path.join(migrationsDir, folder, 'migration.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await applySql(db, sql, `${folder}/migration.sql`, tracker);
    applied.push(folder);
  }
  const tablesAfterUp = Array.from(tracker.tables).sort();
  for (const folder of [...folders].reverse()) {
    const downPath = path.join(migrationsDir, folder, 'down.sql');
    const sql = await readFile(downPath, 'utf8');
    await applySql(db, sql, `${folder}/down.sql`, tracker);
  }
  const tablesAfterDown = Array.from(tracker.tables);
  return {
    applied: applied.length,
    rolledBack: folders.length,
    tables: tablesAfterUp,
    cleaned: tablesAfterDown.length === 0
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  validateMigrations()
    .then((result) => {
      console.log(`Validated ${result.applied} migration(s); tables after up: ${result.tables.join(', ')}`);
      if (!result.cleaned) {
        console.warn('Warning: rollback did not clean all tables.');
      }
      process.exit(result.cleaned ? 0 : 1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { validateMigrations };
