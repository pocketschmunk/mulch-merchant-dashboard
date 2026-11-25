import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Review the target before running migrations.');
if (process.env.APPLY_FEE_SCHEMA !== 'yes') throw new Error('Set APPLY_FEE_SCHEMA=yes after reviewing the target database.');
const pool = new Pool({connectionString:process.env.DATABASE_URL});
try {
  await pool.query(await readFile(new URL('../migrations/001_fee_ledger.sql',import.meta.url),'utf8'));
  console.log('Mulch fee schema version 1 installed. No payment or provider changes.');
} finally { await pool.end(); }
