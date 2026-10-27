// 게시물 저장소 — 캘린더 조회, 저장(초안·예약·지금 게시), 휴지통.
// 예약 1건 = posts 1행 + 고른 계정 수만큼 post_targets. 발행은 engine.ts 가 한다.
// ⚠️ 서버 전용.
import type pg from 'pg';
import { iso, q, q1, tx } from './db';
import { isNetwork, truncateToMinute, validateAll, type MediaItem, type Network } from './networks/rules';
import { editBlockReason, type PostStatus, type TargetState, type TargetStatus } from './status';

export interface TargetView {
  id: string;
  accountId: string;
  network: Network;
  handle: string;
  status: TargetStatus;
  attempts: number;
  error: string | null;
  permalink: string | null;
  publishedAt: string | null;
}

export interface PostView {
  id: string;
  text: string;
  media: MediaItem[];
  publishAt: string | null;
  timezone: string;
  status: PostStatus;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  targets: TargetView[];
}

export type SaveMode = 'draft' | 'schedule' | 'publish_now';

export interface SaveInput {
  text: string;
  media: MediaItem[];
  publishAt: string | null;
  timezone: string;
  accountIds: string[];
  mode: SaveMode;
}

/** 저장 거부 — 라우트가 400 으로 돌려준다. byNetwork 는 작성 창의 네트워크별 오류 표시와 같은 모양. */
export class SaveRejected extends Error {
  constructor(
    message: string,
    public byNetwork: Partial<Record<Network, string[]>> = {},
  ) {
    super(message);
  }
}

const SELECT_POSTS = `
  select p.id, p.text, p.media, p.publish_at, p.timezone, p.status, p.deleted_at, p.created_at, p.updated_at,
         coalesce(json_agg(json_build_object(
           'id', t.id, 'accountId', t.account_id, 'network', a.network, 'handle', a.handle,
           'status', t.status, 'attempts', t.attempts, 'error', t.error,
           'permalink', t.permalink, 'publishedAt', t.published_at
         ) order by a.network, a.handle) filter (where t.id is not null), '[]') as targets
    from autopost.posts p
    left join autopost.post_targets t on t.post_id = p.id
    left join autopost.accounts a on a.id = t.account_id`;

interface PostRow {
  id: string;
  text: string;
  media: MediaItem[];
  publish_at: Date | null;
  timezone: string;
  status: PostStatus;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  targets: TargetView[];
}

function toView(r: PostRow): PostView {
  return {
    id: r.id,
    text: r.text,
    media: r.media,
    publishAt: iso(r.publish_at),
    timezone: r.timezone,
    status: r.status,
    deletedAt: iso(r.deleted_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    targets: r.targets,
  };
}

/** 캘린더 — 기간 안의 게시물(휴지통 제외). */
export async function listRange(fromISO: string, toISO: string): Promise<PostView[]> {
  const rows = await q<PostRow>(
    `${SELECT_POSTS} where p.deleted_at is null and p.publish_at >= $1 and p.publish_at < $2 group by p.id order by p.publish_at, p.created_at`,
    [fromISO, toISO],
  );
  return rows.map(toView);
}

/** 날짜를 정하지 않은 초안. */
export async function listUndatedDrafts(): Promise<PostView[]> {
  const rows = await q<PostRow>(`${SELECT_POSTS} where p.deleted_at is null and p.publish_at is null group by p.id order by p.updated_at desc`);
  return rows.map(toView);
}

export async function listTrash(): Promise<PostView[]> {
  const rows = await q<PostRow>(`${SELECT_POSTS} where p.deleted_at is not null group by p.id order by p.deleted_at desc`);
  return rows.map(toView);
}

export async function getPost(id: string): Promise<PostView | null> {
  const r = await q1<PostRow>(`${SELECT_POSTS} where p.id = $1 group by p.id`, [id]);
  return r ? toView(r) : null;
}

/** 요청 본문 → SaveInput. 형식이 틀리면 SaveRejected. */
export function parseSaveInput(body: unknown): SaveInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const mode = b.mode;
  if (mode !== 'draft' && mode !== 'schedule' && mode !== 'publish_now') throw new SaveRejected('저장 방식(mode)이 올바르지 않습니다.');
  const media = Array.isArray(b.media) ? b.media : [];
  const cleanMedia: MediaItem[] = media.map((m) => {
    const it = m as Record<string, unknown>;
    if (typeof it.url !== 'string' || !/^https:\/\//.test(it.url) || (it.kind !== 'image' && it.kind !== 'video')) {
      throw new SaveRejected('미디어 형식이 올바르지 않습니다.');
    }
    return { url: it.url, kind: it.kind };
  });
  const accountIds = Array.isArray(b.accountIds) ? [...new Set(b.accountIds.filter((x): x is string => typeof x === 'string'))] : [];
  return {
    text: typeof b.text === 'string' ? b.text : '',
    media: cleanMedia,
    publishAt: typeof b.publishAt === 'string' && b.publishAt ? truncateToMinute(b.publishAt) : null,
    timezone: typeof b.timezone === 'string' && b.timezone ? b.timezone.slice(0, 64) : 'Asia/Seoul',
    accountIds,
    mode,
  };
}

