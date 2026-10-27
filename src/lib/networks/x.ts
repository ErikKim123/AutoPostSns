// X(트위터) — API v2, OAuth 2.0 사용자 토큰(scope: tweet.read tweet.write users.read media.write offline.access).
// 이미지는 v2 미디어 업로드(단일 요청) 후 media_ids 로 붙인다. 동영상(분할 업로드)은 아직 지원하지 않는다.
// 액세스 토큰은 2시간이면 만료 → refresh_token 으로 갱신하고, 갱신된 토큰을 엔진이 계정에 다시 저장한다.
// ⚠️ 서버 전용. 실제 X 계정으로는 아직 검증하지 않았다(README 참고).
import { downloadMedia, fetchJson, PublishError, runPublish, type Credentials, type NetworkAdapter, type RefreshedCredentials } from './adapter';

const API = 'https://api.x.com/2';

interface XError {
  title?: string;
  detail?: string;
  errors?: { message?: string }[];
}

function xMessage(json: XError, fallback: string): string {
  return json.detail || json.errors?.[0]?.message || json.title || fallback;
}

async function refresh(creds: Credentials): Promise<RefreshedCredentials> {
  const clientId = process.env.X_CLIENT_ID;
  if (!creds.refreshToken || !clientId) {
    throw new PublishError('X 토큰이 만료되었습니다. 계정을 다시 연결하세요(X_CLIENT_ID 와 refresh token 이 있으면 자동 갱신).', false, true);
  }
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  const secret = process.env.X_CLIENT_SECRET;
  if (secret) headers.authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
  const { res, json } = await fetchJson<{ access_token?: string; refresh_token?: string; expires_in?: number } & XError>(`${API}/oauth2/token`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: clientId }),
  });
  if (!res.ok || !json.access_token) throw new PublishError(`X 토큰 갱신 실패: ${xMessage(json, String(res.status))}`, false, true);
  return {
    credentials: { accessToken: json.access_token, refreshToken: json.refresh_token ?? creds.refreshToken },
    tokenExpiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
  };
}

async function uploadImage(token: string, url: string): Promise<string> {
  const { bytes, contentType } = await downloadMedia(url);
  const form = new FormData();
  form.set('media', new Blob([bytes], { type: contentType }));
  form.set('media_category', 'tweet_image');
  const { res, json } = await fetchJson<{ data?: { id?: string } } & XError>(`${API}/media/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    timeoutMs: 120_000,
  });
  if (res.status === 401) throw new PublishError('unauthorized', true, true);
  if (!res.ok || !json.data?.id) throw new PublishError(`X 이미지 업로드 실패: ${xMessage(json, String(res.status))}`, res.status >= 500 || res.status === 429);
  return json.data.id;
}

async function tweet(token: string, text: string, mediaIds: string[]): Promise<string> {
  const { res, json } = await fetchJson<{ data?: { id?: string } } & XError>(`${API}/tweets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
  });
  if (res.status === 401) throw new PublishError('unauthorized', true, true);
  if (!res.ok || !json.data?.id) {
    // 403 = 중복 글·권한 없음 등 같은 입력으로는 계속 실패한다.
    throw new PublishError(`X 게시 실패: ${xMessage(json, String(res.status))}`, res.status >= 500 || res.status === 429);
  }
  return json.data.id;
}

export const x: NetworkAdapter = {
  network: 'x',

  async discover(creds) {
    const { res, json } = await fetchJson<{ data?: { id: string; username: string } } & XError>(`${API}/users/me`, {
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });
    if (!res.ok || !json.data) throw new PublishError(`X 계정 확인 실패: ${xMessage(json, String(res.status))}`, false);
    return [{ externalId: json.data.id, handle: json.data.username, credentials: creds, tokenExpiresAt: null }];
  },

  publish(account, input) {
    return runPublish(async () => {
      if (input.media.some((m) => m.kind === 'video')) throw new PublishError('X 동영상 게시는 아직 지원하지 않습니다.', false);

      let refreshed: RefreshedCredentials | undefined;
      const expiresSoon = account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now() + 60_000;
      if (expiresSoon) refreshed = await refresh(account.credentials);

      const attempt = async (token: string) => {
        const ids: string[] = [];
        for (const m of input.media) ids.push(await uploadImage(token, m.url));
        return tweet(token, input.text, ids);
      };

      let id: string;
      try {
        id = await attempt(refreshed?.credentials.accessToken ?? account.credentials.accessToken);
      } catch (err) {
        const unauthorized = err instanceof PublishError && err.message === 'unauthorized';
        if (!unauthorized) throw err;
        if (refreshed) throw new PublishError('X 인증 실패 — 계정을 다시 연결하세요.', false, true);
        // 만료 시각을 모르는 토큰이 401 을 받으면 한 번만 갱신 후 재시도.
        refreshed = await refresh(account.credentials);
        try {
          id = await attempt(refreshed.credentials.accessToken);
        } catch (again) {
          if (again instanceof PublishError && again.message === 'unauthorized') {
            throw new PublishError('X 인증 실패 — 계정을 다시 연결하세요.', false, true);
          }
          throw again;
        }
      }
      return { remoteId: id, permalink: `https://x.com/${account.handle}/status/${id}`, refreshed };
    });
  },
};
