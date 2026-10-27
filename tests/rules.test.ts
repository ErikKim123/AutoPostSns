// 실행: node --test apps/autopost/tests  (Node 22.6+ 의 TS 타입 제거로 그대로 돈다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFor,
  validateAll,
  xWeightedLength,
  lengthFor,
  hashtagCount,
  truncateToMinute,
} from '../src/lib/networks/rules.ts';

const img = { url: 'https://x/a.jpg', kind: 'image' as const };
const vid = { url: 'https://x/a.mp4', kind: 'video' as const };

test('인스타는 미디어 없이 게시 불가 — Metricool 의 "Add at least 1 image or video." 와 같은 규칙', () => {
  assert.deepEqual(validateFor('instagram', { text: '안녕', media: [] }), ['이미지나 동영상이 1개 이상 필요합니다.']);
  assert.deepEqual(validateFor('instagram', { text: '안녕', media: [img] }), []);
});

test('본문도 미디어도 없으면 모든 네트워크에서 오류', () => {
  for (const n of ['facebook', 'threads', 'x'] as const) {
    assert.ok(validateFor(n, { text: '   ', media: [] }).includes('본문이나 미디어를 입력하세요.'), n);
  }
});

test('X 가중치: 영문 1, 한글 2, URL 23', () => {
  assert.equal(xWeightedLength('abc'), 3);
  assert.equal(xWeightedLength('가나다'), 6);
  assert.equal(xWeightedLength('see https://example.com/very/long/path?x=1'), 4 + 23);
  assert.equal(lengthFor('x', '가'.repeat(140)), 280);
  assert.deepEqual(validateFor('x', { text: '가'.repeat(140), media: [] }), []);
  assert.equal(validateFor('x', { text: '가'.repeat(141), media: [] }).length, 1);
});

test('인스타 글자수는 이모지 1자로 센다', () => {
  assert.equal(lengthFor('instagram', '👍👍'), 2);
});

test('미디어 개수·혼합·동영상 규칙', () => {
  assert.ok(validateFor('x', { text: 'a', media: [img, img, img, img, img] }).some((e) => e.includes('4개까지')));
  assert.ok(validateFor('x', { text: 'a', media: [img, vid] }).some((e) => e.includes('섞을 수 없')));
  assert.deepEqual(validateFor('instagram', { text: 'a', media: [img, vid] }), []);
  assert.ok(validateFor('tiktok', { text: 'a', media: [img] }).some((e) => e.includes('동영상만')));
  assert.deepEqual(validateFor('tiktok', { text: 'a', media: [vid] }), []);
});

test('인스타는 JPEG 만 — GIF 는 막고 X 는 허용', () => {
  const gif = { url: 'https://x/a.gif', kind: 'image' as const };
  assert.ok(validateFor('instagram', { text: 'a', media: [gif] }).some((e) => e.includes('JPEG')));
  assert.deepEqual(validateFor('instagram', { text: 'a', media: [{ url: 'https://x/a.JPEG?v=1', kind: 'image' }] }), []);
  assert.deepEqual(validateFor('x', { text: 'a', media: [gif] }), []);
});

test('해시태그 30개 제한(인스타)', () => {
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
  assert.equal(hashtagCount(tags), 31);
  assert.ok(validateFor('instagram', { text: tags, media: [img] }).some((e) => e.includes('30개까지')));
});

test('validateAll 은 오류 있는 네트워크만 담는다', () => {
  const out = validateAll(['instagram', 'threads', 'instagram'], { text: '안녕', media: [] });
  assert.deepEqual(Object.keys(out), ['instagram']);
});

test('예약 시각은 분 단위로 자른다(Metricool 도 초를 버림)', () => {
  assert.equal(truncateToMinute('2026-10-30T12:57:16.123Z'), '2026-10-30T12:57:00.000Z');
  assert.throws(() => truncateToMinute('nope'));
});
