// SNS별 게시 규칙 + 작성 내용 검사 — 브라우저(작성 창)와 서버(저장 API)가 같은 함수를 쓴다.
// 순수 함수만 둔다(외부 호출·환경변수 없음). 테스트: tests/rules.test.ts

export const NETWORKS = ['instagram', 'facebook', 'threads', 'x', 'tiktok'] as const;
export type Network = (typeof NETWORKS)[number];

export type MediaKind = 'image' | 'video';

export interface MediaItem {
  url: string;
  kind: MediaKind;
}

export interface NetworkRules {
  label: string;
  /** 본문 최대 길이. X 는 가중치 글자수(한글·이모지 2, URL 23). */
  maxChars: number;
  maxMedia: number;
  /** 이미지나 동영상이 1개 이상 있어야 게시 가능. */
  requiresMedia: boolean;
  /** 이미지와 동영상을 한 게시물에 섞을 수 있는지(인스타·스레드 캐러셀만 가능). */
  allowsMixedMedia: boolean;
  /** 동영상은 1개만(여러 장은 이미지만). */
  singleVideo: boolean;
  maxHashtags?: number;
}

export const RULES: Record<Network, NetworkRules> = {
  instagram: { label: 'Instagram', maxChars: 2200, maxMedia: 10, requiresMedia: true, allowsMixedMedia: true, singleVideo: false, maxHashtags: 30 },
  facebook: { label: 'Facebook', maxChars: 63206, maxMedia: 10, requiresMedia: false, allowsMixedMedia: false, singleVideo: true },
  threads: { label: 'Threads', maxChars: 500, maxMedia: 20, requiresMedia: false, allowsMixedMedia: true, singleVideo: false },
  x: { label: 'X', maxChars: 280, maxMedia: 4, requiresMedia: false, allowsMixedMedia: false, singleVideo: true },
  tiktok: { label: 'TikTok', maxChars: 2200, maxMedia: 1, requiresMedia: true, allowsMixedMedia: false, singleVideo: true },
};

export function isNetwork(v: unknown): v is Network {
  return typeof v === 'string' && (NETWORKS as readonly string[]).includes(v);
}

/** 사람이 보는 글자 수(코드포인트 기준 — 이모지 1개 = 1). */
export function charCount(text: string): number {
  return [...text].length;
}

const URL_RE = /https?:\/\/[^\s]+/g;

// twitter-text v3 설정: 이 범위의 코드포인트는 1, 나머지(한글·한자·이모지 등)는 2. URL 은 길이와 무관하게 23.
const X_LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

/** X 가중치 글자수 — 한글 140자면 280 으로 꽉 찬다. */
export function xWeightedLength(text: string): number {
  let total = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    total += 23;
    return '';
  });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0)!;
    total += X_LIGHT_RANGES.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
  }
  return total;
}

/** 네트워크 기준 본문 길이(작성 창 카운터와 검사가 같은 값을 쓴다). */
export function lengthFor(network: Network, text: string): number {
  return network === 'x' ? xWeightedLength(text) : charCount(text);
}

export function hashtagCount(text: string): number {
  return (text.match(/(^|\s)#[^\s#]+/g) ?? []).length;
}

export interface PostDraft {
  text: string;
  media: MediaItem[];
}

/** 한 네트워크 기준 오류 목록. 빈 배열이면 게시 가능. */
export function validateFor(network: Network, post: PostDraft): string[] {
  const r = RULES[network];
  const errors: string[] = [];
  const text = post.text.trim();
  const images = post.media.filter((m) => m.kind === 'image').length;
  const videos = post.media.filter((m) => m.kind === 'video').length;

  if (!text && post.media.length === 0) errors.push('본문이나 미디어를 입력하세요.');
  if (r.requiresMedia && post.media.length === 0) errors.push('이미지나 동영상이 1개 이상 필요합니다.');

  const len = lengthFor(network, post.text);
  if (len > r.maxChars) errors.push(`본문이 ${len - r.maxChars}자 깁니다 (최대 ${r.maxChars}${network === 'x' ? ', 한글은 2자로 셈' : ''}).`);

  if (r.maxHashtags !== undefined) {
    const tags = hashtagCount(post.text);
    if (tags > r.maxHashtags) errors.push(`해시태그는 ${r.maxHashtags}개까지입니다 (현재 ${tags}개).`);
  }

  if (post.media.length > r.maxMedia) errors.push(`미디어는 ${r.maxMedia}개까지입니다 (현재 ${post.media.length}개).`);
  if (!r.allowsMixedMedia && images > 0 && videos > 0) errors.push('이미지와 동영상을 한 게시물에 섞을 수 없습니다.');
  if (r.singleVideo && videos > 1) errors.push('동영상은 1개만 올릴 수 있습니다.');
  if (network === 'tiktok' && images > 0) errors.push('TikTok 은 지금 동영상만 지원합니다.');
  // 인스타 Graph API 는 JPEG 이미지만 받는다(PNG·WEBP 는 업로드할 때 JPEG 로 바뀐다 — GIF 만 남는다).
  if (network === 'instagram' && post.media.some((m) => m.kind === 'image' && !/\.jpe?g(\?|$)/i.test(m.url))) {
    errors.push('인스타그램은 JPEG 이미지만 올릴 수 있습니다(GIF 불가).');
  }

  return errors;
}

/** 여러 네트워크 동시 검사. 오류가 있는 네트워크만 담는다. */
export function validateAll(networks: Network[], post: PostDraft): Partial<Record<Network, string[]>> {
  const out: Partial<Record<Network, string[]>> = {};
  for (const n of new Set(networks)) {
    const errs = validateFor(n, post);
    if (errs.length) out[n] = errs;
  }
  return out;
}

/** 예약 시각을 분 단위로 자른다(초 단위 예약은 의미가 없고, cron 도 분 단위로 돈다). */
export function truncateToMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('예약 시각 형식이 올바르지 않습니다.');
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}
