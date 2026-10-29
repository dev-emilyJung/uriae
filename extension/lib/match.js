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

/** 비교 대상 무리(코호트)에서 고르게 n개 뽑기 (대부분 다른 아이 얼굴) */
export function sampleCohort(embs, n = 300) {
  if (embs.length <= n) return embs;
  const step = embs.length / n;
  return Array.from({ length: n }, (_, i) => embs[Math.floor(i * step)]);
}

/** 얼굴 하나가 무리 전체와 평균적으로 얼마나 닮았는지 (평균, 표준편차) */
export function cohortStats(emb, cohort) {
  if (!cohort.length) return { mu: 0, sd: 1 };
  let sum = 0, sq = 0;
  for (const c of cohort) {
    const v = cosine(emb, c);
    sum += v;
    sq += v * v;
  }
  const mu = sum / cohort.length;
  return { mu, sd: Math.sqrt(Math.max(sq / cohort.length - mu * mu, 1e-6)) };
}

/**
 * 판정 기준. "누구와도 닮아 보이는 얼굴"(정면 독사진 등)이 높은 점수를 받는 문제를 막기 위해
 * 얼굴 점수를 그 얼굴과 기준 얼굴 각각이 반 친구들과 평균적으로 닮은 정도로 보정한 값(z)으로 판정한다.
 * 공개 얼굴 데이터: 같은 사람 z 최저 1.93, 다른 사람 z 최고 1.40.
 * strictness: 0(많이 찾기) ~ 1(정확하게) → 우리 아이 z 1.5~2.5, 확인 필요는 0.6 아래까지.
 * 보정 전 점수 하한(raw)도 함께 본다.
 */
export function decide(strictness = 0.5) {
  const sure = 1.5 + strictness;
  return { sure, maybe: sure - 0.6, rawSure: 0.3, rawMaybe: 0.22 };
}

/**
 * 얼굴 하나 판정.
 * refs: [{emb, stat}] (stat = cohortStats), faceStat: 이 얼굴의 cohortStats
 * neg: 사용자가 "아니에요"라고 한 얼굴들 (이번 세션에서만)
 * → { level: 3(우리 아이) | 1(확인 필요) | 0, z, raw }
 */
export function judge(emb, faceStat, refs, neg, th) {
  let raw = -1, best = null;
  for (const r of refs) {
    const v = cosine(emb, r.emb);
    if (v > raw) { raw = v; best = r; }
  }
  if (!best) return { level: 0, z: 0, raw: 0 };
  const z = ((raw - faceStat.mu) / faceStat.sd + (raw - best.stat.mu) / best.stat.sd) / 2;
  // "아니에요"라고 한 얼굴과 더 닮았으면 우리 아이가 아니다
  for (const n of neg) if (cosine(emb, n) >= raw) return { level: 0, z, raw };
  if (z >= th.sure && raw >= th.rawSure) return { level: 3, z, raw };
  if (z >= th.maybe && raw >= th.rawMaybe) return { level: 1, z, raw };
  return { level: 0, z, raw };
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
