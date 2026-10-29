import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosine, refsFor, faceScore, thresholds, agePeriods } from '../extension/lib/match.js';

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

test('다른 아이들 사이에서 튀게 높은 점수만 통과', () => {
  // 다른 얼굴 300개(평균 0.45 근처) + 우리 아이 15개(0.7 근처)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const others = Array.from({ length: 300 }, () => 0.45 + (rnd() - 0.5) * 0.16);
  const ours = Array.from({ length: 15 }, () => 0.7 + (rnd() - 0.5) * 0.1);
  const th = thresholds([...others, ...ours], 0.5);
  assert.ok(others.filter((x) => x >= th.sure).length === 0, '다른 아이가 섞이면 안 됨');
  assert.ok(ours.filter((x) => x >= th.sure).length >= 12, '우리 아이 대부분은 잡혀야 함');
});

test('faceScore는 가장 비슷한 2개 평균', () => {
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

test('같은 날 사진 연결: 확실한 얼굴과 아주 닮은 같은 날 얼굴을 추가', async () => {
  const { propagate } = await import('../extension/lib/match.js');
  const faces = [
    { key: 'a', date: '2026-10-20', emb: [1, 0, 0], score: 0.9 },
    { key: 'b', date: '2026-10-20', emb: [0.98, 0.05, 0], score: 0.7 }, // 같은 날, 아주 닮음 → 추가
    { key: 'c', date: '2026-10-10', emb: [0.98, 0.05, 0], score: 0.7 }, // 날짜가 멀어 제외
    { key: 'd', date: '2026-10-20', emb: [0, 1, 0], score: 0.7 }, // 안 닮음 → 제외
  ];
  const added = propagate(faces, new Set(['a']), { link: 0.95, floor: 0.5 });
  assert.deepEqual([...added], ['b']);
});
