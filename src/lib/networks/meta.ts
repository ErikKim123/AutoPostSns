// Meta 계열(Instagram·Facebook·Threads) 공용 — Graph API 호출, 오류 분류, 장기 토큰 교환.
// ⚠️ 서버 전용.
import { fetchJson, PublishError, sleep } from './adapter';

export const GRAPH = 'https://graph.facebook.com/v21.0';
export const THREADS = 'https://graph.threads.net/v1.0';

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean };
}

/** Graph API 오류 → PublishError. 190 = 토큰 무효(재연결 필요), 4/17/32/613 = 호출 한도(재시도). */
export function graphError(json: unknown, fallback: string): PublishError {
  const e = (json as GraphErrorBody | null)?.error;
  const message = e?.message || fallback;
  if (e?.code === 190 || e?.code === 102) return new PublishError(`토큰이 만료되었거나 권한이 없습니다. 계정을 다시 연결하세요. (${message})`, false, true);
  if (e?.code === 10 || e?.code === 200) return new PublishError(`권한이 부족합니다: ${message}`, false, true);
  if (e?.code && [4, 17, 32, 613].includes(e.code)) return new PublishError(`호출 한도 초과 — 잠시 후 다시 시도합니다. (${message})`, true);
  if (e?.is_transient) return new PublishError(message, true);
  // 100 = 잘못된 파라미터(형식·비율·URL 접근 불가 등) — 같은 입력으로는 계속 실패한다.
  if (e?.code === 100) return new PublishError(message, false);
  return new PublishError(message, true);
}

export async function graphGet<T>(base: string, path: string, token: string, fields?: string): Promise<T> {
  const qs = new URLSearchParams({ access_token: token, ...(fields ? { fields } : {}) });
  const { res, json } = await fetchJson<T & GraphErrorBody>(`${base}/${path}?${qs}`);
  if (!res.ok || json.error) throw graphError(json, `조회 실패 (${path})`);
  return json;
}

/** POST — 폼 인코딩. Graph·Threads 둘 다 받는다(배열·객체 값은 JSON 문자열로). */
export async function graphPost<T>(base: string, path: string, token: string, params: Record<string, unknown>): Promise<T> {
  const body = new URLSearchParams({ access_token: token });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const { res, json } = await fetchJson<T & GraphErrorBody>(`${base}/${path}`, { method: 'POST', body, timeoutMs: 60_000 });
  if (!res.ok || json.error) throw graphError(json, `요청 실패 (${path})`);
  return json;
}

/**
 * 미디어 컨테이너 처리 완료 대기. 이 대기 없이 publish 하면 "Media ID is not available" 로 실패한다.
 * 인스타는 status_code, 스레드는 status 필드를 쓴다. 동영상은 트랜스코딩 때문에 훨씬 오래 걸린다.
 */
export async function waitForContainer(base: string, id: string, token: string, isVideo: boolean): Promise<void> {
  const tries = isVideo ? 40 : 10; // 동영상 최대 ~2분, 이미지 ~15초
  const interval = isVideo ? 3000 : 1500;
  const field = base === THREADS ? 'status,error_message' : 'status_code,status';
  for (let i = 0; i < tries; i++) {
    const j = await graphGet<{ status_code?: string; status?: string; error_message?: string }>(base, id, token, field);
    const code = j.status_code ?? j.status;
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new PublishError(j.error_message || j.status || '미디어 처리 실패 — 형식·비율·URL 접근 가능 여부를 확인하세요.', false);
    }
    await sleep(interval);
  }
  throw new PublishError(isVideo ? '동영상 처리 대기 시간 초과 — 다음 실행에서 다시 시도합니다.' : '이미지 처리 대기 시간 초과.', true);
}

/**
 * 짧은 수명 사용자 토큰 → 60일 장기 토큰. 앱 키가 없으면 받은 토큰을 그대로 쓴다(만료 모름).
 * 페이지 토큰은 장기 사용자 토큰에서 꺼내면 만료되지 않는다.
 */
export async function exchangeFacebookToken(token: string): Promise<{ token: string; expiresAt: string | null }> {
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) return { token, expiresAt: null };
  const qs = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: token });
  const { res, json } = await fetchJson<{ access_token?: string; expires_in?: number } & GraphErrorBody>(`${GRAPH}/oauth/access_token?${qs}`);
  if (!res.ok || !json.access_token) throw graphError(json, '장기 토큰 교환 실패 — 앱 ID/시크릿과 토큰을 확인하세요.');
  return {
    token: json.access_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
  };
}

/** 스레드 짧은 토큰 → 60일 장기 토큰(THREADS_APP_SECRET 필요). 이미 장기 토큰이면 오류가 나므로 원본을 쓴다. */
export async function exchangeThreadsToken(token: string): Promise<{ token: string; expiresAt: string | null }> {
  const secret = process.env.THREADS_APP_SECRET;
  if (!secret) return { token, expiresAt: null };
  const qs = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: token });
  const { res, json } = await fetchJson<{ access_token?: string; expires_in?: number }>(`https://graph.threads.net/access_token?${qs}`);
  if (!res.ok || !json.access_token) return { token, expiresAt: null };
  return {
    token: json.access_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
  };
}
