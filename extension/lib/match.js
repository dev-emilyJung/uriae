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

/** 얼굴 하나의 점수 = 가장 비슷한 기준 2개의 평균 (기준 하나가 우연히 닮은 경우를 줄임) */
export function faceScore(emb, refs) {
  const sims = refs.map((r) => cosine(emb, r.emb)).sort((a, b) => b - a);
  if (!sims.length) return 0;
  if (sims.length === 1) return sims[0];
  return (sims[0] + sims[1]) / 2;
}

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * 점수 분포로 기준선 정하기.
 * allFaceScores: 이번에 확인한 모든 얼굴의 점수 (대부분 다른 아이들)
 * strictness: 0(많이 찾기) ~ 1(정확하게)
 */
export function thresholds(allFaceScores, strictness = 0.5) {
  const s = [...allFaceScores].sort((a, b) => a - b);
  const median = quantile(s, 0.5);
  const mad = quantile([...s.map((x) => Math.abs(x - median))].sort((a, b) => a - b), 0.5) * 1.4826 || 0.05;
  // 공개 얼굴 데이터 기준: 다른 사람 점수의 중앙값 + 3σ 위면 오인율 약 0.1%, 같은 사람의 약 75%를 잡음
  const k = 2.5 + strictness * 1.5; // 2.5 ~ 4
  // 절대 하한: 다른 사람끼리도 이 정도는 나올 수 있는 값 아래로는 내려가지 않음
  const sure = Math.max(median + k * mad, 0.5);
  const maybe = Math.max(median + (k - 1) * mad, 0.42);
  return { median, mad, sure, maybe, n: s.length };
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
