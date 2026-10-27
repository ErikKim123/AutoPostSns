// 서버 전용 Postgres 연결 — autopost 스키마는 Data API 에 노출하지 않고 여기로만 읽고 쓴다.
// SQL 은 항상 autopost.테이블 로 스키마를 적는다(같은 DB 의 울프 public 테이블로 새지 않게).
// 라우트에서 반드시 회원 확인(lib/auth.ts)을 먼저 할 것.
import pg from 'pg';

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL 이 설정되지 않았습니다 (apps/autopost/.env.local).');
    // 서버리스 인스턴스마다 풀이 생기므로 작게 둔다. Supabase 풀러(6543)를 쓰는 것을 권장.
    pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 });
  }
  return pool;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await getPool().query(sql, params);
  return r.rows as T[];
}

export async function q1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(sql, params))[0] ?? null;
}

/** 트랜잭션. 예외가 나면 롤백한다. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** timestamptz(Date) → ISO 문자열. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}
