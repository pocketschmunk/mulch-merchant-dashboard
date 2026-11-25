import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
if (!process.env.DATABASE_URL || process.env.APPLY_MULCH_SCHEMA !== 'yes') {
  throw new Error('Review the target DATABASE_URL and set APPLY_MULCH_SCHEMA=yes. Use a new Mulch app database, not the live seller checkout.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  for (const file of ['../server/migrations/000_auth.sql', '../server/migrations/001_entitlements.sql',
    '../fee-service/migrations/001_fee_ledger.sql', '../server/migrations/002_app.sql']) {
    await pool.query(await readFile(new URL(file, import.meta.url), 'utf8'));
    console.log(`Installed ${file.split('/').at(-1)}; no provider calls or charges.`);
  }
} finally { await pool.end(); }
