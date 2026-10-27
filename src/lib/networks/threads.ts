// Threads — graph.threads.net. 인스타와 같은 2단계(컨테이너 생성 → threads_publish).
// 글만: TEXT · 1개: IMAGE/VIDEO · 여러 개: 항목 컨테이너 → CAROUSEL.
// ⚠️ 서버 전용.
import type { MediaItem } from './rules';
import { PublishError, runPublish, type NetworkAdapter } from './adapter';
import { THREADS, exchangeThreadsToken, graphGet, graphPost, waitForContainer } from './meta';

function mediaParams(m: MediaItem): Record<string, unknown> {
  return m.kind === 'video' ? { media_type: 'VIDEO', video_url: m.url } : { media_type: 'IMAGE', image_url: m.url };
}

export const threads: NetworkAdapter = {
  network: 'threads',

  async discover({ accessToken }) {
    const long = await exchangeThreadsToken(accessToken);
    const me = await graphGet<{ id: string; username?: string }>(THREADS, 'me', long.token, 'id,username');
    return [{ externalId: me.id, handle: me.username ?? me.id, credentials: { accessToken: long.token }, tokenExpiresAt: long.expiresAt }];
  },

  publish(account, input) {
    return runPublish(async () => {
      const token = account.credentials.accessToken;
      const uid = account.externalId;

      let containerId: string;
      let hasVideo = false;
      if (input.media.length <= 1) {
        const m = input.media[0];
        const params = m ? { ...mediaParams(m), text: input.text } : { media_type: 'TEXT', text: input.text };
        hasVideo = m?.kind === 'video';
        const r = await graphPost<{ id?: string }>(THREADS, `${uid}/threads`, token, params);
        if (!r.id) throw new PublishError('스레드 컨테이너를 만들지 못했습니다.', false);
        containerId = r.id;
      } else {
        const children: string[] = [];
        for (const m of input.media) {
          const r = await graphPost<{ id?: string }>(THREADS, `${uid}/threads`, token, { ...mediaParams(m), is_carousel_item: true });
          if (!r.id) throw new PublishError('캐러셀 항목을 만들지 못했습니다.', false);
          await waitForContainer(THREADS, r.id, token, m.kind === 'video');
          children.push(r.id);
        }
        const r = await graphPost<{ id?: string }>(THREADS, `${uid}/threads`, token, {
          media_type: 'CAROUSEL',
          children: children.join(','),
          text: input.text,
        });
        if (!r.id) throw new PublishError('캐러셀 컨테이너를 만들지 못했습니다.', false);
        containerId = r.id;
      }
      await waitForContainer(THREADS, containerId, token, hasVideo);

      const pub = await graphPost<{ id?: string }>(THREADS, `${uid}/threads_publish`, token, { creation_id: containerId });
      if (!pub.id) throw new PublishError('발행 응답에 게시물 ID 가 없습니다.', true);

      let permalink: string | undefined;
      try {
        permalink = (await graphGet<{ permalink?: string }>(THREADS, pub.id, token, 'permalink')).permalink;
      } catch {
        /* 무시 */
      }
      return { remoteId: pub.id, permalink };
    });
  },
};
