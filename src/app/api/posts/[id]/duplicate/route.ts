// POST /api/posts/:id/duplicate — 같은 내용·계정으로 날짜 없는 초안을 만든다.
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { duplicatePost, getPost, SaveRejected } from '@/lib/posts';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  try {
    const id = await duplicatePost(params.id, m.userId);
    return NextResponse.json({ post: await getPost(id) }, { status: 201 });
  } catch (err) {
    const status = err instanceof SaveRejected ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : '복제 실패' }, { status });
  }
}
