// SNS 어댑터 공통 인터페이스 — 발행 엔진(lib/engine.ts)은 네트워크를 몰라도 이 모양만 보고 돌린다.
// ⚠️ 서버 전용(토큰을 다룬다).
import type { MediaItem, Network } from './rules';

export interface Credentials {
  accessToken: string;
  refreshToken?: string;
}

export interface AccountRef {
  id: string;
  network: Network;
  handle: string;
  externalId: string;
  credentials: Credentials;
  tokenExpiresAt: string | null;
}

export interface PublishInput {
  text: string;
  media: MediaItem[];
  options: Record<string, unknown>;
}

/** 발행 중 토큰을 갱신했으면 엔진이 계정 행에 다시 저장한다. */
export interface RefreshedCredentials {
  credentials: Credentials;
  tokenExpiresAt: string | null;
}

export type PublishResult =
  | { ok: true; remoteId: string; permalink?: string; refreshed?: RefreshedCredentials }
  | {
      ok: false;
      error: string;
      /** false 면 남은 시도 횟수와 무관하게 다시 시도하지 않는다(형식 오류 등). */
      retryable: boolean;
      /** 토큰 만료·권한 회수 — 계정을 needs_reauth 로 바꾼다. */
      needsReauth?: boolean;
      refreshed?: RefreshedCredentials;
    };

/** 토큰으로 찾은 연결 후보 계정(계정 연결 화면에서 고른다). */
export interface DiscoveredAccount {
  externalId: string;
  handle: string;
  credentials: Credentials;
  tokenExpiresAt: string | null;
}

export interface NetworkAdapter {
  network: Network;
  publish(account: AccountRef, input: PublishInput): Promise<PublishResult>;
  discover(input: Credentials): Promise<DiscoveredAccount[]>;
}

/** 어댑터 안에서 던지는 오류 — publish 래퍼가 PublishResult 로 바꾼다. */
export class PublishError extends Error {
  constructor(
    message: string,
    public retryable = true,
    public needsReauth = false,
  ) {
    super(message);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 응답이 JSON 이 아니어도 죽지 않는 fetch. 기본 30초 제한. */
export async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ res: Response; json: T }> {
  const { timeoutMs = 30_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  let json: unknown = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw: raw.slice(0, 500) };
  }
  return { res, json: json as T };
}

/** 공개 URL 의 미디어를 내려받는다(파일 업로드 방식 API 용: X, TikTok). */
export async function downloadMedia(url: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new PublishError(`미디어를 내려받지 못했습니다(${res.status}). 파일이 지워졌는지 확인하세요.`, false);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/** 어댑터 본체를 감싸 예외를 PublishResult 로 바꾼다. */
export async function runPublish(
  fn: () => Promise<{ remoteId: string; permalink?: string; refreshed?: RefreshedCredentials }>,
): Promise<PublishResult> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    if (err instanceof PublishError) {
      return { ok: false, error: err.message, retryable: err.retryable, needsReauth: err.needsReauth };
    }
    const msg = err instanceof Error ? err.message : '발행 중 알 수 없는 오류';
    // 네트워크 타임아웃 등은 다음 cron 에서 다시 시도해 볼 만하다.
    return { ok: false, error: msg, retryable: true };
  }
}
