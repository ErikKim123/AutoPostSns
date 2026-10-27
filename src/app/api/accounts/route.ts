// GET  /api/accounts — 연결된 계정(토큰 제외)
// POST /api/accounts { network, accessToken, refreshToken?, externalIds? }
//   externalIds 없이 보내면 토큰으로 찾은 후보만 돌려준다(연결하지 않음) → 화면에서 고른 뒤 externalIds 와 함께 다시 보낸다.
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listAccounts, upsertAccount } from '@/lib/accounts';
import { ADAPTERS } from '@/lib/networks';
import { isNetwork } from '@/lib/networks/rules';

export async function GET() {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  try {
    return NextResponse.json({ accounts: await listAccounts() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireMember();
  if (m instanceof NextResponse) return m;
  const b = (await req.json().catch(() => ({}))) as { network?: unknown; accessToken?: unknown; refreshToken?: unknown; externalIds?: unknown };
  if (!isNetwork(b.network)) return NextResponse.json({ error: '지원하지 않는 SNS 입니다.' }, { status: 400 });
  if (typeof b.accessToken !== 'string' || b.accessToken.trim().length < 10) {
    return NextResponse.json({ error: '액세스 토큰을 붙여 넣으세요.' }, { status: 400 });
  }
  const network = b.network;
  try {
    const found = await ADAPTERS[network].discover({
      accessToken: b.accessToken.trim(),
      refreshToken: typeof b.refreshToken === 'string' && b.refreshToken.trim() ? b.refreshToken.trim() : undefined,
    });
    const pick = Array.isArray(b.externalIds) ? b.externalIds.filter((x): x is string => typeof x === 'string') : null;
    if (!pick) {
      // 후보만 보여 준다. 토큰은 돌려보내지 않는다.
      return NextResponse.json({ candidates: found.map((d) => ({ externalId: d.externalId, handle: d.handle })) });
    }
    const chosen = found.filter((d) => pick.includes(d.externalId));
    if (chosen.length === 0) return NextResponse.json({ error: '고른 계정을 이 토큰으로 찾지 못했습니다.' }, { status: 400 });
    for (const d of chosen) await upsertAccount(network, d, m.userId);
    return NextResponse.json({ accounts: await listAccounts() }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '계정 연결 실패' }, { status: 400 });
  }
}
