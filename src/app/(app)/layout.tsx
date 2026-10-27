// 로그인 후 화면 공통 — 회원(autopost.members) 확인 + 상단 탐색.
import { redirect } from 'next/navigation';
import { getMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Nav } from '@/components/Nav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await getMember();
  if (!member) {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    // 로그인은 했지만 회원이 아니면 이유를 보여 준다(그냥 /login 이면 미들웨어가 다시 돌려보내 순환한다).
    redirect(user ? '/login?error=not_member' : '/login');
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav email={member.email} />
      <main className="mx-auto w-full max-w-7xl flex-1 py-5 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        {children}
      </main>
    </div>
  );
}
