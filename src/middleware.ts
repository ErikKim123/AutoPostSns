// 세션 가드(1차 방어) + 세션 쿠키 갱신. 회원 여부(autopost.members)는 (app)/layout 과 각 API 가 확인한다.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE } from '@/lib/supabase/cookie';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // 환경변수가 없으면 가드를 건너뛴다 — 로그인 화면은 떠야 설정 누락을 알 수 있다.
  if (!supabaseUrl || !supabaseKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: { name: AUTH_COOKIE },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!user && !pathname.startsWith('/login') && !pathname.startsWith('/api/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  // 로그인했지만 회원이 아니면 (app)/layout 이 /login?error=not_member 로 보낸다 — 그 화면은 그대로 보여 줘야 순환하지 않는다.
  if (user && pathname.startsWith('/login') && !request.nextUrl.searchParams.has('error')) {
    const url = request.nextUrl.clone();
    url.pathname = '/calendar';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // cron 은 세션이 없다(CRON_SECRET 으로 보호). 정적 파일은 건너뛴다.
  matcher: ['/((?!api/cron|_next/static|_next/image|favicon.ico).*)'],
};
