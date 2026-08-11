import { Pool, PoolClient } from 'pg';

/**
 * Supabase connectivity notes
 * ---------------------------
 * Direct host `db.<ref>.supabase.co` is IPv6-only → often ENOTFOUND on IPv4 networks.
 * Always use the Supavisor pooler URI:
 *
 *   Transaction (6543) — preferred for Next.js route handlers / Vercel serverless
 *   Session (5432)     — fine for a long-lived Node process with a sticky Pool
 *
 * Username format on the pooler is `postgres.<project-ref>`.
 */

let pool: Pool | null = null;
let poolUrl: string | null = null;

function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL environment variable is not set. ' +
      'Copy .env.example to .env.local and fill in your Supabase pooler credentials.'
    );
  }

  // Recreate if env was hot-reloaded with a new connection string
  if (pool && poolUrl !== url) {
    void pool.end().catch(() => undefined);
    pool = null;
    poolUrl = null;
  }

  if (!pool) {
    if (url.includes('db.') && url.includes('.supabase.co') && !url.includes('pooler.supabase.com')) {
      console.warn(
        '[db] DATABASE_URL looks like a direct Supabase host (IPv6-only). ' +
        'Prefer the pooler URI (*.pooler.supabase.com) to avoid ENOTFOUND.'
      );
    }

    // On Vercel each invocation may get its own isolate — keep the pool tiny.
    // Locally `next dev` is long-lived, so a modest pool is fine.
    const max = isServerless() ? 1 : 5;

    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: isServerless(),
      statement_timeout: 20_000,
      query_timeout: 20_000,
      idle_in_transaction_session_timeout: 20_000,
    });
    poolUrl = url;
    pool.on('error', (err) => {
      console.error('[db] unexpected pool error', err.message);
    });
  }
  return pool;
}

export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T extends object = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
