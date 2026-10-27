// 휴지통 — 복원하거나 영구 삭제. 삭제는 AutoPostSns 기록만 지운다(SNS 에 올라간 글은 그대로).
'use client';
import { useState } from 'react';
import { NetworkBadge, StatusPill } from './Badges';
import { Toast } from './Toast';
import { usePostAction, useTrash } from '@/lib/client/api';
import { fmtDateTime } from '@/lib/client/dates';

export function TrashView() {
  const trash = useTrash();
  const action = usePostAction();
  const [toast, setToast] = useState<string | null>(null);

  async function restore(id: string) {
    try {
      const r = await action.mutateAsync({ id, action: 'restore' });
      setToast(r.movedToDraft ? '복원했습니다. 예약 시각이 지나서 초안으로 바꿨습니다.' : '복원했습니다.');
    } catch (err) {
      setToast(err instanceof Error ? err.message : '복원 실패');
    }
  }

  async function purge(id: string) {
    if (!window.confirm('영구 삭제합니다. 되돌릴 수 없습니다.')) return;
    try {
      await action.mutateAsync({ id, action: 'purge' });
      setToast('영구 삭제했습니다.');
    } catch (err) {
      setToast(err instanceof Error ? err.message : '삭제 실패');
    }
  }

  const posts = trash.data?.posts ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">휴지통</h1>
        <p className="text-sm text-muted">지운 게시물은 예약이 멈춥니다. 복원하면 다시 캘린더에 나타납니다.</p>
      </div>
      {trash.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{trash.error.message}</p>}
      {trash.isLoading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : posts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-10 text-center text-sm text-muted">휴지통이 비어 있습니다.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {posts.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusPill status={p.status} />
                  <span>{p.publishAt ? fmtDateTime(p.publishAt) : '날짜 없음'}</span>
                  <span>· 삭제 {fmtDateTime(p.deletedAt!)}</span>
                  {p.targets.map((t) => (
                    <NetworkBadge key={t.id} network={t.network} status={t.status === 'pending' ? undefined : t.status} />
                  ))}
                </div>
                <p className="truncate text-sm">{p.text || '(본문 없음)'}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={action.isPending} onClick={() => restore(p.id)} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-sunken">
                  복원
                </button>
                <button type="button" disabled={action.isPending} onClick={() => purge(p.id)} className="rounded-lg px-3 py-1.5 text-sm text-danger hover:bg-danger-soft">
                  영구 삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
