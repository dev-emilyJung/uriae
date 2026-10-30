// 모의 반 앨범으로 사진 판정 비교 (기존 1.0.1 방식 vs 지금 방식).
// 실제 얼굴 특징값 대신, 아이마다 중심이 있고 사진마다 흔들리는 벡터로 반 앨범을 흉내 낸다:
// 같은 아이 유사도 ≈ 0.3~0.6, 다른 아이 ≈ 0, 닮은 친구는 우리 아이와 중심이 가깝다. 단체사진·흐린 얼굴 포함.
// 실제 성능 측정은 dev/eval.html 의 Y/N 기록으로 하고, 이 테스트는 방향(오인이 줄고 놓침이 늘지 않는지)을 지킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPhotos } from '../extension/lib/match.js';
import { album } from './face-sim-album.mjs';

function measure(photos, res) {
  let sure = 0, sureOurs = 0, ours = 0, found = 0, foundAny = 0;
  for (const p of photos) {
    const r = res.get(p.id);
    const has = p.faces.some((f) => f.kid === 0);
    if (has) ours++;
    if (r.level === 3) {
      sure++;
      if (p.faces[r.faceIdx]?.kid === 0) sureOurs++;
    }
    if (has && r.level === 3 && p.faces[r.faceIdx]?.kid === 0) found++;
    if (has && r.level >= 1) foundAny++;
  }
  return { sure, wrong: sure - sureOurs, wrongRate: sure ? (sure - sureOurs) / sure : 0, ours, found, foundAny };
}

test('모의 반 앨범: 지금 방식은 잘못 찾음이 기존의 절반 이하이고, 확인 필요까지 포함해 우리 아이를 놓치지 않는다', () => {
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const sum = { old: { wrong: 0, sure: 0, found: 0, any: 0, ours: 0 }, now: { wrong: 0, sure: 0, found: 0, any: 0, ours: 0 } };
  for (const seed of [1, 2, 3, 4, 5]) {
    const a = album(seed);
    const clone = () => a.photos.map((p) => ({ ...p, faces: p.faces.map((f) => ({ ...f })) }));
    const oldR = measure(a.photos, classifyPhotos(clone(), a.refs, { legacy: true }));
    const nowP = clone();
    const nowR = measure(a.photos, classifyPhotos(nowP, a.refs, { trusted: a.trusted }));
    for (const [k, r] of [['old', oldR], ['now', nowR]]) {
      sum[k].wrong += r.wrong; sum[k].sure += r.sure; sum[k].found += r.found; sum[k].any += r.foundAny; sum[k].ours += r.ours;
    }
  }
  for (const [k, s] of Object.entries(sum)) {
    console.log(`[모의 앨범 ${k === 'old' ? '기존' : '지금'}] 우리 아이로 찾음 ${s.sure}장 중 잘못 찾음 ${s.wrong}장(${pct(s.wrong / s.sure)}) · 우리 아이 사진 ${s.ours}장 중 바로 찾음 ${s.found}장(${pct(s.found / s.ours)}) · 확인 필요까지 ${s.any}장(${pct(s.any / s.ours)})`);
  }
  assert.ok(sum.now.wrong / sum.now.sure < (sum.old.wrong / sum.old.sure) / 2, '잘못 찾는 비율이 절반 이하로 줄어야 한다');
  assert.ok(sum.now.any >= sum.old.any * 0.97, '확인 필요까지 포함해 우리 아이 사진을 놓치면 안 된다');
});

test('모의 반 앨범: 형제자매 기준 얼굴을 알면 그 아이를 우리 아이로 잘못 찾는 일이 줄어든다', () => {
  let without = 0, withSib = 0;
  for (const seed of [41, 42, 43]) {
    const a = album(seed);
    // 닮은 친구 1번을 형제자매로: 그 아이 사진에서 기준 얼굴 5개
    const sib = a.photos.flatMap((p) => p.faces.filter((f) => f.kid === 1)).slice(0, 5).map((f) => ({ emb: f.emb, date: '2026-10-01' }));
    for (const [others, add] of [[[], (n) => (without += n)], [sib, (n) => (withSib += n)]]) {
      const ps = a.photos.map((p) => ({ ...p, faces: p.faces.map((f) => ({ ...f })) }));
      const res = classifyPhotos(ps, a.refs, { trusted: a.trusted, others });
      add(ps.filter((p) => { const r = res.get(p.id); return r.level === 3 && p.faces[r.faceIdx].kid === 1; }).length);
    }
  }
  console.log(`[모의 앨범 형제자매] 형제자매를 우리 아이로 잘못 찾음: 기준 얼굴 모를 때 ${without}장 → 알 때 ${withSib}장`);
  assert.ok(withSib < without);
});
