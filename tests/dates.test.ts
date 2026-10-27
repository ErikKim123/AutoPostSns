import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPublishAt, fromLocalInput, monthGrid, rangeLabel, startOfWeek, toLocalInput, visibleRange } from '../src/lib/client/dates.ts';

test('주는 월요일 0시에 시작', () => {
  const s = startOfWeek(new Date(2026, 9, 21, 15, 30)); // 2026-10-21 수
  assert.equal(s.getDay(), 1);
  assert.equal(s.getDate(), 19);
  assert.equal(s.getHours(), 0);
  assert.equal(startOfWeek(new Date(2026, 9, 25)).getDate(), 19); // 일요일은 그 주 월요일로
});

test('월 격자는 42칸, 1일이 첫 주에 들어 있다', () => {
  const g = monthGrid(new Date(2026, 9, 15));
  assert.equal(g.length, 42);
  assert.equal(g[0]!.getDay(), 1);
  assert.ok(g.slice(0, 7).some((d) => d.getMonth() === 9 && d.getDate() === 1));
});

test('주 보기 기간은 7일, 끝은 다음 주 월요일(미포함)', () => {
  const { from, to, days } = visibleRange('week', new Date(2026, 9, 21));
  assert.equal(days.length, 7);
  assert.equal((to.getTime() - from.getTime()) / 86_400_000, 7);
});

test('datetime-local 왕복', () => {
  const iso = new Date(2026, 9, 30, 21, 57).toISOString();
  assert.equal(toLocalInput(iso), '2026-10-30T21:57');
  assert.equal(fromLocalInput('2026-10-30T21:57'), iso);
  assert.equal(fromLocalInput(''), null);
});

test('새 게시물 기본 시각: 다른 날은 10:00, 오늘은 다음 정시, 늦은 밤이면 내일 10:00', () => {
  const now = new Date(2026, 9, 21, 14, 20);
  assert.equal(defaultPublishAt(new Date(2026, 9, 23), now).getHours(), 10);
  assert.equal(defaultPublishAt(new Date(2026, 9, 21), now).getHours(), 15);
  const late = defaultPublishAt(new Date(2026, 9, 21), new Date(2026, 9, 21, 22, 40));
  assert.equal(late.getDate(), 22);
  assert.equal(late.getHours(), 10);
});

test('기간 표시', () => {
  assert.equal(rangeLabel('week', new Date(2026, 9, 21)), '2026년 10월 19일 – 25일');
  assert.equal(rangeLabel('week', new Date(2026, 9, 28)), '2026년 10월 26일 – 11월 1일');
  assert.equal(rangeLabel('month', new Date(2026, 9, 21)), '2026년 10월');
});
