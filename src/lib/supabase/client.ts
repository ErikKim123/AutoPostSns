// 브라우저 Supabase 클라이언트 — 로그인과 서명 URL 업로드에만 쓴다(DB 는 서버 API 경유).
'use client';
import { createBrowserClient } from '@supabase/ssr';
import { AUTH_COOKIE } from './cookie';

// 싱글톤 — 여러 GoTrueClient 인스턴스의 락 경쟁(로그인 교착) 방지
let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  browserClient ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: AUTH_COOKIE },
  });
  return browserClient;
}
