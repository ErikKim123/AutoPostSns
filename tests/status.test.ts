import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateStatus, editBlockReason, isOpen, MAX_ATTEMPTS } from '../src/lib/status.ts';

const t = (status: 'pending' | 'publishing' | 'published' | 'failed', attempts = 0) => ({ status, attempts });

test('전부 성공이면 published, 일부만이면 partial, 전부 실패(재시도 소진)면 failed', () => {
  assert.equal(aggregateStatus([t('published'), t('published')]), 'published');
  assert.equal(aggregateStatus([t('published'), t('failed', MAX_ATTEMPTS)]), 'partial');
  assert.equal(aggregateStatus([t('failed', MAX_ATTEMPTS), t('failed', MAX_ATTEMPTS)]), 'failed');
});

test('재시도가 남은 실패는 아직 대기열(scheduled)', () => {
  assert.equal(isOpen(t('failed', 1)), true);
  assert.equal(aggregateStatus([t('published'), t('failed', 1)]), 'scheduled');
});

test('하나라도 발행 중이면 publishing', () => {
  assert.equal(aggregateStatus([t('publishing'), t('published')]), 'publishing');
});

test('대상이 없으면 failed(계정이 지워진 게시물)', () => {
  assert.equal(aggregateStatus([]), 'failed');
});

test('게시된 계정이 있으면 수정 불가, 실패만 있으면 수정 가능', () => {
  assert.match(editBlockReason('partial', [t('published'), t('failed', 3)])!, /이미 게시된/);
  assert.match(editBlockReason('publishing', [t('publishing')])!, /진행 중/);
  assert.equal(editBlockReason('failed', [t('failed', 3)]), null);
  assert.equal(editBlockReason('scheduled', [t('pending')]), null);
});
