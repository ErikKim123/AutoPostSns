// 회원 확인 — 로그인 계정은 다른 서비스와 공유하므로, autopost.members 에 있는 사람만 통과시킨다.
// ⚠️ 서버 전용. 모든 API 라우트의 첫 줄에서 호출한다.
import { NextResponse } from 'next/server';
import { q1 } from './db';
import { createClient } from './supabase/server';

export interface Member {
  userId: string;
  email: string | null;
  role: 'owner' | 'editor';
}

export async function getMember(): Promise<Member | null> {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  if (!user) return null;
  const row = await q1<{ role: Member['role'] }>(`select role from autopost.members where user_id = $1`, [user.id]);
  return row ? { userId: user.id, email: user.email ?? null, role: row.role } : null;
}

/** API 라우트용 — 회원이 아니면 바로 돌려줄 응답을 준다. */
export async function requireMember(): Promise<Member | NextResponse> {
  const m = await getMember();
  return m ?? NextResponse.json({ error: '로그인이 필요하거나 AutoPostSns 사용 권한이 없습니다.' }, { status: 401 });
}
