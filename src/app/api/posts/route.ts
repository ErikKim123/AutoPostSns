// GET  /api/posts?from=ISO&to=ISO  — 캘린더 기간 조회(+ 날짜 없는 초안)
// GET  /api/posts?view=trash       — 휴지통
// POST /api/posts                  — 새 게시물 { text, media, publishAt, timezone, accountIds, mode }
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { publishPostNow } from '@/lib/engine';
import { createPost, getPost, listRange, listTrash, listUndatedDrafts, parseSaveInput, SaveRejected } from '@/lib/posts';

// "지금 게시"는 응답 안에서 발행까지 끝낸다(동영상 처리 대기 포함).
export const maxDuration = 300;

export async function GET(req: Request) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('view') === 'trash') return NextResponse.json({ posts: await listTrash() });
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      return NextResponse.json({ error: 'from, to(ISO 날짜)가 필요합니다.' }, { status: 400 });
    }
    const [posts, undated] = await Promise.all([listRange(from, to), listUndatedDrafts()]);
    return NextResponse.json({ posts, undated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  try {
    const input = parseSaveInput(await req.json());
    const id = await createPost(input, m.userId);
    if (input.mode === 'publish_now') await publishPostNow(id);
    return NextResponse.json({ post: await getPost(id) }, { status: 201 });
  } catch (err) {
    if (err instanceof SaveRejected) return NextResponse.json({ error: err.message, byNetwork: err.byNetwork }, { status: 400 });
    return NextResponse.json({ error: err instanceof Error ? err.message : '저장 실패' }, { status: 500 });
  }
}
