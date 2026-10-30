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
/** 형제자매 기준 얼굴과의 유사도가 우리 아이와 이만큼 안쪽이면 "확인 필요" */
export const SIBLING_MARGIN = 0.05;
/** 자동 기준 얼굴을 가져올 수 있는 사진의 최대 얼굴 수 */
export const AUTO_MAX_FACES = 3;

/**
 * 1차 판정에서 아주 확실한 얼굴을 기준 얼굴로 추가 (같은 시기의 우리 아이 얼굴이라 다음 판정에 가장 도움이 된다).
 * 다른 아이가 섞이면 그 아이 사진이 줄줄이 따라 들어오므로, 기준선보다 margin 이상 높고
 * 충분히 큰 얼굴만, 점수 높은 순으로 max개까지.
 * cands: [{emb, date, z, raw, size}]
 */
export function pickAutoRefs(cands, th, { margin = 1, max = 30, maxFaces = Infinity } = {}) {
  return cands
    .filter((c) => c.z >= th.sure + margin && c.raw >= th.rawSure + 0.1 && c.size >= SURE_MIN_PX * 1.5 && (c.faces ?? 1) <= maxFaces)
    .sort((a, b) => b.z - a.z)
    .slice(0, max)
    .map((c) => ({ emb: c.emb, date: c.date, auto: true }));
}

/**
 * 한 아이의 사진들 판정 (앱과 측정 도구가 같은 코드를 쓴다).
 * photos: [{ id, date, faces: [{ emb, size, score }] }]  비교 무리(코호트)도 이 사진들의 얼굴에서 뽑는다
 * refs: 등록한 기준 얼굴 [{ emb, date }]
 * pos: 사용자가 "이 얼굴이 우리 아이"라고 확인한 얼굴 [{ emb, date }], neg: "아니에요"라고 한 얼굴 특징값들
 * forced: 사용자가 직접 고친 사진 Map(id → 3 | 0)
 * trusted: 선생님이 이 아이에게 보낸 알림장 사진 [{ id, date, faces }]. 얼굴이 하나뿐인 사진은 거의 이 아이라서
 *   기준 얼굴과 대체로 맞으면 그 시기의 기준 얼굴로 더한다
 * others: 같은 계정의 다른 아이(형제자매) 기준 얼굴 [{ emb, date }]. 가장 닮은 아이라 그 아이와 더 닮은 얼굴은 우리 아이가 아니다
 * legacy: 1.0.1 까지의 판정 (알림장 기준 얼굴·형제자매 비교·자동 기준 얼굴 제한·이웃 비교 없음). 개발용 비교에만 쓴다
 * → Map(id → { level, z, raw, faceIdx, first, near })
 */
export function classifyPhotos(photos, refs, { pos = [], neg = [], forced = new Map(), strictness = 0.5, trusted = [], others = [], legacy = false } = {}) {
  const th = decide(strictness);
  const cohort = sampleCohort(photos.flatMap((p) => p.faces.map((f) => f.emb)), 300);
  // 얼굴별 무리 통계는 계산이 무거워서 얼굴에 붙여 두고, 같은 무리로 다시 판정할 때 재사용한다
  const sig = `${cohort.length}:${photos.length}`;
  const statOf = (f) => {
    if (f.statSig !== sig || f.statCohort !== cohort[0]) {
      f.stat = cohortStats(f.emb, cohort);
      f.statSig = sig;
      f.statCohort = cohort[0];
    }
    return f.stat;
  };
  const refStat = new Map();
  const withStat = (r) => {
    if (!refStat.has(r)) refStat.set(r, { emb: r.emb, stat: cohortStats(r.emb, cohort) });
    return refStat.get(r);
  };
  // 알림장 독사진 → 기준 얼굴 (등록한 기준 얼굴과 "확인 필요" 수준 이상으로 맞는 것만)
  if (!legacy) {
    const fromReports = [];
    for (const p of trusted) {
      const f = p.faces.length === 1 ? p.faces[0] : null;
      if (!f || f.size < SURE_MIN_PX * 1.5 || (f.score ?? 1) < SURE_MIN_SCORE) continue;
      const r = judge(f.emb, statOf(f), refsFor(p.date, refs).map(withStat), neg, th);
      if (r.level >= 1) fromReports.push({ emb: f.emb, date: p.date, auto: true });
    }
    refs = [...refs, ...fromReports.slice(0, 80)];
  }
  const out = new Map();
  const pass = (extra) => {
    for (const p of photos) {
      const rs = refsFor(p.date, [...refs, ...extra]).map(withStat);
      let best = { level: 0, z: -9, raw: 0, faceIdx: -1 };
      const sib = legacy ? [] : refsFor(p.date, others);
      const cands = []; // 우리 아이일 수 있는 얼굴들 (이웃 비교에서 다시 고른다)
      p.faces.forEach((f, i) => {
        const r = judge(f.emb, statOf(f), rs, neg, th);
        if (r.level === 3 && (f.size < SURE_MIN_PX || (f.score ?? 1) < SURE_MIN_SCORE)) r.level = 1;
        // 형제자매와 더 닮았으면 우리 아이가 아니고, 거의 비슷하면 확인 필요
        if (r.level && sib.length) {
          const s = faceScore(f.emb, sib);
          if (s >= r.raw) r.level = 0;
          else if (s >= r.raw - SIBLING_MARGIN && r.level === 3) r.level = 1;
        }
        if (r.level) cands.push({ ...r, faceIdx: i });
        if (r.level > best.level || (r.level === best.level && r.z > best.z)) best = { ...r, faceIdx: i };
      });
      if (forced.has(p.id)) best.level = forced.get(p.id);
      best.cands = cands;
      out.set(p.id, best);
    }
  };
  // 1차: 등록한 기준 얼굴 + 사용자가 확인한 얼굴
  pass(pos);
  const first = new Map([...out].map(([id, r]) => [id, r.level])); // 1차 판정 (자동 기준 얼굴 효과를 재려고)
  // 2차: 1차에서 아주 확실했던 얼굴을 같은 시기 기준 얼굴로 더해 다시 판정 (사용자가 "아니에요"라고 한 사진은 제외)
  const cands = photos
    .filter((p) => out.get(p.id).level === 3 && out.get(p.id).faceIdx >= 0 && forced.get(p.id) !== 0)
    .map((p) => {
      const b = out.get(p.id);
      const f = p.faces[b.faceIdx];
      return { emb: f.emb, size: f.size, date: p.date, z: b.z, raw: b.raw, faces: p.faces.length };
    });
  // 자동 기준 얼굴은 얼굴이 적은 사진에서만 (단체사진에서 잘못 고른 얼굴이 기준이 되면 그 아이 사진이 줄줄이 들어온다)
  const auto = pickAutoRefs(cands, th, legacy ? {} : { maxFaces: AUTO_MAX_FACES });
  if (auto.length) pass([...pos, ...auto]);
  for (const [id, r] of out) r.first = first.get(id);
  if (!legacy) {
    const allRefs = [...refs, ...pos, ...auto];
    checkNeighbors(photos, out, forced, th, (p, f) => ({ raw: faceScore(f.emb, refsFor(p.date, allRefs)) }), (p) => refsFor(p.date, allRefs));
  }
  return out;
}

