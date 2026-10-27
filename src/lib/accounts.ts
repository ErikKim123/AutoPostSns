// 연결된 SNS 계정 저장소. 토큰(credentials)은 화면용 조회에 절대 싣지 않는다.
// ⚠️ 서버 전용.
import { iso, q, q1 } from './db';
import type { AccountRef, Credentials, DiscoveredAccount } from './networks/adapter';
import type { Network } from './networks/rules';

export interface AccountView {
  id: string;
  network: Network;
  handle: string;
  status: 'active' | 'needs_reauth' | 'disabled';
  lastError: string | null;
  tokenExpiresAt: string | null;
  /** 이 계정으로 아직 발행되지 않은 예약 수(삭제 확인 문구용). */
  openTargets: number;
  createdAt: string;
}

interface AccountRow {
  id: string;
  network: Network;
  handle: string;
  external_id: string;
  credentials: Credentials;
  token_expires_at: Date | null;
  status: AccountView['status'];
  last_error: string | null;
  created_at: Date;
  open_targets?: string;
}

export async function listAccounts(): Promise<AccountView[]> {
  const rows = await q<AccountRow>(
    `select a.id, a.network, a.handle, a.token_expires_at, a.status, a.last_error, a.created_at,
            (select count(*) from autopost.post_targets t
               join autopost.posts p on p.id = t.post_id
              where t.account_id = a.id and p.deleted_at is null and t.status in ('pending', 'failed', 'publishing')) as open_targets
       from autopost.accounts a
      order by a.network, a.handle`,
  );
  return rows.map((r) => ({
    id: r.id,
    network: r.network,
    handle: r.handle,
    status: r.status,
    lastError: r.last_error,
    tokenExpiresAt: iso(r.token_expires_at),
    openTargets: Number(r.open_targets ?? 0),
    createdAt: iso(r.created_at)!,
  }));
}

/** 발행용 — 토큰 포함. 엔진만 쓴다. */
export async function getAccountRef(id: string): Promise<(AccountRef & { status: AccountView['status'] }) | null> {
  const r = await q1<AccountRow>(
    `select id, network, handle, external_id, credentials, token_expires_at, status from autopost.accounts where id = $1`,
    [id],
  );
  if (!r) return null;
  return {
    id: r.id,
    network: r.network,
    handle: r.handle,
    externalId: r.external_id,
    credentials: r.credentials,
    tokenExpiresAt: iso(r.token_expires_at),
    status: r.status,
  };
}

/** 같은 SNS 계정을 다시 연결하면 토큰만 새로 바꾸고 needs_reauth 를 푼다. */
export async function upsertAccount(network: Network, d: DiscoveredAccount, userId: string): Promise<string> {
  const r = await q1<{ id: string }>(
    `insert into autopost.accounts (network, handle, external_id, credentials, token_expires_at, created_by)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (network, external_id) do update
       set handle = excluded.handle, credentials = excluded.credentials, token_expires_at = excluded.token_expires_at,
           status = 'active', last_error = null, updated_at = now()
     returning id`,
    [network, d.handle.replace(/^@/, ''), d.externalId, JSON.stringify(d.credentials), d.tokenExpiresAt, userId],
  );
  return r!.id;
}

export async function saveRefreshedCredentials(id: string, credentials: Credentials, tokenExpiresAt: string | null): Promise<void> {
  await q(
    `update autopost.accounts set credentials = $2, token_expires_at = $3, status = 'active', last_error = null, updated_at = now() where id = $1`,
    [id, JSON.stringify(credentials), tokenExpiresAt],
  );
}

export async function markNeedsReauth(id: string, error: string): Promise<void> {
  await q(`update autopost.accounts set status = 'needs_reauth', last_error = $2, updated_at = now() where id = $1`, [id, error]);
}

/** 계정 삭제 — 이 계정의 발행 대상(post_targets)도 함께 지워진다(on delete cascade). */
export async function deleteAccount(id: string): Promise<void> {
  await q(`delete from autopost.accounts where id = $1`, [id]);
}