/** 예약·지금 게시 전 검사. 초안은 형식만 맞으면 저장한다(나중에 다듬을 수 있게). */
async function checkPublishable(c: pg.PoolClient, input: SaveInput): Promise<void> {
  if (input.mode === 'draft') return;
  if (input.accountIds.length === 0) throw new SaveRejected('게시할 계정을 하나 이상 고르세요.');
  if (input.mode === 'schedule') {
    if (!input.publishAt) throw new SaveRejected('예약 시각을 정하세요.');
    if (new Date(input.publishAt).getTime() < Date.now() - 60_000) throw new SaveRejected('예약 시각이 이미 지났습니다. 지금 게시하거나 시각을 바꾸세요.');
  }
  const { rows } = await c.query<{ id: string; network: string; status: string; handle: string }>(
    `select id, network, status, handle from autopost.accounts where id = any($1::uuid[])`,
    [input.accountIds],
  );
  if (rows.length !== input.accountIds.length) throw new SaveRejected('고른 계정 중 없어진 계정이 있습니다. 새로고침 후 다시 고르세요.');
  const broken = rows.filter((r) => r.status !== 'active');
  if (broken.length) throw new SaveRejected(`다시 연결이 필요한 계정이 있습니다: ${broken.map((r) => r.handle).join(', ')}`);
  const networks = rows.map((r) => r.network).filter(isNetwork);
  const byNetwork = validateAll(networks, { text: input.text, media: input.media });
  if (Object.keys(byNetwork).length) throw new SaveRejected('네트워크 규칙에 맞지 않는 내용이 있습니다.', byNetwork);
}

function statusFor(input: SaveInput): PostStatus {
  return input.mode === 'draft' ? 'draft' : 'scheduled';
}

function publishAtFor(input: SaveInput): string | null {
  return input.mode === 'publish_now' ? truncateToMinute(new Date().toISOString()) : input.publishAt;
}

async function syncTargets(c: pg.PoolClient, postId: string, accountIds: string[]): Promise<void> {
  // 빠진 계정은 지우고, 새 계정은 넣고, 남은 계정은 다시 대기 상태로(내용이 바뀌었으므로 시도 횟수도 초기화).
  await c.query(`delete from autopost.post_targets where post_id = $1 and not (account_id = any($2::uuid[]))`, [postId, accountIds]);
  await c.query(
    `insert into autopost.post_targets (post_id, account_id)
     select $1, unnest($2::uuid[])
     on conflict (post_id, account_id) do update
       set status = 'pending', attempts = 0, error = null, locked_at = null, updated_at = now()`,
    [postId, accountIds],
  );
}

