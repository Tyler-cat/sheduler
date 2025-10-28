import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMigrations } from '../scripts/validate-migrations.mjs';

describe('migration validation', () => {
  it('applies and rolls back migrations without errors', async () => {
    const result = await validateMigrations();
    assert.equal(result.applied, result.rolledBack);
    assert.ok(result.tables.includes('User'));
    assert.equal(result.cleaned, true);
  });
});
