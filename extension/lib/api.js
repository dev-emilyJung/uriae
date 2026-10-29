// 키즈노트 웹(www.kidsnote.com)이 사용하는 비공식 내부 API 클라이언트.
// 인증은 사용자가 이미 로그인한 브라우저의 쿠키를 그대로 사용한다.
// 계정 정보는 저장하지도, 어디로 보내지도 않는다.

const BASE = 'https://kapi.kidsnote.com';
const REQUEST_GAP_MS = 250; // 서버 부담을 줄이기 위한 요청 간격

export class NotLoggedInError extends Error {}

let lastRequest = 0;
async function throttle() {
  const wait = lastRequest + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

async function get(path, params = {}) {
  await throttle();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 401 || res.status === 403) throw new NotLoggedInError();
  if (!res.ok) throw new Error(`키즈노트 응답 오류 ${res.status} (${path})`);
  return res.json();
}

const TZ = 'Asia/Seoul';

export const api = {
  me: () => get('/v1/me/'),

  /** 자녀별 소속(기관/반) 목록. 같은 아이가 학년별로 여러 개 있을 수 있음 */
  async enrollments() {
    const j = await get('/v1/me/enrollments');
    return (j.results || []).filter((e) => e.is_approved && !e.removed_child);
  },

  /** 알림장 한 페이지 */
  reports({ child, cls, center, page }) {
    return get(`/v1_2/children/${child}/reports/`, {
      cls, child, tz: TZ, center_id: center, page_size: 20, page,
    });
  },

  /** 공지사항 한 페이지 */
  notices({ center, cls, page }) {
    return get(`/v1/centers/${center}/notices`, { cls, tz: TZ, page_size: 20, page });
  },

  /** 앨범 한 페이지 */
  albums({ child, center, cls, page }) {
    return get(`/v1_3/children/${child}/albums/`, {
      tz: TZ, page_size: 12, center, cls, child, page,
    });
  },
};

/**
 * 커서 페이지네이션 순회. next 값을 page 파라미터로 넘기면 다음 페이지.
 * stop(item) 이 true 를 반환하면 그 시점에서 중단(기간 필터용).
 */
export async function* paginate(fetchPage, args, { stop, maxPages = 50 } = {}) {
  let page;
  for (let i = 0; i < maxPages; i++) {
    const j = await fetchPage({ ...args, page });
    for (const item of j.results || []) {
      if (stop && stop(item)) return;
      yield item;
    }
    if (!j.next) return;
    page = j.next;
  }
}

/**
 * 지금 다니는 반들만 남긴다.
 * 한 아이가 정규반 + 에듀케어반처럼 여러 반에 동시에 속할 수 있으므로 모두 유지하고,
 * 아이별 가장 최근 등록일보다 180일 넘게 오래된 소속(작년 반 등)만 제외한다.
 */
export function currentEnrollments(list) {
  const latest = new Map();
  for (const e of list) {
    const t = Date.parse(e.created);
    if (!latest.has(e.child) || t > latest.get(e.child)) latest.set(e.child, t);
  }
  const DAY = 86400000;
  return list
    .filter((e) => latest.get(e.child) - Date.parse(e.created) <= 180 * DAY)
    .sort((a, b) => a.child_name.localeCompare(b.child_name, 'ko') || a.class_name.localeCompare(b.class_name, 'ko'));
}
