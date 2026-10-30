import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairScores, separation, simulate } from '../extension/dev/metrics.js';

// 사람마다 방향이 다른 특징값 + 약간의 흔들림
const person = (label, axis, n) => Array.from({ length: n }, (_, i) => {
  const emb = Array(8).fill(0).map((_, k) => 0.05 * Math.sin(i * 7 + k * 3 + axis));
  emb[axis] = 1;
  return { label, name: `${i}.jpg`, emb };
});
const items = [0, 1, 2, 3, 4, 5].flatMap((a) => person(`p${a}`, a, 5));

test('쌍 점수를 같은 사람/다른 사람으로 나눈다', () => {
  const { gen, imp } = pairScores(items);
  assert.equal(gen.length, 6 * 10);
  assert.equal(imp.length, (30 * 29) / 2 - 60);
});

test('잘 갈리는 데이터는 겹침 0, EER 0', () => {
  const { gen, imp } = pairScores(items);
  const s = separation(gen, imp);
  assert.equal(s.overlap, 0);
  assert.equal(s.eer, 0);
  assert.equal(s.tar01, 1);
  assert.ok(s.minGen > s.maxImp);
});

test('판정 시뮬레이션: 잘 갈리면 모두 맞고 잘못 찾음 0', () => {
  const r = simulate(items, { nRefs: 2, strictness: 0.5 });
  assert.equal(r.targets, 6);
  assert.equal(r.hit + r.maybe + r.miss, 6 * 3);
  assert.equal(r.wrong, 0);
});
