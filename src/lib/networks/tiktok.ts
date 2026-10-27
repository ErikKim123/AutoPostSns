// TikTok — Content Posting API(직접 게시), 동영상 FILE_UPLOAD 방식.
// PULL_FROM_URL 은 미디어 도메인 소유 인증이 필요한데 Supabase 스토리지 도메인은 인증할 수 없어서, 서버가 받아서 올린다.
// ⚠️ 심사(audit) 전 앱은 SELF_ONLY(나만 보기)로만 게시된다. 서버 전용. 실제 계정으로는 아직 검증하지 않았다(README 참고).
import { downloadMedia, fetchJson, PublishError, runPublish, sleep, type Credentials, type NetworkAdapter, type RefreshedCredentials } from './adapter';

const API = 'https://open.tiktokapis.com/v2';
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;

interface TtBody<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

function ttFail(json: TtBody<unknown>, status: number, fallback: string): PublishError {
  const code = json.error?.code;
  const msg = `${fallback}: ${json.error?.message || code || status}`;
  if (code === 'access_token_invalid' || code === 'scope_not_authorized' || status === 401) return new PublishError(msg, false, true);
  if (code === 'rate_limit_exceeded' || status === 429 || status >= 500) return new PublishError(msg, true);
  return new PublishError(msg, false);
}

async function ttPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const { res, json } = await fetchJson<TtBody<T>>(`${API}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok || (json.error?.code && json.error.code !== 'ok') || !json.data) throw ttFail(json, res.status, path);
  return json.data;
}

async function refresh(creds: Credentials): Promise<RefreshedCredentials> {
  const key = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!creds.refreshToken || !key || !secret) throw new PublishError('TikTok 토큰이 만료되었습니다. 계정을 다시 연결하세요.', false, true);
  const { res, json } = await fetchJson<{ access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }>(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: creds.refreshToken }),
  });
  if (!res.ok || !json.access_token) throw new PublishError(`TikTok 토큰 갱신 실패: ${json.error_description ?? res.status}`, false, true);
  return {
    credentials: { accessToken: json.access_token, refreshToken: json.refresh_token ?? creds.refreshToken },
    tokenExpiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
  };
}

/** 분할 규칙: 64MB 이하는 한 번에, 넘으면 10MB 단위(마지막 조각이 나머지를 흡수). */
export function chunkPlan(size: number): { chunkSize: number; count: number } {
  if (size <= MAX_SINGLE_CHUNK) return { chunkSize: size, count: 1 };
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

export const tiktok: NetworkAdapter = {
  network: 'tiktok',

  async discover(creds) {
    const { res, json } = await fetchJson<TtBody<{ user?: { open_id: string; display_name?: string } }>>(`${API}/user/info/?fields=open_id,display_name`, {
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });
    const user = json.data?.user;
    if (!res.ok || !user) throw ttFail(json, res.status, 'TikTok 계정 확인 실패');
    return [{ externalId: user.open_id, handle: user.display_name ?? user.open_id, credentials: creds, tokenExpiresAt: null }];
  },

  publish(account, input) {
    return runPublish(async () => {
      const video = input.media.find((m) => m.kind === 'video');
      if (!video || input.media.length !== 1) throw new PublishError('TikTok 은 동영상 1개만 게시할 수 있습니다.', false);

      let refreshed: RefreshedCredentials | undefined;
      if (account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now() + 60_000) {
        refreshed = await refresh(account.credentials);
      }
      const token = refreshed?.credentials.accessToken ?? account.credentials.accessToken;

      // 1) 이 계정이 쓸 수 있는 공개 범위 — 심사 전 앱은 SELF_ONLY 만 온다.
      const info = await ttPost<{ privacy_level_options?: string[] }>('post/publish/creator_info/query/', token, {});
      const options = info.privacy_level_options ?? [];
      const wanted = typeof input.options.privacy === 'string' ? input.options.privacy : 'PUBLIC_TO_EVERYONE';
      const privacy = options.includes(wanted) ? wanted : options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
      if (!privacy) throw new PublishError('TikTok 이 허용하는 공개 범위가 없습니다(계정 상태 확인).', false);

      // 2) 업로드 준비
      const { bytes, contentType } = await downloadMedia(video.url);
      const { chunkSize, count } = chunkPlan(bytes.length);
      const init = await ttPost<{ publish_id: string; upload_url: string }>('post/publish/video/init/', token, {
        post_info: { title: input.text.slice(0, 2200), privacy_level: privacy },
        source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: chunkSize, total_chunk_count: count },
      });

      // 3) 조각 업로드
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = i === count - 1 ? bytes.length - 1 : start + chunkSize - 1;
        const res = await fetch(init.upload_url, {
          method: 'PUT',
          headers: { 'content-type': contentType.startsWith('video/') ? contentType : 'video/mp4', 'content-range': `bytes ${start}-${end}/${bytes.length}` },
          body: bytes.slice(start, end + 1),
          signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) throw new PublishError(`TikTok 업로드 실패(${i + 1}/${count}): ${res.status}`, true);
      }

      // 4) 처리 결과 대기 — 오래 걸리면 publish_id 만 남기고 성공으로 본다(TikTok 이 계속 처리한다).
      for (let i = 0; i < 20; i++) {
        await sleep(3000);
        const st = await ttPost<{ status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
          'post/publish/status/fetch/',
          token,
          { publish_id: init.publish_id },
        );
        if (st.status === 'FAILED') throw new PublishError(`TikTok 처리 실패: ${st.fail_reason ?? '원인 미상'}`, false);
        if (st.status === 'PUBLISH_COMPLETE') {
          const postId = st.publicaly_available_post_id?.[0];
          return { remoteId: postId ? String(postId) : init.publish_id, refreshed };
        }
      }
      return { remoteId: init.publish_id, refreshed };
    });
  },
};
