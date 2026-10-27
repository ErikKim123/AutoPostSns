// 발행 엔진 — 계정별 발행 대상(post_targets)을 하나씩 잠그고 어댑터로 올린다.
// cron(/api/cron/publish)과 "지금 게시"가 같은 함수를 쓴다. 브라우저를 꺼도 예약 시각에 게시된다.
// ⚠️ 서버 전용.
import { q, q1 } from './db';
import { getAccountRef, markNeedsReauth, saveRefreshedCredentials } from './accounts';
import { ADAPTERS } from './networks';
import type { MediaItem } from './networks/rules';
import { aggregateStatus, MAX_ATTEMPTS, type TargetState } from './status';

// 발행 중(publishing)으로 이만큼 넘게 멈춰 있으면 함수가 죽은 것으로 보고 실패 처리한다.
const STALE_LOCK_MINUTES = 15;

export interface TargetOutcome {
  targetId: string;
  ok: boolean;
  error?: string;
}

/** 게시물 상태를 대상들의 결과로 다시 계산. 초안은 건드리지 않는다. */
export async function refreshPostStatus(postId: string): Promise<void> {
  const targets = await q<TargetState>(`select status, attempts from autopost.post_targets where post_id = $1`, [postId]);
  await q(`update autopost.posts set status = $2, updated_at = now() where id = $1 and status <> 'draft'`, [postId, aggregateStatus(targets)]);
}

/**
 * 대상 1건 발행.
 * 잠금: 조건부 update 의 반환행으로 소유권을 판정한다 → cron 이 겹쳐 돌아도 같은 대상을 두 번 올리지 않는다.
 */
export async function publishTarget(targetId: string): Promise<TargetOutcome> {
  const claimed = await q1<{ id: string; post_id: string; account_id: string; options: Record<string, unknown>; attempts: number }>(
    `update autopost.post_targets t
        set status = 'publishing', locked_at = now(), updated_at = now()
       from autopost.posts p
      where t.id = $1 and p.id = t.post_id
        and t.status in ('pending', 'failed') and t.attempts < $2
        and p.deleted_at is null and p.status <> 'draft'
      returning t.id, t.post_id, t.account_id, t.options, t.attempts`,
    [targetId, MAX_ATTEMPTS],
  );
  if (!claimed) return { targetId, ok: false, error: '이미 처리 중이거나 발행 대상이 아닙니다.' };
  await q(`update autopost.posts set status = 'publishing', updated_at = now() where id = $1`, [claimed.post_id]);

  let ok = false;
  let error: string | null = null;
  let retryable = true;
  let remoteId: string | null = null;
  let permalink: string | null = null;

  try {
    const post = await q1<{ text: string; media: MediaItem[] }>(`select text, media from autopost.posts where id = $1`, [claimed.post_id]);
    const account = await getAccountRef(claimed.account_id);
    if (!post || !account) {
      error = '게시물이나 계정을 찾을 수 없습니다.';
      retryable = false;
    } else if (account.status !== 'active') {
      error = '계정 연결이 끊겼습니다. 계정 화면에서 다시 연결한 뒤 수정해서 다시 예약하세요.';
      retryable = false;
    } else {
      const result = await ADAPTERS[account.network].publish(account, { text: post.text, media: post.media, options: claimed.options });
      if (result.refreshed) await saveRefreshedCredentials(account.id, result.refreshed.credentials, result.refreshed.tokenExpiresAt);
      if (result.ok) {
        ok = true;
        remoteId = result.remoteId;
        permalink = result.permalink ?? null;
      } else {
        error = result.error;
        retryable = result.retryable;
        if (result.needsReauth) await markNeedsReauth(account.id, result.error);
      }
    }
  } catch (err) {
    // 어떤 예외로 빠져나가도 publishing 으로 남지 않게 반드시 마감한다.
    error = err instanceof Error ? err.message : '발행 중 오류가 발생했습니다.';
  }

  await q(
    `update autopost.post_targets
        set status = $2, attempts = $3, error = $4, remote_id = coalesce($5, remote_id), permalink = coalesce($6, permalink),
            published_at = case when $2 = 'published' then now() else published_at end,
            locked_at = null, updated_at = now()
      where id = $1`,
    [
      claimed.id,
      ok ? 'published' : 'failed',
      // 다시 해도 안 될 오류는 시도 횟수를 꽉 채워 재시도 대상에서 뺀다.
      ok || retryable ? claimed.attempts + 1 : MAX_ATTEMPTS,
      ok ? null : error,
      remoteId,
      permalink,
    ],
  );
  await refreshPostStatus(claimed.post_id);
  return ok ? { targetId, ok } : { targetId, ok, error: error ?? undefined };
}

/** "지금 게시" — 게시물의 남은 대상을 바로 순서대로 발행. */
export async function publishPostNow(postId: string): Promise<TargetOutcome[]> {
  const rows = await q<{ id: string }>(
    `select id from autopost.post_targets where post_id = $1 and status in ('pending', 'failed') and attempts < $2 order by id`,
    [postId, MAX_ATTEMPTS],
  );
  const out: TargetOutcome[] = [];
  for (const r of rows) out.push(await publishTarget(r.id));
  return out;
}

/** cron 진입점 — 멈춘 잠금을 풀고, 예약 시각이 지난 대상을 시간 예산 안에서 순서대로 발행. */
export async function publishDue(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ released: number; results: TargetOutcome[] }> {
  const { limit = 20, budgetMs = 240_000 } = opts;
  const started = Date.now();

  const stale = await q<{ post_id: string }>(
    `update autopost.post_targets
        set status = 'failed', attempts = attempts + 1, locked_at = null, updated_at = now(),
            error = '발행이 ${STALE_LOCK_MINUTES}분 넘게 끝나지 않아 중단했습니다. 다음 실행에서 다시 시도합니다.'
      where status = 'publishing' and locked_at < now() - interval '${STALE_LOCK_MINUTES} minutes'
      returning post_id`,
  );
  for (const postId of new Set(stale.map((s) => s.post_id))) await refreshPostStatus(postId);

  const due = await q<{ id: string }>(
    `select t.id
       from autopost.post_targets t
       join autopost.posts p on p.id = t.post_id
      where p.deleted_at is null and p.status <> 'draft' and p.publish_at <= now()
        and t.status in ('pending', 'failed') and t.attempts < $1
      order by p.publish_at, t.id
      limit $2`,
    [MAX_ATTEMPTS, limit],
  );

  const results: TargetOutcome[] = [];
  for (const row of due) {
    // 남은 대상은 다음 cron 이 가져간다(함수 제한 시간 초과로 잠금이 남는 것을 피한다).
    if (Date.now() - started > budgetMs) break;
    results.push(await publishTarget(row.id));
  }
  return { released: stale.length, results };
}
