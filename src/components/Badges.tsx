// 네트워크 배지 · 상태 표시 — 캘린더 카드, 작성 창, 휴지통, 계정 화면이 같이 쓴다.
import clsx from 'clsx';
import type { Network } from '@/lib/networks/rules';
import { RULES } from '@/lib/networks/rules';
import type { PostStatus, TargetStatus } from '@/lib/status';

// 브랜드 고유색은 배지 바탕에만 쓰고 글자는 흰색 고정(라이트·다크 모두 읽힌다).
const NETWORK_STYLE: Record<Network, { short: string; bg: string }> = {
  instagram: { short: 'IG', bg: '#C13584' },
  facebook: { short: 'FB', bg: '#1877F2' },
  threads: { short: 'TH', bg: '#333333' },
  x: { short: 'X', bg: '#111111' },
  tiktok: { short: 'TT', bg: '#0F8F8A' },
};

export function NetworkBadge({ network, status, size = 'sm' }: { network: Network; status?: TargetStatus; size?: 'sm' | 'md' }) {
  const s = NETWORK_STYLE[network];
  return (
    <span
      title={`${RULES[network].label}${status ? ` · ${TARGET_LABEL[status]}` : ''}`}
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded font-semibold text-white',
        size === 'sm' ? 'h-5 min-w-5 px-1 text-[10px]' : 'h-6 min-w-6 px-1.5 text-[11px]',
        status === 'failed' && 'ring-2 ring-danger ring-offset-1 ring-offset-surface',
        status === 'published' && 'ring-2 ring-ok ring-offset-1 ring-offset-surface',
      )}
      style={{ background: s.bg }}
    >
      {s.short}
    </span>
  );
}

export const POST_LABEL: Record<PostStatus, string> = {
  draft: '초안',
  scheduled: '예약',
  publishing: '게시 중',
  published: '게시됨',
  partial: '일부 실패',
  failed: '실패',
};

export const TARGET_LABEL: Record<TargetStatus, string> = {
  pending: '대기',
  publishing: '게시 중',
  published: '게시됨',
  failed: '실패',
};

const PILL: Record<PostStatus, string> = {
  draft: 'bg-sunken text-muted',
  scheduled: 'bg-accent-soft text-accent',
  publishing: 'bg-warn-soft text-warn',
  published: 'bg-ok-soft text-ok',
  partial: 'bg-warn-soft text-warn',
  failed: 'bg-danger-soft text-danger',
};

export function StatusPill({ status }: { status: PostStatus }) {
  return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', PILL[status])}>{POST_LABEL[status]}</span>;
}
