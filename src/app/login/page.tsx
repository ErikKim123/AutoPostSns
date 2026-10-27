// 로그인 — 계정은 같은 Supabase 의 다른 서비스와 공유. AutoPostSns 회원(autopost.members)만 들어갈 수 있다.
'use client';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const notMember = params.get('error') === 'not_member';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message === 'Invalid login credentials' ? '이메일이나 비밀번호가 맞지 않습니다.' : error.message);
      return;
    }
    router.replace('/calendar');
    router.refresh();
  }

  async function switchAccount() {
    await createClient().auth.signOut({ scope: 'local' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">
            AutoPost<span className="text-accent">Sns</span>
          </h1>
          <p className="text-sm text-muted">여러 SNS 예약 게시</p>
        </div>

        {notMember ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
              이 계정은 AutoPostSns 사용 권한이 없습니다. 관리자에게 회원 등록을 요청하세요.
            </p>
            <button type="button" onClick={switchAccount} className="w-full rounded-lg border border-line px-3 py-2 text-sm hover:bg-sunken">
              다른 계정으로 로그인
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="login-email" className="text-xs font-medium text-muted">
                이메일
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="login-password" className="text-xs font-medium text-muted">
                비밀번호
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            {error && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-50">
              {busy && <Loader2 className="animate-spin" size={14} />}
              로그인
            </button>
          </>
        )}
      </form>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams 는 Suspense 경계가 있어야 정적 빌드가 된다.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
