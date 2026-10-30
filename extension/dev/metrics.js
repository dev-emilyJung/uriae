// 얼굴 인식 정확도 측정 계산 (개발용, 순수 함수, 테스트 가능)
// items: [{ label: 사람 이름, emb: 특징값, name: 파일 이름 }]
import { cosine, classifyPhotos } from '../lib/match.js';

/** 모든 쌍의 유사도를 같은 사람(gen) / 다른 사람(imp)으로 나눠서 */
export function pairScores(items) {
  const gen = [], imp = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      (items[i].label === items[j].label ? gen : imp).push(cosine(items[i].emb, items[j].emb));
    }
  }
  return { gen, imp };
}

/** 정렬된 배열에서 t 이상인 개수 */
function countAtLeast(sorted, t) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] < t) lo = m + 1; else hi = m;
  }
  return sorted.length - lo;
}

/**
 * 점수 분리 정도 요약
 * minGen: 같은 사람 최저, maxImp: 다른 사람 최고, overlap: 다른 사람 최고보다 낮은 같은 사람 쌍 수
 * eer: 놓침 비율 = 오인 비율이 되는 지점, tar1/tar01: 오인 1%/0.1%로 맞췄을 때 같은 사람을 맞히는 비율
 */
export function separation(gen, imp) {
  const g = [...gen].sort((a, b) => a - b), m = [...imp].sort((a, b) => a - b);
  if (!g.length || !m.length) return null;
  const maxImp = m[m.length - 1];
  let eer = 1, eerTh = 0;
  for (let t = -1; t <= 1; t += 0.001) {
    const far = countAtLeast(m, t) / m.length, frr = 1 - countAtLeast(g, t) / g.length;
    const e = Math.max(far, frr);
    if (e < eer) { eer = e; eerTh = t; }
  }
  const tarAt = (far) => {
    const th = m[Math.min(m.length - 1, Math.floor(m.length * (1 - far)))];
    return countAtLeast(g, th + 1e-9) / g.length;
  };
  return {
    minGen: g[0], maxImp, overlap: g.length - countAtLeast(g, maxImp + 1e-9),
    eer, eerTh, tar1: tarAt(0.01), tar01: tarAt(0.001), nGen: g.length, nImp: m.length,
  };
}

/**
 * 앱과 같은 방식으로 판정해 보기 (앱의 classifyPhotos 를 그대로 쓴다: 작은 얼굴 낮추기, 자동 기준 얼굴 포함).
 * 사람마다 한 번씩 "우리 아이"로 정하고, 그 사람 사진 앞쪽 nRefs장을 기준 얼굴로,
 * 나머지 모든 사진을 반 앨범으로 보고 판정한다. 사진 한 장 = 얼굴 하나.
 * items: [{ label, name, emb, size, score }]
 */
export function simulate(items, { nRefs = 2, strictness = 0.5 } = {}) {
  const byLabel = new Map();
  for (const x of items) {
    if (!byLabel.has(x.label)) byLabel.set(x.label, []);
    byLabel.get(x.label).push(x);
  }
  const out = { targets: 0, hit: 0, maybe: 0, miss: 0, wrong: 0, wrongMaybe: 0, errors: [] };
  for (const [label, own] of byLabel) {
    if (own.length < nRefs + 1) continue;
    out.targets++;
    const refItems = new Set(own.slice(0, nRefs));
    const album = items.filter((x) => !refItems.has(x));
    // 얼굴 객체는 매번 새로 (classifyPhotos 가 무리 통계를 얼굴에 붙여 두므로 대상마다 섞이지 않게)
    const photos = album.map((x, i) => ({ id: i, faces: [{ emb: x.emb, size: x.size ?? 200, score: x.score ?? 1 }] }));
    const res = classifyPhotos(photos, [...refItems].map((r) => ({ emb: r.emb })), { strictness });
    album.forEach((x, i) => {
      const r = res.get(i);
      if (x.label === label) {
        if (r.level === 3) out.hit++;
        else {
          r.level === 1 ? out.maybe++ : out.miss++;
          out.errors.push({ kind: r.level === 1 ? '확인 필요로 빠짐' : '놓침', target: label, item: x, ref: own[0], z: r.z, raw: r.raw });
        }
      } else if (r.level === 3) {
        out.wrong++;
        out.errors.push({ kind: '다른 사람을 잘못 찾음', target: label, item: x, ref: own[0], z: r.z, raw: r.raw });
      } else if (r.level === 1) out.wrongMaybe++;
    });
  }
  // 잘못 찾음 먼저, 그다음 점수가 아슬아슬한 순
  out.errors.sort((a, b) => (a.kind === b.kind ? 0 : a.kind.startsWith('다른') ? -1 : 1) || b.z - a.z);
  return out;
}
