import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosine, refsFor, faceScore, decide, judge, cohortStats, agePeriods } from '../extension/lib/match.js';

test('cosine', () => {
  assert.equal(Math.round(cosine([1, 0], [1, 0]) * 100), 100);
  assert.equal(Math.round(cosine([1, 0], [0, 1]) * 100), 0);
});

test('사진 날짜와 가까운 기준 얼굴을 고른다', () => {
  const refs = [
    { id: 'a', date: '2024-01-10' }, { id: 'b', date: '2024-02-01' },
    { id: 'c', date: '2026-08-01' }, { id: 'd', date: '2026-09-15' },
  ];
  assert.deepEqual(refsFor('2026-10-01', refs).map((r) => r.id), ['c', 'd']);
  assert.deepEqual(refsFor('2024-03-01', refs).map((r) => r.id), ['a', 'b']);
  // 가까운 기준이 부족하면 가까운 순 4개
  assert.equal(refsFor('2025-06-01', refs).length, 4);
});

test('판정: 보정 점수 기준선과 "아니에요" 반영', () => {
  const th = decide(0.5);
  assert.equal(th.sure, 2);
  assert.ok(Math.abs(th.maybe - 1.4) < 1e-9);
  // 무리(다른 아이들)는 [0,1] 근처, 우리 아이 기준 얼굴은 [1,0]
  const cohort = Array.from({ length: 50 }, (_, i) => [0.1 * Math.sin(i), 1]);
  const ref = { emb: [1, 0] };
  ref.stat = cohortStats(ref.emb, cohort);
  const ours = [0.95, 0.1];
  const r1 = judge(ours, cohortStats(ours, cohort), [ref], [], th);
  assert.equal(r1.level, 3);
  // 같은 얼굴을 "아니에요"로 표시하면 제외
  const r2 = judge(ours, cohortStats(ours, cohort), [ref], [[0.95, 0.1]], th);
  assert.equal(r2.level, 0);
});

test('faceScore는 가장 닮은 기준 얼굴 점수', () => {
  const refs = [{ emb: [1, 0] }, { emb: [0.9, 0.1] }, { emb: [0, 1] }];
  assert.ok(faceScore([1, 0], refs) > 0.99);
});

test('생년월일 기준 6개월 기간', () => {
  const p = agePeriods('2020-12-20', '2026-10-29', 1);
  assert.equal(p[0].label, '만 5세 후반');
  assert.equal(p[0].start, '2026-06-20');
  assert.equal(p[0].end, '2026-10-29');
  assert.equal(p[1].label, '만 5세 전반');
});

