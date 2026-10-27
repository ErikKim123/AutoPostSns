// POST /api/media/upload-url { files: [{ name, type, size }] }
// → [{ path, token, publicUrl, kind }] — 브라우저가 uploadToSignedUrl 로 스토리지에 직접 올린다.
// 파일이 서버를 거치지 않으므로 Vercel 요청 크기 제한(4.5MB)에 걸리지 않는다.
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { MEDIA_BUCKET } from '@/lib/supabase/cookie';
import { serviceClient } from '@/lib/supabase/server';

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
// 인스타 이미지 한도(8MB)에 맞춘다. 동영상은 Supabase 프로젝트의 파일 크기 한도도 함께 확인할 것.
const IMAGE_MAX = 8 * 1024 * 1024;
const VIDEO_MAX = 250 * 1024 * 1024;

export async function POST(req: Request) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;

  const body = (await req.json().catch(() => ({}))) as { files?: { name?: string; type?: string; size?: number }[] };
  const files = Array.isArray(body.files) ? body.files.slice(0, 20) : [];
  if (files.length === 0) return NextResponse.json({ error: '올릴 파일이 없습니다.' }, { status: 400 });

  const storage = serviceClient().storage.from(MEDIA_BUCKET);
  const month = new Date().toISOString().slice(0, 7);
  const out: { path: string; token: string; publicUrl: string; kind: 'image' | 'video'; name: string }[] = [];

  for (const f of files) {
    const type = f.type ?? '';
    const ext = IMAGE_TYPES[type] ?? VIDEO_TYPES[type];
    const kind = IMAGE_TYPES[type] ? 'image' : 'video';
    const name = f.name ?? '파일';
    if (!ext) return NextResponse.json({ error: `${name}: JPG·PNG·WEBP·GIF 이미지나 MP4·MOV 동영상만 올릴 수 있습니다.` }, { status: 400 });
    const max = kind === 'image' ? IMAGE_MAX : VIDEO_MAX;
    if (!f.size || f.size > max) {
      return NextResponse.json({ error: `${name}: ${kind === 'image' ? '이미지는 8MB' : '동영상은 250MB'}까지 올릴 수 있습니다.` }, { status: 400 });
    }
    const path = `${month}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: `업로드 준비 실패: ${error?.message ?? '알 수 없음'}` }, { status: 500 });
    out.push({ path, token: data.token, publicUrl: storage.getPublicUrl(path).data.publicUrl, kind, name });
  }
  return NextResponse.json({ uploads: out });
}
