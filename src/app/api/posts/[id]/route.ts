// GET    /api/posts/:id                 — 1건
// PATCH  /api/posts/:id                 — 수정 { text, media, publishAt, timezone, accountIds, mode }
// DELETE /api/posts/:id                 — 휴지통으로
// DELETE /api/posts/:id?permanent=1     — 영구 삭제(휴지통에 있는 것만)
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { publishPostNow } from '@/lib/engine';
import { getPost, parseSaveInput, purgePost, SaveRejected, trashPost, updatePost } from '@/lib/posts';

export const maxDuration = 300;

type Ctx = { params: { id: string } };

function fail(err: unknown) {
  if (err instanceof SaveRejected) return NextResponse.json({ error: err.message, byNetwork: err.byNetwork }, { status: 400 });
  return NextResponse.json({ error: err instanceof Error ? err.message : '처리 실패' }, { status: 500 });
}

export async function GET(_req: Request, { params }: Ctx) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  const post = await getPost(params.id).catch(() => null);
  return post ? NextResponse.json({ post }) : NextResponse.json({ error: '게시물을 찾을 수 없습니다.' }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  try {
    const input = parseSaveInput(await req.json());
    await updatePost(params.id, input);
    if (input.mode === 'publish_now') await publishPostNow(params.id);
    return NextResponse.json({ post: await getPost(params.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  try {
    if (new URL(req.url).searchParams.get('permanent') === '1') await purgePost(params.id);
    else await trashPost(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
