// 게시물 상태 계산 — 계정별 발행 결과(post_targets)를 모아 게시물 하나의 상태로. 순수 함수(테스트: tests/status.test.ts).

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';
export type TargetStatus = 'pending' | 'publishing' | 'published' | 'failed';

/** 실패해도 이만큼까지만 재시도한다(토큰 만료 같은 영구 오류로 매분 재시도하는 것을 막는다). */
export const MAX_ATTEMPTS = 3;

export interface TargetState {
  status: TargetStatus;
  attempts: number;
}

/** 아직 끝나지 않은 대상 — 대기 중이거나, 발행 중이거나, 실패했지만 재시도가 남은 것. */
export function isOpen(t: TargetState): boolean {
  return t.status === 'pending' || t.status === 'publishing' || (t.status === 'failed' && t.attempts < MAX_ATTEMPTS);
}

/**
 * 초안이 아닌 게시물의 상태.
 * - 하나라도 발행 중 → publishing
 * - 끝나지 않은 대상이 남음 → scheduled(cron 대기열에 그대로)
 * - 전부 끝남: 전부 성공 published / 일부 성공 partial / 전부 실패 failed
 */
export function aggregateStatus(targets: TargetState[]): Exclude<PostStatus, 'draft'> {
  if (targets.length === 0) return 'failed';
  if (targets.some((t) => t.status === 'publishing')) return 'publishing';
  if (targets.some(isOpen)) return 'scheduled';
  const ok = targets.filter((t) => t.status === 'published').length;
  if (ok === targets.length) return 'published';
  return ok > 0 ? 'partial' : 'failed';
}

/** 수정 가능 여부 — 이미 SNS 에 올라간 대상이 있으면 내용을 바꿀 수 없다(되돌릴 수 없으므로). */
export function editBlockReason(status: PostStatus, targets: TargetState[]): string | null {
  if (status === 'publishing' || targets.some((t) => t.status === 'publishing')) return '게시가 진행 중입니다. 잠시 후 다시 시도하세요.';
  if (targets.some((t) => t.status === 'published')) return '이미 게시된 계정이 있어 수정할 수 없습니다. 복제해서 새로 예약하세요.';
  return null;
}
