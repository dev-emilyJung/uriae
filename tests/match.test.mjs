import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosine, refsFor, faceScore, decide, judge, cohortStats, agePeriods, pickAutoRefs, missingPeriods, searchRanges, recentPeriods } from '../extension/lib/match.js';

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


test('자동 기준 얼굴: 기준선보다 훨씬 확실하고 큰 얼굴만', () => {
  const th = decide(0.5); // sure 2
  const c = (z, raw, size) => ({ emb: [z], date: '2026-10-01', z, raw, size });
  const picked = pickAutoRefs([c(3.5, 0.6, 120), c(2.5, 0.6, 120), c(3.2, 0.35, 120), c(3.4, 0.6, 50), c(3.1, 0.5, 90)], th);
  assert.deepEqual(picked.map((p) => p.emb[0]), [3.5, 3.1]);
  assert.equal(pickAutoRefs(Array.from({ length: 50 }, () => c(4, 0.6, 100)), th).length, 30);
});

test('기준 얼굴이 부족한 시기: 고른 기간 안에서 ±6개월 안 기준이 2개 미만', () => {
  const periods = agePeriods('2022-01-10', '2026-10-30', 3);
  const refs = [{ date: '2026-09-01' }, { date: '2026-10-01' }];
  const miss = missingPeriods(periods, refs, '2025-10-30', '2026-10-30');
  assert.deepEqual(miss.map((p) => p.label), ['만 3세 후반']);
  // 최근 1개월만 찾으면 부족한 시기 없음
  assert.equal(missingPeriods(periods, refs, '2026-09-30', '2026-10-30').length, 0);
});

test('사진 찾기 기간: 최근 5개 + 만 나이 1년 단위 (최대 1년)', () => {
  const periods = agePeriods('2022-01-10', '2026-10-30', 3);
  const r = searchRanges('2026-10-30', periods, true);
  assert.equal(r[0].label, '최근 2주');
  assert.equal(r[4].since, '2025-10-30');
  assert.ok(r[5].label.startsWith('만 4세 ('));
  assert.equal(r[5].since, '2026-01-10');
  assert.equal(r[6].since, '2025-01-10');
  assert.equal(r[6].until, '2026-01-09');
  for (const x of r) assert.ok(Date.parse(x.until) - Date.parse(x.since) <= 366 * 86400000);
});

test('생년월일 모를 때: 6개월씩 거슬러 올라가고, 1년 단위 기간은 1~2년 전부터', () => {
  const p = recentPeriods('2026-10-30', 2);
  assert.deepEqual([p[0].start, p[0].end], ['2026-04-30', '2026-10-30']);
  assert.deepEqual([p[1].start, p[1].end], ['2025-10-30', '2026-04-29']);
  const r = searchRanges('2026-10-30', recentPeriods('2026-10-30', 3), false);
  assert.ok(r[5].label.startsWith('1~2년 전'));
  assert.equal(r.length, 7);
});
