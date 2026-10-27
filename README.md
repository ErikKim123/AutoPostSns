# AutoPostSns — 여러 SNS 예약 게시

캘린더에서 글을 쓰고 Instagram · Facebook 페이지 · Threads · X · TikTok 에 예약 게시한다.
예약은 DB 에 저장되고 cron 이 시각에 맞춰 올리므로 브라우저를 꺼도 된다.

Metricool 의 예약 흐름(업로드 → 게시물 생성 → 캘린더 조회 → 휴지통 삭제)을 관찰한 결과와,
123Band 어드민에서 실제로 써 온 인스타 발행 엔진(`apps/admin/src/lib/instagram`)을 바탕으로 만들었다.

## 구조

| 구분 | 위치 | 설명 |
|------|------|------|
| 규칙·검사 | `src/lib/networks/rules.ts` | SNS별 글자수·미디어 개수·필수 미디어. 작성 창과 서버가 같은 함수를 쓴다 |
| 어댑터 | `src/lib/networks/*.ts` | SNS별 발행·계정 찾기. 새 SNS = 어댑터 + `RULES` 항목 + DB 체크 제약 |
| 엔진 | `src/lib/engine.ts` | 계정별 대상(post_targets)을 잠그고 발행, 재시도 3회, 멈춘 잠금 해제 |
| 저장소 | `src/lib/posts.ts`, `accounts.ts` | 게시물·계정 CRUD, 휴지통, 복제 |
| DB | `supabase/migrations/0001_autopost.sql` | `autopost` 스키마 |
| 화면 | `src/components/*` | 캘린더(주/월), 작성 창, 휴지통, 계정 연결 |

게시물 1건 = `posts` 1행 + 고른 계정 수만큼 `post_targets`. 계정마다 성공·실패·재시도가 따로 기록된다.
게시물 상태는 대상들의 결과로 계산한다(`src/lib/status.ts`): 전부 성공 `published` / 일부 `partial` / 전부 실패 `failed`.

## 처음 설정

1. **DB** — Supabase SQL Editor 에서 `supabase/migrations/0001_autopost.sql` 실행.
   울프·123Band 와 같은 프로젝트지만 `autopost` 스키마와 `autopost-media` 버킷만 만든다.
   Data API 노출 목록(`pgrst.db_schemas`)은 건드리지 않는다 — 앱이 `DATABASE_URL` 로 직접 접속한다.
2. **회원 등록** — 파일 끝의 주석대로 내 이메일로 `autopost.members` 에 한 줄 넣는다.
3. **환경변수** — `.env.example` 을 `.env.local` 로 복사해 채운다.
4. **실행** — `pnpm install` 후 `pnpm dev` → http://localhost:3020
5. **계정 연결** — 화면의 "계정 연결"에서 SNS 를 고르고 토큰을 붙여 넣는다(필요 권한은 화면에 표시).

## 예약 발행(cron)

`GET /api/cron/publish` 가 예약 시각이 지난 대상을 발행한다. `CRON_SECRET` 으로 보호한다.

- `vercel.json` 에 5분 간격으로 걸어 두었다. **Vercel Hobby 플랜은 cron 을 하루 1회만 허용**하므로 Pro 가 필요하다.
- Hobby 라면 Supabase `pg_cron` + `pg_net` 으로 같은 URL 을 5분마다 호출하면 된다:
  ```sql
  select cron.schedule('autopost-publish', '*/5 * * * *', $$
    select net.http_get('https://<배포 주소>/api/cron/publish', headers => jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'))
  $$);
  ```

## SNS별 상태

| SNS | 근거 | 지원 | 확인 상태 |
|-----|------|------|-----------|
| Instagram | 123Band 엔진 이식 | 이미지·릴스·캐러셀(10) | 단일 이미지·릴스 흐름은 123Band 에서 운영 중. 캐러셀은 미검증 |
| Facebook 페이지 | Graph API 문서 | 글·사진(여러 장)·동영상 | 실제 페이지로 미검증 |
| Threads | Threads API 문서 | 글·이미지·동영상·캐러셀(20) | 실제 계정으로 미검증 |
| X | API v2 문서 | 글·이미지(4) | 미검증. 동영상(분할 업로드) 미지원 |
| TikTok | Content Posting API 문서 | 동영상 1개 | 미검증. 심사 전 앱은 "나만 보기"만 가능 |

미검증 SNS 는 처음 연결한 뒤 날짜를 먼 미래로 둔 테스트 예약을 만들고 "지금 게시"로 한 번 확인할 것.

## 테스트

```bash
pnpm test        # 규칙·상태·날짜 계산 (node --test)
pnpm typecheck
```

## 알려진 한계

- 계정 연결은 토큰 붙여 넣기 방식이다. SNS별 OAuth 로그인 버튼은 아직 없다.
- 인스타·스레드 장기 토큰(60일) 자동 연장 cron 이 아직 없다. 계정 화면에 만료일이 보이니 그 전에 다시 연결할 것.
- 휴지통에서 영구 삭제해도 스토리지의 미디어 파일은 남는다.
- 반복 예약·검토 요청·게시물 라이브러리(Metricool 의 나머지 저장 방식)는 없다.
