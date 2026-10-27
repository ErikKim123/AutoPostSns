-- 0001: AutoPostSns 예약 게시 — autopost 스키마 전체.
-- 울프·123Band 와 같은 Supabase 프로젝트를 쓰지만, 이름은 전부 autopost 로 갈라 둔다(나중에 프로젝트를 옮기기 쉽게).
-- 앱은 PostgREST(Data API)를 거치지 않고 서버에서 DATABASE_URL 로 직접 접속한다.
--   → authenticator 의 pgrst.db_schemas 목록을 건드릴 필요가 없다(다른 서비스 API 를 멈출 위험이 없음).
-- 브라우저에는 이 스키마 권한을 주지 않는다. 모든 읽기·쓰기는 서버 라우트가 회원 확인 후 수행한다.
-- ⚠️ Supabase SQL Editor 에서 한 번에 실행. 다시 실행해도 안전(if not exists).

create schema if not exists autopost;
revoke all on schema autopost from anon, authenticated;

-- ── 회원 ── 로그인 계정(auth.users)은 다른 서비스와 공유. 이 표에 있는 사람만 AutoPostSns 를 쓸 수 있다.
create table if not exists autopost.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor',
  created_at timestamptz not null default now(),
  constraint members_role_chk check (role in ('owner', 'editor'))
);

-- ── 연결된 SNS 계정 ──
create table if not exists autopost.accounts (
  id uuid primary key default gen_random_uuid(),
  network text not null,
  handle text not null,                         -- 화면 표시용(@없이)
  external_id text not null,                    -- IG 유저 ID / 페이지 ID / Threads 유저 ID / X 유저 ID / TikTok open_id
  credentials jsonb not null default '{}'::jsonb, -- {accessToken, refreshToken?} — 서버 전용, 화면으로 내보내지 않는다
  token_expires_at timestamptz,
  status text not null default 'active',        -- needs_reauth: 토큰 만료·권한 오류로 재연결 필요
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_network_chk check (network in ('instagram', 'facebook', 'threads', 'x', 'tiktok')),
  constraint accounts_status_chk check (status in ('active', 'needs_reauth', 'disabled')),
  constraint accounts_unique unique (network, external_id)
);

-- ── 게시물 ── 본문·미디어·예약 시각은 게시물에, 계정별 발행 결과는 post_targets 에.
create table if not exists autopost.posts (
  id uuid primary key default gen_random_uuid(),
  text text not null default '',
  media jsonb not null default '[]'::jsonb,     -- [{url, kind: 'image'|'video'}] 순서 = 게시 순서
  publish_at timestamptz,                       -- 초안은 비어 있어도 된다. 분 단위로 저장.
  timezone text not null default 'Asia/Seoul',  -- 작성자가 본 시간대(표시용). publish_at 자체는 UTC.
  -- draft: 초안(cron 이 건드리지 않음) / scheduled: 예약 / publishing: 발행 중
  -- published: 전 계정 성공 / partial: 일부만 성공 / failed: 전 계정 실패(재시도 소진)
  status text not null default 'draft',
  deleted_at timestamptz,                       -- 휴지통. null 이 아니면 캘린더·cron 에서 제외
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_status_chk check (status in ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed')),
  constraint posts_media_array_chk check (jsonb_typeof(media) = 'array'),
  constraint posts_scheduled_has_time_chk check (status = 'draft' or publish_at is not null)
);

create index if not exists posts_calendar_idx on autopost.posts (publish_at) where deleted_at is null;
create index if not exists posts_trash_idx on autopost.posts (deleted_at) where deleted_at is not null;

-- ── 계정별 발행 단위 ── cron 은 게시물이 아니라 이 행을 하나씩 잠그고 발행한다.
create table if not exists autopost.post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references autopost.posts(id) on delete cascade,
  account_id uuid not null references autopost.accounts(id) on delete cascade,
  options jsonb not null default '{}'::jsonb,   -- 네트워크별 옵션(예: 인스타 {type:'feed'|'reel'})
  -- pending: 대기 / publishing: cron 이 집어감(중복 발행 방지 잠금) / published / failed
  status text not null default 'pending',
  attempts int not null default 0,
  error text,
  remote_id text,                               -- SNS 쪽 게시물 ID
  permalink text,
  published_at timestamptz,
  locked_at timestamptz,                        -- publishing 으로 바뀐 시각 — 오래 걸려 있으면 cron 이 풀어준다
  updated_at timestamptz not null default now(),
  constraint post_targets_status_chk check (status in ('pending', 'publishing', 'published', 'failed')),
  constraint post_targets_unique unique (post_id, account_id)
);

create index if not exists post_targets_post_idx on autopost.post_targets (post_id);
create index if not exists post_targets_open_idx on autopost.post_targets (status) where status in ('pending', 'failed', 'publishing');

-- RLS 를 켜고 정책은 두지 않는다 → anon/authenticated 는 아무것도 못 한다. 서버(소유자 접속)만 접근.
alter table autopost.members enable row level security;
alter table autopost.accounts enable row level security;
alter table autopost.posts enable row level security;
alter table autopost.post_targets enable row level security;

-- ── 미디어 버킷 ── SNS 가 URL 로 직접 가져가야 하므로 공개 읽기.
-- 업로드는 서버가 발급한 서명 URL(createSignedUploadUrl)로만 하므로 쓰기 정책을 두지 않는다.
insert into storage.buckets (id, name, public, allowed_mime_types)
values (
  'autopost-media', 'autopost-media', true,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update set public = true, allowed_mime_types = excluded.allowed_mime_types;

-- 첫 회원 등록(이메일만 바꿔서 한 번 실행):
--   insert into autopost.members (user_id, role)
--   select id, 'owner' from auth.users where email = 'you@example.com'
--   on conflict (user_id) do nothing;
