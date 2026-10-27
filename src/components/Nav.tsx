// 상단 탐색 — 캘린더 · 휴지통 · 계정 연결 + 로그아웃.
'use client';
import clsx from 'clsx';
import { CalendarDays, Link2, LogOut, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const LINKS = [
  { href: '/calendar', label: '캘린더', icon: CalendarDays },
  { href: '/trash', label: '휴지통', icon: Trash2 },
  { href: '/accounts', label: '계정 연결', icon: Link2 },
];

export function Nav({ email }: { email: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    // scope: local — 같은 계정으로 로그인한 다른 서비스의 세션은 유지한다.
    await createClient().auth.signOut({ scope: 'local' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-7xl items-center gap-1 py-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        <Link href="/calendar" className="mr-3 text-[15px] font-bold tracking-tight">
          AutoPost<span className="text-accent">Sns</span>
        </Link>
        <nav className="flex gap-1">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname.startsWith(href) ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm',
                pathname.startsWith(href) ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-sunken',
              )}
            >
              <Icon size={16} />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {email && <span className="hidden text-xs text-muted md:inline">{email}</span>}
          <button type="button" onClick={signOut} className="rounded-lg p-1.5 text-muted hover:bg-sunken" aria-label="로그아웃" title="로그아웃">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
