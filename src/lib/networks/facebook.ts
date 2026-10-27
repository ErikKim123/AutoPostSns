// Facebook 페이지 — Graph API. 페이지 토큰으로 게시한다(장기 사용자 토큰에서 꺼낸 페이지 토큰은 만료되지 않음).
// 글만: /feed · 사진 1장: /photos · 사진 여러 장: 비공개 업로드 후 /feed 에 attached_media · 동영상: /videos
// ⚠️ 서버 전용.
import { PublishError, runPublish, type NetworkAdapter } from './adapter';
import { GRAPH, exchangeFacebookToken, graphGet, graphPost } from './meta';

export const facebook: NetworkAdapter = {
  network: 'facebook',

  async discover({ accessToken }) {
    const long = await exchangeFacebookToken(accessToken);
    const j = await graphGet<{ data?: { id: string; name: string; access_token?: string }[] }>(GRAPH, 'me/accounts', long.token, 'id,name,access_token');
    const pages = (j.data ?? []).filter((p) => p.access_token);
    if (pages.length === 0) throw new PublishError('관리 중인 Facebook 페이지가 없거나 pages_manage_posts 권한이 없습니다.', false);
    return pages.map((p) => ({
      externalId: p.id,
      handle: p.name,
      credentials: { accessToken: p.access_token! },
      tokenExpiresAt: null,
    }));
  },

  publish(account, input) {
    return runPublish(async () => {
      const token = account.credentials.accessToken;
      const page = account.externalId;
      const video = input.media.find((m) => m.kind === 'video');
      const images = input.media.filter((m) => m.kind === 'image');

      let postId: string;
      if (video) {
        const r = await graphPost<{ id?: string }>(GRAPH, `${page}/videos`, token, { file_url: video.url, description: input.text });
        if (!r.id) throw new PublishError('동영상 게시 응답에 ID 가 없습니다.', true);
        postId = r.id;
      } else if (images.length === 1) {
        const r = await graphPost<{ id?: string; post_id?: string }>(GRAPH, `${page}/photos`, token, { url: images[0]!.url, message: input.text });
        if (!r.id) throw new PublishError('사진 게시 응답에 ID 가 없습니다.', true);
        postId = r.post_id ?? r.id;
      } else if (images.length > 1) {
        const ids: string[] = [];
        for (const img of images) {
          const r = await graphPost<{ id?: string }>(GRAPH, `${page}/photos`, token, { url: img.url, published: false });
          if (!r.id) throw new PublishError('사진 업로드 응답에 ID 가 없습니다.', true);
          ids.push(r.id);
        }
        const r = await graphPost<{ id?: string }>(GRAPH, `${page}/feed`, token, {
          message: input.text,
          attached_media: ids.map((media_fbid) => ({ media_fbid })),
        });
        if (!r.id) throw new PublishError('게시 응답에 ID 가 없습니다.', true);
        postId = r.id;
      } else {
        const r = await graphPost<{ id?: string }>(GRAPH, `${page}/feed`, token, { message: input.text });
        if (!r.id) throw new PublishError('게시 응답에 ID 가 없습니다.', true);
        postId = r.id;
      }

      let permalink: string | undefined;
      try {
        permalink = (await graphGet<{ permalink_url?: string }>(GRAPH, postId, token, 'permalink_url')).permalink_url;
      } catch {
        /* 무시 */
      }
      return { remoteId: postId, permalink };
    });
  },
};
