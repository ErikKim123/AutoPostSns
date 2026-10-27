// Instagram — Graph API(비즈니스·크리에이터 계정). 123Band 어드민의 검증된 발행 흐름을 계정 단위로 옮긴 것.
// 흐름: 미디어 컨테이너 생성 → 처리 완료 대기 → media_publish → permalink.
// 여러 장이면 캐러셀: 항목별 컨테이너(is_carousel_item) → CAROUSEL 컨테이너 → 발행.
// ⚠️ 서버 전용.
import type { MediaItem } from './rules';
import { PublishError, runPublish, type NetworkAdapter } from './adapter';
import { GRAPH, exchangeFacebookToken, graphGet, graphPost, waitForContainer } from './meta';

async function createItem(igId: string, token: string, m: MediaItem, carouselItem: boolean, caption?: string): Promise<string> {
  const params: Record<string, unknown> =
    m.kind === 'video'
      ? { media_type: carouselItem ? 'VIDEO' : 'REELS', video_url: m.url }
      : { image_url: m.url };
  if (carouselItem) params.is_carousel_item = true;
  else params.caption = caption ?? '';
  const { id } = await graphPost<{ id?: string }>(GRAPH, `${igId}/media`, token, params);
  if (!id) throw new PublishError('미디어 컨테이너를 만들지 못했습니다(URL/형식 확인).', false);
  return id;
}

export const instagram: NetworkAdapter = {
  network: 'instagram',

  async discover({ accessToken }) {
    const long = await exchangeFacebookToken(accessToken);
    const j = await graphGet<{ data?: { instagram_business_account?: { id: string; username?: string } }[] }>(
      GRAPH,
      'me/accounts',
      long.token,
      'name,instagram_business_account{id,username}',
    );
    const found = (j.data ?? []).map((p) => p.instagram_business_account).filter((x): x is { id: string; username?: string } => Boolean(x?.id));
    if (found.length === 0) {
      throw new PublishError('IG 비즈니스 계정을 찾지 못했습니다. 인스타그램을 비즈니스/크리에이터로 전환하고 Facebook 페이지에 연결했는지 확인하세요.', false);
    }
    return found.map((ig) => ({
      externalId: ig.id,
      handle: ig.username ?? ig.id,
      credentials: { accessToken: long.token },
      tokenExpiresAt: long.expiresAt,
    }));
  },

  publish(account, input) {
    return runPublish(async () => {
      const token = account.credentials.accessToken;
      const igId = account.externalId;
      if (input.media.length === 0) throw new PublishError('인스타그램은 이미지나 동영상이 필요합니다.', false);

      let containerId: string;
      if (input.media.length === 1) {
        const m = input.media[0]!;
        containerId = await createItem(igId, token, m, false, input.text);
        await waitForContainer(GRAPH, containerId, token, m.kind === 'video');
      } else {
        const children: string[] = [];
        for (const m of input.media) {
          const id = await createItem(igId, token, m, true);
          await waitForContainer(GRAPH, id, token, m.kind === 'video');
          children.push(id);
        }
        const parent = await graphPost<{ id?: string }>(GRAPH, `${igId}/media`, token, {
          media_type: 'CAROUSEL',
          children: children.join(','),
          caption: input.text,
        });
        if (!parent.id) throw new PublishError('캐러셀 컨테이너를 만들지 못했습니다.', false);
        containerId = parent.id;
        await waitForContainer(GRAPH, containerId, token, false);
      }

      const pub = await graphPost<{ id?: string }>(GRAPH, `${igId}/media_publish`, token, { creation_id: containerId });
      if (!pub.id) throw new PublishError('발행 응답에 게시물 ID 가 없습니다.', true);

      // permalink 회수 실패는 무시(게시는 이미 성공).
      let permalink: string | undefined;
      try {
        permalink = (await graphGet<{ permalink?: string }>(GRAPH, pub.id, token, 'permalink')).permalink;
      } catch {
        /* 무시 */
      }
      return { remoteId: pub.id, permalink };
    });
  },
};
