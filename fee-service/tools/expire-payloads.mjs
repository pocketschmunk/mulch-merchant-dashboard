import { Pool } from 'pg';
import { Repository } from '../src/repository.js';
if (!process.env.DATABASE_URL || process.env.APPLY_PAYLOAD_RETENTION !== 'yes') throw new Error('Review DATABASE_URL and set APPLY_PAYLOAD_RETENTION=yes. This command never releases payment slots or calls Whop.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
try {
  const ids=(await pool.query("SELECT id FROM mulch_fee_attempts WHERE payment_id IS NULL AND payload_ciphertext IS NOT NULL AND first_submit_at < now()-interval '5 minutes' AND status IN ('unknown','submitting') LIMIT 1000")).rows;
  const repository=new Repository(pool);
  for(const {id} of ids) await repository.expirePayload(id);
  console.log(`Inspected ${ids.length} expired retry bodies; unresolved ledger and store slots retained.`);
} finally { await pool.end(); }
