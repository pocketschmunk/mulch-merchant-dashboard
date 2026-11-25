import { Pool } from 'pg';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { createEntitlements } from './entitlements.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Use a separate Mulch application database and install its schemas explicitly.');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000, statement_timeout: 30000 });
pool.on('error', () => console.error('Database connection unavailable; no credentials or query data are logged.'));
const auth = createAuth({ pool, env: process.env });
const entitlements = createEntitlements({ pool, env: process.env });
const server = createApp({ pool, env: process.env, auth, entitlements });
server.listen(port, '0.0.0.0', () => console.log(`Mulch application listener ready on port ${port}. Email configured: ${auth.configured}; paid verification configured: ${entitlements.configured}. No payment activation is implied.`));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 10000).unref();
  server.closeIdleConnections();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
  clearTimeout(deadline);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
