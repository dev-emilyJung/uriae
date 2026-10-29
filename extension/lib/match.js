// 얼굴 비교와 판정 로직 (순수 함수, 테스트 가능)
//
// 판정 원칙
// 1) 사진 날짜와 가까운 시기의 기준 얼굴로 비교한다 (아이 얼굴은 금방 바뀌므로)
// 2) 고정 기준값 대신, 이번에 확인한 반 사진 속 모든 얼굴의 점수 분포를 보고
//    "다른 아이들보다 확실히 튀게 높은" 얼굴만 우리 아이로 본다

const DAY = 86400000;

export function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

/** 사진 날짜에 맞는 기준 얼굴 고르기: ±9개월 안의 기준이 2개 이상이면 그것만, 아니면 가까운 순 4개 */
export function refsFor(dateYMD, refs, windowDays = 270) {
  const dated = refs.filter((r) => r.date);
  if (!dateYMD || dated.length < 2) return refs;
  const t = Date.parse(dateYMD);
  const dist = (r) => Math.abs(Date.parse(r.date) - t) / DAY;
  const near = dated.filter((r) => dist(r) <= windowDays);
  if (near.length >= 2) return near;
  return [...dated].sort((a, b) => dist(a) - dist(b)).slice(0, 4);
}

/** 얼굴 하나의 점수 = 가장 닮은 기준 얼굴과의 유사도 */
export function faceScore(emb, refs) {
  let best = 0;
  for (const r of refs) best = Math.max(best, cosine(emb, r.emb));
  return best;
}

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * 기준선 정하기.
 * 아이 얼굴은 모델이 서로 비슷하게 보는 편이라 "점수가 튀는 정도"가 잘 안 나온다.
 * 대신 반 아이가 보통 15~20명이므로 한 아이는 전체 얼굴의 약 5%라는 점을 이용해
 * 점수 상위 일부만 "우리 아이", 그다음 구간을 "확인 필요"로 둔다.
 * strictness: 0(많이 찾기, 상위 6%) ~ 1(정확하게, 상위 1.5%)
 */
export function thresholds(allFaceScores, strictness = 0.5) {
  const s = [...allFaceScores].sort((a, b) => a - b);
  const median = quantile(s, 0.5);
  const mad = quantile([...s.map((x) => Math.abs(x - median))].sort((a, b) => a - b), 0.5) * 1.4826 || 0.05;
  const top = 0.06 - strictness * 0.045;
  const sure = Math.max(quantile(s, 1 - top), median + 1.5 * mad, 0.5);
  const maybe = Math.max(quantile(s, 1 - top * 2.5), median + 0.8 * mad, 0.45);
  return { median, mad, sure, maybe: Math.min(maybe, sure), top, n: s.length };
}

/**
 * 얼굴 크기별로 나눠서 기준선을 정한다. 단체사진 속 작은 얼굴은 특징값이 흐려서 점수가 전반적으로 낮으므로,
 * 큰 얼굴(독사진) 분포가 아니라 다른 작은 얼굴들과 비교해야 한다.
 * faces: [{score, size}] → { small, large, cut } (size < cut 이면 small 기준)
 */
export function thresholdsBySize(faces, strictness = 0.5, cut = 90) {
  const small = faces.filter((f) => f.size < cut).map((f) => f.score);
  const large = faces.filter((f) => f.size >= cut).map((f) => f.score);
  const all = thresholds(faces.map((f) => f.score), strictness);
  return {
    cut,
    all,
    small: small.length >= 60 ? thresholds(small, strictness) : all,
    large: large.length >= 60 ? thresholds(large, strictness) : all,
  };
}

/** 기준 얼굴끼리의 유사도 (자기 자신 제외 최댓값). 같은 아이 얼굴이 보통 몇 점인지 보는 진단용 */
export function refAgreement(refs) {
  if (refs.length < 2) return null;
  const v = refs.map((r, i) => Math.max(...refs.filter((_, j) => j !== i).map((o) => cosine(r.emb, o.emb)))).sort((a, b) => a - b);
  return { min: v[0], median: quantile(v, 0.5) };
}

/**
 * 같은 날 사진끼리 연결: 확실한 우리 아이 얼굴과 같은 날(±2일) 찍힌 얼굴 중
 * 아주 닮은 얼굴(link 이상)을 우리 아이로 추가한다. 늘어난 얼굴로 한 번 더 반복.
 * faces: [{key, date, emb, score}]  sureKeys: Set  → 추가된 key Set
 */
export function propagate(faces, sureKeys, { link, floor, days = 2, rounds = 2 }) {
  const DAYMS = 86400000;
  const added = new Set();
  let frontier = faces.filter((f) => sureKeys.has(f.key));
  for (let r = 0; r < rounds && frontier.length; r++) {
    const next = [];
    for (const f of faces) {
      if (sureKeys.has(f.key) || added.has(f.key) || f.score < floor) continue;
      const t = Date.parse(f.date);
      for (const g of frontier) {
        if (Math.abs(Date.parse(g.date) - t) > days * DAYMS) continue;
        if (cosine(f.emb, g.emb) >= link) {
          added.add(f.key);
          next.push(f);
          break;
        }
      }
    }
    frontier = next;
  }
  return added;
}

/** 서로 다른 얼굴 쌍의 유사도 분포에서 "아주 닮음" 기준 (무작위 쌍 대부분은 다른 아이) */
export function linkThreshold(faces, samples = 4000) {
  if (faces.length < 20) return 0.95;
  const sims = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < samples; i++) {
    const a = faces[Math.floor(rnd() * faces.length)], b = faces[Math.floor(rnd() * faces.length)];
    if (a === b) continue;
    sims.push(cosine(a.emb, b.emb));
  }
  sims.sort((x, y) => x - y);
  return Math.max(quantile(sims, 0.995), 0.6);
}

/** 생년월일 기준 6개월 단위 기간 목록 (최근 maxYears 년) */
export function agePeriods(birthYMD, todayYMD, maxYears = 3) {
  const out = [];
  const birth = new Date(birthYMD + 'T00:00:00Z');
  const today = new Date(todayYMD + 'T00:00:00Z');
  const earliest = new Date(today);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - maxYears);
  for (let m = 0; m < 12 * 20; m += 6) {
    const start = new Date(birth);
    start.setUTCMonth(start.getUTCMonth() + m);
    const end = new Date(birth);
    end.setUTCMonth(end.getUTCMonth() + m + 6);
    end.setUTCDate(end.getUTCDate() - 1);
    if (start > today) break;
    if (end < earliest) continue;
    const years = Math.floor(m / 12);
    out.push({
      start: start.toISOString().slice(0, 10),
      end: (end > today ? today : end).toISOString().slice(0, 10),
      label: `만 ${years}세 ${m % 12 === 0 ? '전반' : '후반'}`,
    });
  }
  return out.reverse(); // 최근 기간부터
}
