// 캘린더 — 주/월 보기. 카드를 누르면 작성 창(수정·결과 보기), 날짜의 + 를 누르면 그날 새 게시물.
'use client';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NetworkBadge, StatusPill } from './Badges';
import { Composer } from './Composer';
import { Toast } from './Toast';
import { useAccounts, usePosts, type PostView } from '@/lib/client/api';
import { fmtTime, rangeLabel, sameDay, shiftAnchor, visibleRange, weekdayLabel, type CalendarView as View } from '@/lib/client/dates';

function excerpt(text: string, n: number) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t || '(본문 없음)';
}

function PostCard({ post, onOpen, compact }: { post: PostView; onOpen: () => void; compact?: boolean }) {
  const thumb = post.media[0];
  if (compact) {
    return (
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-1.5 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-sunken">
        <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', post.status === 'failed' || post.status === 'partial' ? 'bg-danger' : post.status === 'published' ? 'bg-ok' : post.status === 'draft' ? 'bg-muted' : 'bg-accent')} />
        <span className="font-medium">{post.publishAt ? fmtTime(post.publishAt) : ''}</span>
        <span className="truncate text-muted">{excerpt(post.text, 30)}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        'flex w-full flex-col gap-1.5 rounded-lg border bg-surface p-2 text-left shadow-sm transition hover:border-accent',
        post.status === 'draft' ? 'border-dashed border-line' : 'border-line',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold">{post.publishAt ? fmtTime(post.publishAt) : '시각 없음'}</span>
        <StatusPill status={post.status} />
      </div>
      <div className="flex gap-2">
        {thumb &&
          (thumb.kind === 'video' ? (
            <video src={thumb.url} className="h-10 w-10 shrink-0 rounded object-cover" muted preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb.url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
          ))}
        <p className="line-clamp-2 text-xs leading-snug text-muted">{excerpt(post.text, 80)}</p>
      </div>
      {post.targets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {post.targets.map((t) => (
            <NetworkBadge key={t.id} network={t.network} status={t.status === 'pending' ? undefined : t.status} />
          ))}
        </div>
      )}
    </button>
  );
}

export function CalendarView() {
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [editing, setEditing] = useState<{ post: PostView | null; day: Date | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { from, to, days } = useMemo(() => visibleRange(view, anchor), [view, anchor]);
  const posts = usePosts(from, to);
  const accounts = useAccounts();
  const today = new Date();

  const byDay = useMemo(() => {
    const map = new Map<string, PostView[]>();
    for (const p of posts.data?.posts ?? []) {
      const d = new Date(p.publishAt!);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return map;
  }, [posts.data]);
  const postsOn = (d: Date) => byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [];
  const undated = posts.data?.undated ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAnchor(new Date())} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-sunken">
          오늘
        </button>
        <div className="flex">
          <button type="button" onClick={() => setAnchor((a) => shiftAnchor(view, a, -1))} className="rounded-l-lg border border-line p-1.5 hover:bg-sunken" aria-label="이전">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => setAnchor((a) => shiftAnchor(view, a, 1))} className="rounded-r-lg border border-l-0 border-line p-1.5 hover:bg-sunken" aria-label="다음">
            <ChevronRight size={18} />
          </button>
        </div>
        <h1 className="text-lg font-semibold">{rangeLabel(view, anchor)}</h1>
        {posts.isFetching && <span className="text-xs text-muted">불러오는 중…</span>}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5 text-sm" role="tablist" aria-label="보기">
            {(['week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={clsx('rounded-md px-3 py-1', view === v ? 'bg-accent-soft font-medium text-accent' : 'text-muted')}
              >
                {v === 'week' ? '주' : '월'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setEditing({ post: null, day: new Date() })}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
          >
            <Plus size={16} /> 새 게시물
          </button>
        </div>
      </div>

      {posts.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{posts.error.message}</p>}

      {undated.length > 0 && (
        <section className="rounded-lg border border-dashed border-line bg-surface p-3">
          <h2 className="mb-2 text-xs font-medium tracking-wide text-muted">날짜 없는 초안 {undated.length}개</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {undated.map((p) => (
              <PostCard key={p.id} post={p} onOpen={() => setEditing({ post: p, day: null })} />
            ))}
          </div>
        </section>
      )}

      {view === 'week' ? (
        <div className="grid gap-2 sm:grid-cols-7">
          {days.map((d) => {
            const list = postsOn(d);
            const isToday = sameDay(d, today);
            const isPast = d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            return (
              <section key={d.toISOString()} className={clsx('flex min-h-40 min-w-0 flex-col gap-2 rounded-lg p-2', isToday ? 'bg-accent-soft' : 'bg-sunken')}>
                <header className="flex items-baseline gap-1.5">
                  <span className={clsx('text-xs', isToday ? 'text-accent' : 'text-muted')}>{weekdayLabel(d)}</span>
                  <span className={clsx('text-lg font-semibold', isToday && 'text-accent')}>{d.getDate()}</span>
                  {!isPast && (
                    <button
                      type="button"
                      onClick={() => setEditing({ post: null, day: d })}
                      className="ml-auto rounded p-0.5 text-muted hover:bg-surface hover:text-accent"
                      aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일에 새 게시물`}
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </header>
                {list.map((p) => (
                  <PostCard key={p.id} post={p} onOpen={() => setEditing({ post: p, day: null })} />
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
            {['월', '화', '수', '목', '금', '토', '일'].map((w) => (
              <div key={w} className="bg-surface px-2 py-1 text-center text-xs text-muted">
                {w}
              </div>
            ))}
            {days.map((d) => {
              const list = postsOn(d);
              const inMonth = d.getMonth() === anchor.getMonth();
              return (
                <div key={d.toISOString()} className={clsx('flex min-h-24 flex-col gap-0.5 p-1', inMonth ? 'bg-surface' : 'bg-sunken')}>
                  <button
                    type="button"
                    onClick={() => setEditing({ post: null, day: d })}
                    className={clsx(
                      'self-start rounded px-1 text-xs hover:bg-accent-soft',
                      sameDay(d, today) ? 'bg-accent font-semibold text-accent-fg' : inMonth ? 'text-fg' : 'text-muted',
                    )}
                  >
                    {d.getDate()}
                  </button>
                  {list.slice(0, 3).map((p) => (
                    <PostCard key={p.id} post={p} compact onOpen={() => setEditing({ post: p, day: null })} />
                  ))}
                  {list.length > 3 && (
                    <button type="button" onClick={() => { setView('week'); setAnchor(d); }} className="px-1 text-left text-[11px] text-accent">
                      +{list.length - 3}개 더
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && (
        <Composer
          key={editing.post?.id ?? 'new'}
          post={editing.post}
          day={editing.day}
          accounts={accounts.data?.accounts ?? []}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null);
            setToast(msg);
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
