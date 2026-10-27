// 작성 창 — 새 게시물·수정·게시된 글 보기를 한 화면에서.
// 고른 계정의 네트워크 규칙으로 바로 검사하고(rules.ts), 오류가 있으면 예약·지금 게시를 막는다. 서버도 같은 검사를 한다.
'use client';
import clsx from 'clsx';
import { ImagePlus, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { NetworkBadge, StatusPill, TARGET_LABEL } from './Badges';
import { ApiError, uploadFiles, usePostAction, useSavePost, type AccountView, type PostView, type SaveInput } from '@/lib/client/api';
import { browserTimezone, defaultPublishAt, fmtDateTime, fromLocalInput, toLocalInput } from '@/lib/client/dates';
import { lengthFor, RULES, validateAll, type MediaItem, type Network } from '@/lib/networks/rules';

interface Props {
  post: PostView | null;
  /** 새 게시물일 때 캘린더에서 누른 날짜. */
  day: Date | null;
  accounts: AccountView[];
  onClose: () => void;
  onDone: (message: string) => void;
}

export function Composer({ post, day, accounts, onClose, onDone }: Props) {
  const save = useSavePost();
  const action = usePostAction();
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState(post?.text ?? '');
  const [media, setMedia] = useState<MediaItem[]>(post?.media ?? []);
  const [when, setWhen] = useState(() => toLocalInput(post?.publishAt ?? defaultPublishAt(day ?? new Date()).toISOString()));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(post?.targets.map((t) => t.accountId) ?? []));
  const [uploading, setUploading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverByNetwork, setServerByNetwork] = useState<Partial<Record<Network, string[]>>>({});

  const locked = !!post && (post.status === 'publishing' || post.targets.some((t) => t.status === 'published' || t.status === 'publishing'));
  const busy = save.isPending || action.isPending || uploading;

  const pickedAccounts = accounts.filter((a) => picked.has(a.id));
  const networks = [...new Set(pickedAccounts.map((a) => a.network))];
  const errors = useMemo(() => validateAll(networks, { text, media }), [networks.join(), text, media]); // eslint-disable-line react-hooks/exhaustive-deps
  const errorCount = Object.values(errors).reduce((n, e) => n + (e?.length ?? 0), 0);

  const publishAt = fromLocalInput(when);
  const past = publishAt ? new Date(publishAt).getTime() < Date.now() - 60_000 : false;
  const scheduleBlock =
    pickedAccounts.length === 0 ? '게시할 계정을 고르세요.' : !publishAt ? '예약 시각을 정하세요.' : past ? '예약 시각이 지났습니다.' : errorCount ? '오류를 먼저 고치세요.' : null;
  const nowBlock = pickedAccounts.length === 0 ? '게시할 계정을 고르세요.' : errorCount ? '오류를 먼저 고치세요.' : null;

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setServerError(null);
    try {
      const added = await uploadFiles([...list]);
      setMedia((m) => [...m, ...added]);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submit(mode: SaveInput['mode']) {
    if (mode === 'publish_now' && !window.confirm(`지금 ${pickedAccounts.map((a) => `${RULES[a.network].label} @${a.handle}`).join(', ')}에 게시합니다. 계속할까요?`)) return;
    setServerError(null);
    setServerByNetwork({});
    try {
      const { post: saved } = await save.mutateAsync({
        id: post?.id,
        input: { text, media, publishAt, timezone: browserTimezone(), accountIds: [...picked], mode },
      });
      const failed = saved.targets.filter((t) => t.status === 'failed');
      onDone(
        mode === 'draft'
          ? '초안을 저장했습니다.'
          : mode === 'schedule'
            ? `${fmtDateTime(saved.publishAt!)}에 예약했습니다.`
            : failed.length
              ? `게시했지만 ${failed.length}개 계정에서 실패했습니다. 카드를 열어 사유를 확인하세요.`
              : '게시했습니다.',
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        setServerByNetwork(err.byNetwork);
      } else setServerError(err instanceof Error ? err.message : '저장 실패');
    }
  }

  async function run(kind: 'trash' | 'duplicate') {
    if (!post) return;
    if (kind === 'trash') {
      const posted = post.targets.some((t) => t.status === 'published');
      if (!window.confirm(posted ? '휴지통으로 옮깁니다. SNS 에 이미 올라간 글은 지워지지 않습니다.' : '휴지통으로 옮깁니다. 예약도 취소됩니다.')) return;
    }
    try {
      await action.mutateAsync({ id: post.id, action: kind });
      onDone(kind === 'trash' ? '휴지통으로 옮겼습니다.' : '복제해서 날짜 없는 초안을 만들었습니다.');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '처리 실패');
    }
  }

  const shownErrors = { ...errors, ...serverByNetwork };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="composer-title">
      <div className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-surface shadow-xl sm:max-h-[90vh] sm:rounded-xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 id="composer-title" className="text-base font-semibold">
            {!post ? '새 게시물' : locked ? '게시물' : '게시물 수정'}
          </h2>
          {post && <StatusPill status={post.status} />}
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-muted hover:bg-sunken" aria-label="닫기">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 계정 */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-muted">게시할 계정</h3>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted">
                연결된 계정이 없습니다. <Link href="/accounts" className="text-accent underline">계정 연결</Link>에서 먼저 연결하세요.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => {
                  const on = picked.has(a.id);
                  const broken = a.status !== 'active';
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={locked || (broken && !on)}
                      onClick={() => toggle(a.id)}
                      aria-pressed={on}
                      title={broken ? '다시 연결이 필요한 계정입니다' : undefined}
                      className={clsx(
                        'flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors',
                        on ? 'border-accent bg-accent-soft' : 'border-line hover:border-muted',
                        (locked || broken) && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <NetworkBadge network={a.network} size="md" />@{a.handle}
                      {broken && <span className="text-xs text-danger">재연결 필요</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* 본문 */}
          <section className="space-y-2">
            <label htmlFor="composer-text" className="text-xs font-medium tracking-wide text-muted">
              본문
            </label>
            <textarea
              id="composer-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              readOnly={locked}
              rows={7}
              placeholder="무엇을 올릴까요?"
              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[15px] leading-relaxed outline-none focus:border-accent"
            />
            {networks.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {networks.map((n) => {
                  const len = lengthFor(n, text);
                  return (
                    <span key={n} className={clsx(len > RULES[n].maxChars && 'font-semibold text-danger')}>
                      {RULES[n].label} {len.toLocaleString()} / {RULES[n].maxChars.toLocaleString()}
                      {n === 'x' && ' (한글 2자)'}
                    </span>
                  );
                })}
              </div>
            )}
          </section>

          {/* 미디어 */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-muted">이미지 · 동영상</h3>
            <div className="flex flex-wrap gap-2">
              {media.map((m, i) => (
                <div key={m.url} className="group relative h-24 w-24 overflow-hidden rounded-lg border border-line bg-sunken">
                  {m.kind === 'video' ? (
                    <video src={m.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={`첨부 ${i + 1}`} className="h-full w-full object-cover" />
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => setMedia((all) => all.filter((_, j) => j !== i))}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                      aria-label={`첨부 ${i + 1} 빼기`}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {!locked && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="grid h-24 w-24 place-items-center rounded-lg border border-dashed border-line text-muted hover:border-accent hover:text-accent"
                >
                  {uploading ? <Loader2 className="animate-spin" size={20} /> : <ImagePlus size={20} />}
                  <span className="text-[11px]">{uploading ? '올리는 중' : '추가'}</span>
                </button>
              )}
              <input
                ref={fileRef}
                id="composer-files"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
          </section>

          {/* 예약 시각 */}
          <section className="space-y-2">
            <label htmlFor="composer-when" className="text-xs font-medium tracking-wide text-muted">
              예약 시각 <span className="font-normal">({browserTimezone()})</span>
            </label>
            <input
              id="composer-when"
              type="datetime-local"
              value={when}
              readOnly={locked}
              onChange={(e) => setWhen(e.target.value)}
              className={clsx('block rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-accent', past && !locked ? 'border-danger' : 'border-line')}
            />
          </section>

          {/* 계정별 결과(게시 후) */}
          {post && post.targets.length > 0 && post.status !== 'draft' && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted">계정별 결과</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {post.targets.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <NetworkBadge network={t.network} status={t.status} />
                    <span>@{t.handle}</span>
                    <span className={clsx('text-xs', t.status === 'failed' ? 'text-danger' : t.status === 'published' ? 'text-ok' : 'text-muted')}>
                      {TARGET_LABEL[t.status]}
                      {t.status === 'failed' && t.attempts > 0 && ` (${t.attempts}회 시도)`}
                    </span>
                    {t.permalink && (
                      <a href={t.permalink} target="_blank" rel="noreferrer" className="ml-auto text-xs text-accent underline">
                        게시물 보기
                      </a>
                    )}
                    {t.error && <p className="w-full text-xs text-danger">{t.error}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 오류 */}
          {(Object.keys(shownErrors).length > 0 || serverError) && !locked && (
            <section className="space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {serverError && <p className="font-medium">{serverError}</p>}
              {(Object.entries(shownErrors) as [Network, string[]][]).map(([n, errs]) =>
                errs.map((e) => (
                  <p key={n + e}>
                    <b>{RULES[n].label}</b> · {e}
                  </p>
                )),
              )}
            </section>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {post && (
            <>
              <button type="button" disabled={busy} onClick={() => run('trash')} className="rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-soft">
                휴지통으로
              </button>
              <button type="button" disabled={busy} onClick={() => run('duplicate')} className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-sunken">
                복제
              </button>
            </>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-sunken">
              {locked ? '닫기' : '취소'}
            </button>
            {!locked && (
              <>
                <button type="button" disabled={busy} onClick={() => submit('draft')} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-sunken disabled:opacity-50">
                  초안 저장
                </button>
                <button
                  type="button"
                  disabled={busy || !!nowBlock}
                  title={nowBlock ?? undefined}
                  onClick={() => submit('publish_now')}
                  className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-sunken disabled:opacity-50"
                >
                  지금 게시
                </button>
                <button
                  type="button"
                  disabled={busy || !!scheduleBlock}
                  title={scheduleBlock ?? undefined}
                  onClick={() => submit('schedule')}
                  className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
                >
                  {save.isPending && <Loader2 className="animate-spin" size={14} />}
                  예약
                </button>
              </>
            )}
          </div>
          {!locked && scheduleBlock && <p className="w-full text-right text-xs text-muted">{scheduleBlock}</p>}
        </footer>
      </div>
    </div>
  );
}
