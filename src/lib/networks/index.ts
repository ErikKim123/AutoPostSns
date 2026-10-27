// 네트워크 → 어댑터. 새 SNS 는 어댑터 파일 + rules.ts 의 RULES 항목 + DB 체크 제약을 추가하면 된다.
// ⚠️ 서버 전용(브라우저는 rules.ts 만 import).
import type { Network } from './rules';
import type { NetworkAdapter } from './adapter';
import { instagram } from './instagram';
import { facebook } from './facebook';
import { threads } from './threads';
import { x } from './x';
import { tiktok } from './tiktok';

export const ADAPTERS: Record<Network, NetworkAdapter> = { instagram, facebook, threads, x, tiktok };
