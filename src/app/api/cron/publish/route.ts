// 예약 게시 자동 실행 — Vercel Cron(또는 Supabase pg_cron + pg_net)이 주기적으로 호출한다.
// 보호: CRON_SECRET 을 Authorization: Bearer 로(Vercel Cron 이 자동으로 붙인다) 또는 ?key= 로.
import { NextResponse } from 'next/server';
import { publishDue } from '@/lib/engine';

// 여러 건 × 동영상 처리 대기를 감안한 여유. 엔진은 240초가 지나면 새 대상을 집지 않는다.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 503 });
  const key = new URL(req.url).searchParams.get('key') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (key !== secret) return NextResponse.json({ error: '권한 없음' }, { status: 401 });

  try {
    const { released, results } = await publishDue();
    return NextResponse.json({ ok: true, released, processed: results.length, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'cron 실패' }, { status: 500 });
  }
}