export async function createPost(input: SaveInput, userId: string): Promise<string> {
  return tx(async (c) => {
    await checkPublishable(c, input);
    const { rows } = await c.query<{ id: string }>(
      `insert into autopost.posts (text, media, publish_at, timezone, status, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
      [input.text, JSON.stringify(input.media), publishAtFor(input), input.timezone, statusFor(input), userId],
    );
    const id = rows[0]!.id;
    if (input.accountIds.length) await syncTargets(c, id, input.accountIds);
    return id;
  });
}

export async function updatePost(id: string, input: SaveInput): Promise<void> {
  await tx(async (c) => {
    // 행 잠금 — cron 이 같은 게시물을 집어가는 것과 경합하지 않게.
    const { rows } = await c.query<{ status: PostStatus; deleted_at: Date | null }>(
      `select status, deleted_at from autopost.posts where id = $1 for update`,
      [id],
    );
    const post = rows[0];
    if (!post) throw new SaveRejected('게시물을 찾을 수 없습니다.');
    if (post.deleted_at) throw new SaveRejected('휴지통에 있는 게시물입니다. 먼저 복원하세요.');
    const targets = (await c.query<TargetState>(`select status, attempts from autopost.post_targets where post_id = $1`, [id])).rows;
    const blocked = editBlockReason(post.status, targets);
    if (blocked) throw new SaveRejected(blocked);

    await checkPublishable(c, input);
    await c.query(
      `update autopost.posts set text = $2, media = $3, publish_at = $4, timezone = $5, status = $6, updated_at = now() where id = $1`,
      [id, input.text, JSON.stringify(input.media), publishAtFor(input), input.timezone, statusFor(input)],
    );
    await syncTargets(c, id, input.accountIds);
  });
}

/** 휴지통으로. SNS 에 이미 올라간 글은 지워지지 않는다(화면에서 안내). */
export async function trashPost(id: string): Promise<void> {
  const r = await q1<{ blocked: boolean }>(
    `update autopost.posts p set deleted_at = now(), updated_at = now()
      where p.id = $1 and p.deleted_at is null
        and not exists (select 1 from autopost.post_targets t where t.post_id = p.id and t.status = 'publishing')
      returning false as blocked`,
    [id],
  );
  if (!r) throw new SaveRejected('게시 중이거나 이미 휴지통에 있는 게시물입니다.');
}

/**
 * 복원. 예약 시각이 이미 지난 예약은 초안으로 돌린다 — 그대로 두면 복원하자마자 cron 이 게시해 버린다.
 * @returns 초안으로 바뀌었으면 true
 */
export async function restorePost(id: string): Promise<{ movedToDraft: boolean }> {
  const r = await q1<{ moved: boolean }>(
    `with old as (
       select id, status as old_status from autopost.posts where id = $1 and deleted_at is not null for update
     )
     update autopost.posts p
        set deleted_at = null, updated_at = now(),
            status = case when p.status = 'scheduled' and p.publish_at < now() then 'draft' else p.status end
       from old
      where p.id = old.id
      returning (old.old_status = 'scheduled' and p.status = 'draft') as moved`,
    [id],
  );
  if (!r) throw new SaveRejected('휴지통에서 찾을 수 없습니다.');
  return { movedToDraft: r.moved };
}

/** 영구 삭제 — 휴지통에 있는 것만. */
export async function purgePost(id: string): Promise<void> {
  const r = await q1(`delete from autopost.posts where id = $1 and deleted_at is not null returning id`, [id]);
  if (!r) throw new SaveRejected('휴지통에 있는 게시물만 영구 삭제할 수 있습니다.');
}

/** 복제 — 같은 내용·계정으로 날짜 없는 초안을 만든다(이미 게시된 글을 다시 쓰고 싶을 때). */
export async function duplicatePost(id: string, userId: string): Promise<string> {
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into autopost.posts (text, media, timezone, status, created_by)
       select text, media, timezone, 'draft', $2 from autopost.posts where id = $1
       returning id`,
      [id, userId],
    );
    const copy = rows[0];
    if (!copy) throw new SaveRejected('게시물을 찾을 수 없습니다.');
    await c.query(
      `insert into autopost.post_targets (post_id, account_id) select $2, account_id from autopost.post_targets where post_id = $1`,
      [id, copy.id],
    );
    return copy.id;
  });
}
