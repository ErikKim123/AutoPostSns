// POST /api/posts/:id/restore — 휴지통에서 복원. 시각이 지난 예약은 초안으로 돌아온다.
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { restorePost, SaveRejected } from '@/lib/posts';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  try {
    return NextResponse.json(await restorePost(params.id));
  } catch (err) {
    const status = err instanceof SaveRejected ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : '복원 실패' }, { status });
  }
}
