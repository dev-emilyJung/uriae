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

/** 이보다 작은 얼굴(px)은 특징값이 흔들려서 "우리 아이"로 확정하지 않고 "확인 필요"로 둔다 */
export const SURE_MIN_PX = 48;
/** 얼굴 윤곽 확신도가 이보다 낮으면(손·옆모습·가려진 얼굴 등) "우리 아이"로 확정하지 않는다 */
export const SURE_MIN_SCORE = 0.8;

/**
 * 1차 판정에서 아주 확실한 얼굴을 기준 얼굴로 추가 (같은 시기의 우리 아이 얼굴이라 다음 판정에 가장 도움이 된다).
 * 다른 아이가 섞이면 그 아이 사진이 줄줄이 따라 들어오므로, 기준선보다 margin 이상 높고
 * 충분히 큰 얼굴만, 점수 높은 순으로 max개까지.
 * cands: [{emb, date, z, raw, size}]
 */
export function pickAutoRefs(cands, th, { margin = 1, max = 30 } = {}) {
  return cands
    .filter((c) => c.z >= th.sure + margin && c.raw >= th.rawSure + 0.1 && c.size >= SURE_MIN_PX * 1.5)
    .sort((a, b) => b.z - a.z)
    .slice(0, max)
    .map((c) => ({ emb: c.emb, date: c.date, auto: true }));
}

/** 시기마다 권장하는 기준 얼굴 수. 최소 2개면 찾을 수 있고, 5개면 각도·표정이 섞여 단체사진에서도 잘 찾는다 */
export const REF_MIN = 2;
export const REF_GOAL = 5;

/**
 * sinceYMD ~ untilYMD 사진을 찾을 때 기준 얼굴이 부족한 시기.
 * 시기 가운데 날짜에서 ±6개월 안의 기준 얼굴이 REF_MIN개보다 적으면 그 시기 사진은 잘 못 찾는다.
 */
export function missingPeriods(periods, refs, sinceYMD, untilYMD = '9999-12-31') {
  return periods.filter((p) => {
    if (p.end < sinceYMD || p.start > untilYMD) return false;
    const mid = (Date.parse(p.start) + Date.parse(p.end)) / 2;
    return refs.filter((r) => r.date && Math.abs(Date.parse(r.date) - mid) <= 183 * DAY).length < REF_MIN;
  });
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

/**
 * 사진 찾기 기간 목록: 최근 2주~1년, 그다음 예전 1년 단위 (한 번에 최대 1년치만 찾는다).
 * periods: agePeriods 또는 recentPeriods 결과 (최근부터, 6개월 단위). 생년월일이 있으면 만 나이 1년 단위로 묶는다.
 * → [{ since, until, label }]
 */
export function searchRanges(todayYMD, periods, hasBirth) {
  const back = (days) => new Date(Date.parse(todayYMD) - days * DAY).toISOString().slice(0, 10);
  const out = [[14, '최근 2주'], [30, '최근 1개월'], [90, '최근 3개월'], [180, '최근 6개월'], [365, '최근 1년']]
    .map(([d, label]) => ({ since: back(d), until: todayYMD, label }));
  const years = new Map();
  periods.forEach((p, i) => {
    const key = hasBirth ? p.label.replace(/ (전반|후반)$/, '') : `${Math.floor(i / 2)}~${Math.floor(i / 2) + 1}년 전`;
    const y = years.get(key);
    if (y) { y.since = p.start < y.since ? p.start : y.since; y.until = p.end > y.until ? p.end : y.until; }
    else years.set(key, { since: p.start, until: p.end, label: key });
  });
  // 생년월일을 모를 때 맨 앞 1년은 "최근 1년"과 같으므로 뺀다
  const list = [...years.values()].filter((y) => hasBirth || !y.label.startsWith('0~'));
  for (const y of list) y.label += ` (${y.since.slice(0, 7).replace('-', '.')} ~ ${y.until.slice(0, 7).replace('-', '.')})`;
  return [...out, ...list];
}

/** 생년월일을 모를 때: 오늘부터 6개월씩 거슬러 올라간 기간 목록 (최근 기간부터) */
export function recentPeriods(todayYMD, maxYears = 3) {
  return Array.from({ length: maxYears * 2 }, (_, i) => {
    const end = new Date(todayYMD + 'T00:00:00Z');
    end.setUTCMonth(end.getUTCMonth() - 6 * i);
    if (i) end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(todayYMD + 'T00:00:00Z');
    start.setUTCMonth(start.getUTCMonth() - 6 * (i + 1));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      label: i ? `${6 * i}~${6 * i + 6}개월 전` : '최근 6개월',
    };
  });
}
