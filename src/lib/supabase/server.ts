// 서버 Supabase 클라이언트 — 로그인 세션 확인(auth)과 스토리지 서명 URL 발급에만 쓴다. DB 는 lib/db.ts.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { AUTH_COOKIE } from './cookie';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    // 같은 도메인의 다른 서비스와 세션이 섞이지 않도록 전용 쿠키명
    cookieOptions: { name: AUTH_COOKIE },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // 서버 컴포넌트에서는 set 불가 — 세션 갱신은 middleware 가 한다.
        }
      },
    },
  });
}

/** service_role — 스토리지 서명 업로드 URL 발급용. 브라우저 번들에 들어가면 안 된다. */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase 환경변수 누락: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
