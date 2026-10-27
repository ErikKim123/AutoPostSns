// DELETE /api/accounts/:id — 연결 해제. 이 계정의 예약 대상도 함께 지워진다(화면에서 개수를 먼저 안내).
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { deleteAccount } from '@/lib/accounts';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  try {
    await deleteAccount(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '삭제 실패' }, { status: 500 });
  }
}