/**
 * 이웃 비교 설정. n: 평균 낼 가장 닮은 얼굴 수, demote/promote: 비율 기준
 * (모의 앨범으로 고름: 0.92 에서 잘못 찾음 6~9%, 바로 찾음 86%. 0.94 부터는 우리 아이도 확인 필요로 많이 내려간다)
 * 비율 = (기준 얼굴 중 가장 닮은 n개와의 유사도 평균) ÷ (앨범 속 다른 사진 얼굴 중 가장 닮은 n개와의 유사도 평균)
 */
export const NEAR = { n: 3, demote: 0.92, promote: 0.97 };

/**
 * 이웃 비교: "이 얼굴은 자기와 가장 닮은 앨범 속 얼굴들만큼 우리 아이 기준 얼굴과도 닮았나?"
 * 앨범에는 아이마다 사진이 여러 장 있어서, 어떤 얼굴과 가장 닮은 앨범 속 얼굴은 대개 같은 아이의 다른 사진이다.
 * 진짜 우리 아이면 기준 얼굴도 같은 아이라 두 유사도가 비슷하고(비율 ≈ 1), 닮은 친구면 자기 사진끼리가 더 닮아서 비율이 낮다.
 * 한 장씩의 점수는 사진마다 흔들려 겹치지만, 이 비율은 아이 단위로 갈린다
 * (모의 앨범: 우리 아이 0.88~1.00, 닮은 친구 0.57~0.84, 다른 아이 0.31~0.70). 점수 크기에 상관없는 비율이라 모델·나이가 달라도 쓸 수 있다.
 * scoreOf(photo, face) → { raw }, refsOf(photo) → 그 사진 날짜의 기준 얼굴들
 */
export function checkNeighbors(photos, out, forced, th, scoreOf, refsOf) {
  const unit = (v) => {
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return Float32Array.from(v, (x) => x / n);
  };
  const dot = (a, b) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += a[i] * b[i];
    return d;
  };
  const topMean = (xs) => {
    xs.sort((a, b) => b - a);
    const t = xs.slice(0, NEAR.n);
    return t.reduce((s, x) => s + x, 0) / t.length;
  };
  // 비교 무리: 우리 아이와 어느 정도 닮은 얼굴(확인 필요 하한 이상)만. 다른 아이 얼굴은 비교에 쓸 일이 없고 계산만 늘린다
  const pool = [];
  for (const p of photos) for (const f of p.faces) if (scoreOf(p, f).raw >= th.rawMaybe) pool.push({ p, f, u: unit(f.emb) });
  const ratioOf = (p, f) => {
    const u = unit(f.emb);
    // 앨범 속 다른 사진의 얼굴 (같은 사진·자동 기준 얼굴로 쓰인 같은 얼굴은 뺀다)
    const album = pool.filter((o) => o.p !== p).map((o) => dot(u, o.u));
    const refs = refsOf(p).filter((x) => x.emb !== f.emb).map((x) => dot(u, unit(x.emb)));
    if (album.length < NEAR.n || !refs.length) return null;
    return topMean(refs) / Math.max(topMean(album), 1e-6);
  };
  for (const p of photos) {
    const r = out.get(p.id);
    if (forced.has(p.id) || !r.cands?.length) continue;
    // 한 사진의 후보 얼굴을 모두 비교한다: 가장 점수 높은 얼굴이 닮은 친구여도 같은 사진의 우리 아이를 놓치지 않게
    let best = null;
    for (const c of r.cands) {
      const f = p.faces[c.faceIdx];
      const ratio = ratioOf(p, f);
      let level = c.level;
      if (ratio != null) {
        if (level === 3 && ratio < NEAR.demote) level = 1;
        else if (level === 1 && ratio >= NEAR.promote && c.raw >= th.rawSure && f.size >= SURE_MIN_PX && (f.score ?? 1) >= SURE_MIN_SCORE) level = 3;
      }
      if (!best || level > best.level || (level === best.level && c.z > best.z)) best = { ...c, level, near: ratio };
    }
    Object.assign(r, best);
  }
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
