import { api, paginate, currentEnrollments, NotLoggedInError } from './lib/api.js';
import { buildCards, ymd } from './lib/extract.js';
import { store, K } from './lib/store.js';

const main = document.getElementById('main');
const classBar = document.getElementById('classBar');
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

let enrollments = []; // 지금 다니는 모든 반 (아이 × 반)
let selected = new Set(); // 선택한 소속 id
let currentTab = 'prep';
let currentKid = null; // 지금 보고 있는 아이 id (한 번에 한 아이만)

// ───────────────────────── 작은 DOM 헬퍼 (서버 텍스트는 항상 textContent로) ─────────────────────────
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function render(...nodes) {
  main.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
}
function stateView(title, desc, action) {
  return h('div', { class: 'state' }, h('strong', {}, title), desc, action ? h('div', { style: 'margin-top:14px' }, action) : null);
}
const today = () => ymd(new Date());
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
function dateLabel(s) {
  const d = new Date(s + 'T12:00:00+09:00');
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]})`;
}
function cutoffYMD(days) {
  return days ? ymd(new Date(Date.now() - days * 86400000)) : '0000-00-00';
}
function postYMD(x) {
  return x.date_written ? String(x.date_written).slice(0, 10) : ymd(new Date(x.created));
}

// "26 에듀케어 (만4,5세) 사랑반" → "에듀케어 사랑반", "홍길동" → "길동"
function shortClass(name = '') {
  return name.replace(/^\d{2}\s*/, '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || name;
}
function givenName(name = '') {
  return name.length >= 3 ? name.slice(1) : name;
}
const selectedEnrollments = () => enrollments.filter((e) => e.child === currentKid && selected.has(e.id));
const kidClasses = () => enrollments.filter((e) => e.child === currentKid);
/** 아이 목록 (중복 제거). onlySelected 면 선택된 반이 있는 아이만 */
function kidsOf(list) {
  const m = new Map();
  for (const e of list) if (!m.has(e.child)) m.set(e.child, { child: e.child, name: e.child_name, birth: e.child_birth ? String(e.child_birth).slice(0, 10) : null, picture: e.child_picture, enrollments: [] });
  for (const e of list) m.get(e.child).enrollments.push(e);
  return [...m.values()];
}
const argsOf = (e) => ({ child: e.child, cls: e.belong_to_class, center: e.center_id });

// ───────────────────────── 시작 ─────────────────────────
async function boot() {
  try {
    await api.me();
    enrollments = currentEnrollments(await api.enrollments());
  } catch (e) {
    if (e instanceof NotLoggedInError) return showLogin();
    return render(stateView('키즈노트에 연결하지 못했어요', String(e.message || e)));
  }
  if (!enrollments.length) return render(stateView('등록된 아이가 없어요', '키즈노트에서 아이 등록이 승인되었는지 확인해 주세요.'));

  const saved = await store.get(K.selected, null);
  const valid = (saved || []).filter((id) => enrollments.some((e) => e.id === id));
  selected = new Set(valid.length ? valid : enrollments.map((e) => e.id));
  const savedKid = await store.get(K.kid, null);
  currentKid = enrollments.some((e) => e.child === savedKid) ? savedKid : enrollments[0].child;
  drawNav();
  showTab('prep');
}

// 아이 고르기(오른쪽 위) → 아이 이름 제목 → 그 아이의 반 체크박스
function drawNav() {
  const kids = kidsOf(enrollments);
  const kid = kids.find((k) => k.child === currentKid);
  document.getElementById('kidName').textContent = kid ? kid.name : '';
  const kidBar = document.getElementById('kidBar');
  kidBar.hidden = kids.length < 2;
  kidBar.replaceChildren(...kids.map((k) => {
    const b = h('button', { role: 'tab', 'aria-selected': String(k.child === currentKid) }, givenName(k.name));
    b.onclick = async () => {
      if (k.child === currentKid) return;
      currentKid = k.child;
      await store.set(K.kid, currentKid);
      photoState = null;
      drawNav();
      showTab(currentTab);
    };
    return b;
  }));
  const classes = kidClasses();
  classBar.hidden = currentTab !== 'prep' || classes.length < 2;
  classBar.replaceChildren(...classes.map((e) => {
    const box = h('input', { type: 'checkbox', checked: selected.has(e.id) });
    box.onchange = async () => {
      if (!box.checked && selectedEnrollments().length === 1) {
        box.checked = true; // 반은 최소 하나
        return;
      }
      if (box.checked) selected.add(e.id);
      else selected.delete(e.id);
      await store.set(K.selected, [...selected]);
      if (currentTab !== 'faces') showTab(currentTab);
    };
    return h('label', { title: e.class_name }, box, shortClass(e.class_name));
  }));
}

function showLogin() {
  render(
    stateView(
      '키즈노트 웹에 먼저 로그인해 주세요',
      '이 도구는 브라우저에 로그인된 키즈노트 세션을 그대로 사용해요. 비밀번호는 받지도 저장하지도 않습니다.',
      h('div', {},
        h('a', { class: 'btn', href: 'https://www.kidsnote.com/', target: '_blank', rel: 'noopener', style: 'text-decoration:none;display:inline-block' }, '키즈노트 열기'),
        ' ',
        h('button', { class: 'btn ghost', onclick: () => location.reload() }, '로그인했어요'),
      ),
    ),
  );
}

document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => enrollments.length && showTab(b.dataset.tab));
});
function showTab(tab) {
  currentTab = tab;
  classBar.hidden = tab !== 'prep' || kidClasses().length < 2;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  ({ prep: showPrep, photos: showPhotos, faces: showFaces })[tab]();
}

// ───────────────────────── 챙길 것 ─────────────────────────
let prepRun = 0;
async function showPrep() {
  const run = ++prepRun;
  const list = selectedEnrollments();
  render(stateView('알림장과 공지를 읽는 중…', `${list.length}개 반의 최근 30일치를 확인하고 있어요.`));
  const since = cutoffYMD(30);
  const posts = new Map(); // key → post (반 여러 곳에 같은 공지가 와도 하나로)
  const addPost = (key, post, who) => {
    const p = posts.get(key) || { ...post, who: [] };
    if (!p.who.includes(who)) p.who.push(who);
    posts.set(key, p);
  };
  try {
    for (const e of list) {
      const args = argsOf(e);
      for await (const r of paginate(api.reports, args, { stop: (x) => postYMD(x) < since, maxPages: 5 })) {
        addPost(`report:${r.id}`, { id: r.id, source: 'report', date: postYMD(r), title: '', content: r.content || '' }, shortClass(e.class_name));
      }
      for await (const n of paginate(api.notices, args, { stop: (x) => postYMD(x) < since, maxPages: 5 })) {
        addPost(`notice:${n.id}`, { id: n.id, source: 'notice', date: postYMD(n), title: n.title || '', content: n.content || '' }, shortClass(e.class_name));
      }
    }
  } catch (e) {
    if (e instanceof NotLoggedInError) return showLogin();
    return render(stateView('불러오지 못했어요', String(e.message || e)));
  }
  if (currentTab !== 'prep' || run !== prepRun) return;

  const checked = await store.get(K.checked, {});
  const cards = buildCards([...posts.values()]);
  const t = today();
  const upcoming = cards.filter((c) => c.date >= t);
  const past = cards.filter((c) => c.date < t && daysBetween(c.date, t) <= 7).reverse();

  const groups = [
    ['오늘', (c) => c.date === t],
    ['내일', (c) => daysBetween(t, c.date) === 1],
    ['이번 주', (c) => { const d = daysBetween(t, c.date); return d >= 2 && d <= 7; }],
    ['그 이후', (c) => daysBetween(t, c.date) > 7],
  ];

  const soonKeys = upcoming.filter((c) => daysBetween(t, c.date) <= 1).flatMap((c) => c.prep.map((_, i) => `${c.key}#${i}`));
  const left = soonKeys.filter((k) => !checked[k]).length;
  const multi = list.length > 1;

  const save = () => store.set(K.checked, checked);
  const cardView = (c, showDday = true) => {
    const d = daysBetween(t, c.date);
    const dday = d === 0 ? '오늘' : d === 1 ? '내일' : d > 0 ? `D-${d}` : `${-d}일 전`;
    const keys = c.prep.map((_, i) => `${c.key}#${i}`);
    const el = h('article', { class: 'card' + (keys.length && keys.every((k) => checked[k]) ? ' done' : '') },
      h('div', { class: 'card-head' },
        showDday ? h('span', { class: 'dday' }, dday) : null,
        h('span', { class: 'date' }, dateLabel(c.date) + (c.dateGuessed ? ' · 글 작성일' : '')),
        multi ? c.who.map((w) => h('span', { class: 'who' }, w)) : null,
        h('span', { class: 'badge' }, c.source === 'notice' ? '공지' : '알림장'),
      ),
      c.title ? h('h3', {}, c.title) : null,
      c.events.length && !c.events[0].includes(c.title.replace('…', '')) ? h('div', { class: 'event' }, c.events[0]) : null,
      c.prep.length
        ? h('ul', { class: 'items' }, c.prep.map((p, i) => {
            const k = keys[i];
            const li = h('li', { class: checked[k] ? 'checked' : '' },
              h('input', {
                type: 'checkbox', checked: !!checked[k], 'aria-label': p,
                onchange: (ev) => {
                  if (ev.target.checked) checked[k] = true;
                  else delete checked[k];
                  li.classList.toggle('checked', ev.target.checked);
                  el.classList.toggle('done', keys.every((x) => checked[x]));
                  save();
                },
              }),
              h('span', {}, p),
            );
            return li;
          }))
        : null,
      c.times.length ? h('div', { class: 'time' }, h('b', {}, '시간 '), c.times[0]) : null,
      h('details', {}, h('summary', {}, '원문 보기'), h('div', { class: 'raw' }, c.content)),
    );
    return el;
  };

  const out = [];
  out.push(h('p', { class: 'summary' },
    left ? h('span', {}, '오늘·내일 챙길 것 ', h('mark', {}, `${left}개`), '가 남았어요')
      : upcoming.length ? '오늘·내일 챙길 것은 모두 체크했어요' : '다가오는 준비물 안내가 없어요',
  ));
  for (const [name, fn] of groups) {
    const g = upcoming.filter(fn);
    if (!g.length) continue;
    out.push(h('div', { class: 'group-title' }, name, h('small', {}, `${g.length}건`)));
    g.forEach((c) => out.push(cardView(c, name !== '오늘' && name !== '내일')));
  }
  if (past.length) {
    out.push(h('details', { class: 'past' }, h('summary', {}, `지난 7일 안내 ${past.length}건`), past.map(cardView)));
  }
  if (!cards.length) out.push(stateView('최근 30일 안에 챙길 것을 찾지 못했어요', '규칙으로 찾기 때문에 놓친 게 있을 수 있어요. 키즈노트 원문도 한 번 확인해 주세요.'));
  out.push(h('p', { class: 'muted', style: 'margin-top:18px' }, '※ 문장 규칙으로 자동 추출한 결과예요. 중요한 안내는 원문을 꼭 확인해 주세요.'));
  render(...out);
}

// ───────────────────────── 우리 애 사진 ─────────────────────────
// 판정: 1024px 사진에서 얼굴을 찾고, 사진 날짜와 가까운 시기의 기준 얼굴로 비교한 뒤
//       이번에 확인한 모든 얼굴의 점수 분포에서 "튀게 높은" 것만 우리 아이로 본다.
// 저장: 사진별 얼굴 점수(숫자)만 저장. 다른 아이들의 얼굴 특징값은 저장하지 않는다.
// 한 번에 찾는 최대 기간. 사진을 한 장씩 살펴보므로 너무 길면 몇 시간이 걸리고 키즈노트 서버에도 부담이 된다
const MAX_DAYS = 365;
let stopRequested = false;
let photoState = null;
const faceMem = new Map(); // 사진 id → 얼굴 특징값 (이 탭이 열려 있는 동안만, 저장 안 함)
const selSig = () => [...selected].sort().join(',');
const refsSig = (refs) => refs.map((r) => r.id).sort().join(',');

async function showPhotos() {
  const kids = kidsOf(selectedEnrollments());
  for (const k of kids) await upgradeRefs(k.child);
  const withRefs = [];
  const noRefs = [];
  for (const k of kids) {
    k.refs = await store.get(K.refs(k.child), []);
    (k.refs.length >= 2 ? withRefs : noRefs).push(k);
  }
  if (!withRefs.length) {
    return render(stateView('먼저 아이 얼굴을 2개 이상 등록해 주세요', '기간별로 2개씩 등록하면 가장 정확해요. 알림장 사진 속 얼굴을 눌러서 고를 수 있어요.',
      h('button', { class: 'btn', onclick: () => showTab('faces') }, '기준 얼굴 등록하기')));
  }
  const period = h('select', { 'aria-label': '기간' },
    h('option', { value: '14' }, '최근 2주'),
    h('option', { value: '30', selected: true }, '최근 1개월'),
    h('option', { value: '90' }, '최근 3개월'),
    h('option', { value: '180' }, '최근 6개월'),
    h('option', { value: '365' }, '최근 1년'),
  );
  const runBtn = h('button', { class: 'btn' }, '우리 애 사진 찾기');
  const stopBtn = h('button', { class: 'btn ghost', hidden: true, onclick: () => { stopRequested = true; stopBtn.textContent = '멈추는 중…'; } }, '중지하고 지금까지 결과 보기');
  const status = h('div', { class: 'muted' },
    `예전 반과 다른 기관 사진까지, 반과 상관없이 ${withRefs.map((k) => givenName(k.name)).join(', ')}의 사진을 찾아요. 사진을 하나씩 살펴보기 때문에 한 번에 최대 1년까지 찾을 수 있어요.`);
  const warn = noRefs.length
    ? h('div', { class: 'muted', style: 'margin-top:4px' }, `${noRefs.map((k) => givenName(k.name)).join(', ')}는 기준 얼굴이 부족해서 이번엔 빠져요. `,
        h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); showTab('faces'); } }, '등록하기'))
    : null;
  const bar = h('div', { class: 'progress', hidden: true }, h('div'));
  const results = h('div');
  runBtn.onclick = () => runSearch(Math.min(Number(period.value) || MAX_DAYS, MAX_DAYS), withRefs, { runBtn, stopBtn, status, bar, results });
  render(h('div', { class: 'toolbar' }, period, runBtn, stopBtn), status, warn, bar, results);
  if (photoState && photoState.sig === selSig()) drawResults(results);
}

const summaryText = (groups) => groups.map((g) =>
  `${givenName(g.name)}: 앨범 ${g.total.toLocaleString('ko-KR')}장 중 ${g.sure.length}장${g.maybe.length ? `, 확인 필요 ${g.maybe.length}장` : ''}, 알림장 ${g.reports.length}장${stopRequested ? ' (중지한 지점까지)' : ''}`).join(' · ');

// 사용자가 결과를 고친 내용 (아이별, 이 탭이 열려 있는 동안만). pos: 우리 아이 맞음, neg: 우리 아이 아님
const feedback = new Map();
const fbOf = (child) => {
  if (!feedback.has(child)) feedback.set(child, { pos: new Map(), neg: new Map() });
  return feedback.get(child);
};

/** 한 아이의 앨범 사진을 판정. 얼굴 특징값은 faceMem(메모리)에서 가져온다 */
function classifyKid(kid, mine, reports, strictness) {
  const { refsFor, cohortStats, sampleCohort, decide, judge } = matchLib;
  const th = decide(strictness);
  const fb = fbOf(kid.child);
  const allEmbs = mine.flatMap((j) => (faceMem.get(j.img.id) || []).map((f) => f.emb));
  const cohort = sampleCohort(allEmbs, 300);
  const extra = [...fb.pos.values()].map((p) => ({ emb: p.emb, date: p.date }));
  const statCache = new Map();
  const withStat = (r) => {
    if (!statCache.has(r)) statCache.set(r, { emb: r.emb, stat: cohortStats(r.emb, cohort) });
    return statCache.get(r);
  };
  const neg = [...fb.neg.values()].map((n) => n.emb);
  for (const j of mine) {
    const faces = faceMem.get(j.img.id) || [];
    const refs = [...refsFor(j.date, kid.refs), ...extra].map(withStat);
    let best = { level: 0, z: -9, raw: 0, idx: -1 };
    faces.forEach((f, i) => {
      if (!f.stat) f.stat = cohortStats(f.emb, cohort);
      const r = judge(f.emb, f.stat, refs, neg, th);
      if (r.level > best.level || (r.level === best.level && r.z > best.z)) best = { ...r, idx: i };
    });
    // 사용자가 직접 고친 사진은 그대로 따른다
    const key = `${kid.child}:${j.img.id}`;
    if (fb.pos.has(key)) best.level = 3;
    if (fb.neg.has(key)) best.level = 0;
    j.level = best.level;
    j.score = best.z;
    j.faceIdx = best.idx;
  }
  return {
    child: kid.child,
    name: kid.name,
    reports: [...reports].sort((a, b) => b.date.localeCompare(a.date)),
    sure: mine.filter((j) => j.level === 3).sort((a, b) => b.date.localeCompare(a.date)),
    maybe: mine.filter((j) => j.level === 1).sort((a, b) => b.score - a.score).slice(0, 300),
    total: mine.length,
  };
}
let matchLib = null;

async function runSearch(days, kids, ui) {
  matchLib = await import('./lib/match.js');
  const { initFace, detectFaces } = await import('./lib/face.js');

  stopRequested = false;
  ui.runBtn.disabled = true;
  ui.stopBtn.hidden = false;
  ui.bar.hidden = false;
  ui.results.replaceChildren();
  const fill = ui.bar.firstChild;
  const since = cutoffYMD(days);

  try {
    ui.status.textContent = '얼굴 인식 모델을 준비하는 중…';
    await initFace();

    // 1) 아이별 사진 목록. 알림장 사진은 그 아이에게 온 사진이라 얼굴 검사 없이 포함
    ui.status.textContent = '사진 목록을 모으는 중…';
    const reportJobs = [];
    const albumJobs = [];
    for (const kid of kids) {
      const seen = new Set();
      for await (const r of paginate(api.childReports, { child: kid.child }, { stop: (x) => postYMD(x) < since, maxPages: 100 })) {
        for (const img of r.attached_images || []) {
          if (seen.has(img.id)) continue;
          seen.add(img.id);
          reportJobs.push({ kid, img, title: '알림장', date: postYMD(r) });
        }
      }
      for await (const a of paginate(api.childAlbums, { child: kid.child }, { stop: (x) => postYMD(x) < since, maxPages: 100 })) {
        for (const img of a.attached_images || []) {
          if (seen.has(img.id)) continue;
          seen.add(img.id);
          albumJobs.push({ kid, img, title: a.title || '앨범', date: postYMD(a) });
        }
        ui.status.textContent = `사진 목록을 모으는 중… ${reportJobs.length + albumJobs.length}장`;
      }
    }

    // 2) 앨범 사진 속 얼굴 찾기. 얼굴 특징값은 이 탭이 열려 있는 동안 메모리에만 두고 저장하지 않는다.
    //    얼굴을 찾는 동안 다음 사진 몇 장을 미리 받아 두어 다운로드 대기 시간을 줄인다.
    const PREFETCH = 6;
    const todo = albumJobs.filter((j) => !faceMem.has(j.img.id));
    const total = albumJobs.length;
    let done = total - todo.length;
    const started = Date.now();
    const clock = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
    const dur = (ms) => {
      const m = Math.round(ms / 60000);
      return m < 1 ? '1분 이내' : m < 60 ? `약 ${m}분` : `약 ${Math.floor(m / 60)}시간 ${m % 60}분`;
    };
    const progress = () => {
      fill.style.width = `${(done / Math.max(total, 1)) * 100}%`;
      const processed = done - (total - todo.length);
      let eta = '예상 시간 계산 중…';
      if (processed >= 10) {
        const per = (Date.now() - started) / processed;
        const left = per * (total - done);
        eta = `예상 완료 ${clock(Date.now() + left)} (${dur(left)} 남음)`;
      }
      ui.status.textContent = `앨범 사진 ${total.toLocaleString('ko-KR')}장 중 ${done.toLocaleString('ko-KR')}장 확인 · 시작 ${clock(started)} · ${eta}`;
    };
    const urlOf = (j) => j.img.large || j.img.original;
    const pending = new Map();
    const want = (i) => {
      if (i < todo.length && !pending.has(i)) {
        pending.set(i, fetch(urlOf(todo[i])).then((r) => (r.ok ? r.blob() : null)).catch(() => null));
      }
    };
    progress();
    for (let i = 0; i < todo.length; i++) {
      if (stopRequested) break;
      for (let k = i; k < i + PREFETCH; k++) want(k);
      const blob = await pending.get(i);
      pending.delete(i);
      let faces = [];
      if (blob) {
        try { faces = (await detectFaces(blob)).map((f) => ({ emb: f.emb, size: f.size })); } catch { faces = []; }
      }
      faceMem.set(todo[i].img.id, faces);
      done++;
      progress();
    }
    if (stopRequested) {
      // 중지하면 지금까지 확인한 사진만으로 판정한다
      albumJobs.splice(0, albumJobs.length, ...albumJobs.filter((j) => faceMem.has(j.img.id)));
    }

    // 3) 아이별 판정 (사용자가 고친 내용이 있으면 함께 반영)
    const strictness = await store.get(K.strictness, 0.5);
    const groups = kids.map((kid) => classifyKid(kid, albumJobs.filter((j) => j.kid === kid), reportJobs.filter((j) => j.kid === kid), strictness));
    photoState = {
      sig: selSig(),
      kids,
      jobs: { albumJobs, reportJobs },
      groups,
      selected: new Set(groups.flatMap((g) => [...g.reports, ...g.sure].map((j) => `${g.child}:${j.img.id}`))),
    };
    drawResults(ui.results);
    ui.status.textContent = summaryText(groups);
  } catch (e) {
    if (e instanceof NotLoggedInError) return showLogin();
    ui.status.textContent = '오류: ' + (e.message || e);
  } finally {
    ui.runBtn.disabled = false;
    ui.stopBtn.hidden = true;
    ui.bar.hidden = true;
  }
}

function drawResults(container) {
  const s = photoState;
  const countEl = h('span');
  const dlBtn = h('button', { class: 'btn' }, 'ZIP으로 받기');
  const updateCount = () => {
    countEl.textContent = `선택 ${s.selected.size}장`;
    dlBtn.disabled = !s.selected.size;
  };
  const tile = (g, x, kind) => {
    const key = `${g.child}:${x.img.id}`;
    const el = h('button', { class: 'tile' + (kind === 'maybe' ? ' maybe' : '') + (s.selected.has(key) ? ' sel' : ''), title: `${x.date} ${x.title}` },
      h('img', { src: x.img.small_resize || x.img.small, loading: 'lazy', alt: '' }),
      kind === 'maybe' ? h('span', { class: 'tag' }, '확인') : null,
      h('span', { class: 'check' }, '✓'),
    );
    el.onclick = () => {
      const fb = fbOf(g.child);
      const face = (faceMem.get(x.img.id) || [])[x.faceIdx];
      if (s.selected.has(key)) {
        s.selected.delete(key);
        // 우리 아이로 뽑혔던 사진을 빼면 "이 얼굴은 다른 아이"로 기억
        if (kind === 'sure' && face) fb.neg.set(key, { emb: face.emb });
        fb.pos.delete(key);
      } else {
        s.selected.add(key);
        // 확인 필요에서 고르면 "이 얼굴은 우리 아이"로 기억
        if (kind === 'maybe' && face) fb.pos.set(key, { emb: face.emb, date: x.date });
        fb.neg.delete(key);
      }
      el.classList.toggle('sel');
      updateCount();
      updateRefine();
    };
    return el;
  };
  const refineBtn = h('button', { class: 'btn ghost', hidden: true }, '');
  const updateRefine = () => {
    const n = s.groups.reduce((sum, g) => sum + fbOf(g.child).pos.size + fbOf(g.child).neg.size, 0);
    refineBtn.hidden = !n;
    refineBtn.textContent = `고친 ${n}장을 반영해서 다시 찾기`;
  };
  refineBtn.onclick = async () => {
    const strictness = await store.get(K.strictness, 0.5);
    s.groups = s.kids.map((kid) => classifyKid(kid, s.jobs.albumJobs.filter((j) => j.kid === kid), s.jobs.reportJobs.filter((j) => j.kid === kid), strictness));
    // 선택 상태도 새 판정에 맞춘다 (직접 고친 것은 유지)
    s.selected = new Set(s.groups.flatMap((g) => [...g.reports, ...g.sure].map((j) => `${g.child}:${j.img.id}`)));
    drawResults(container);
    const st = main.querySelector('.toolbar + .muted');
    if (st) st.textContent = summaryText(s.groups);
  };

  const multi = s.groups.length > 1;
  const nodes = [];
  for (const g of s.groups) {
    const who = multi ? `${givenName(g.name)} · ` : '';
    const block = (title, note, list, kind) => {
      if (!list.length) return;
      nodes.push(h('div', { class: 'section-label' }, `${who}${title}`, h('small', {}, `${list.length}장 · ${note}`)));
      nodes.push(h('div', { class: 'grid' }, list.map((x) => tile(g, x, kind))));
    };
    block('우리 아이', '아닌 사진은 눌러서 빼 주세요', g.sure, 'sure');
    block('알림장 사진', '선생님이 우리 아이에게 보낸 사진', g.reports, 'report');
    block('확인이 필요해요', '우리 아이가 맞으면 눌러서 골라 주세요', g.maybe, 'maybe');
    if (multi && !g.sure.length && !g.maybe.length && !g.reports.length) {
      nodes.push(h('div', { class: 'section-label' }, givenName(g.name), h('small', {}, '찾은 사진이 없어요')));
    }
  }
  const all = s.groups.flatMap((g) => [...g.sure, ...g.reports, ...g.maybe].map((x) => ({ g, x })));
  dlBtn.onclick = () => {
    const picked = all.filter(({ g, x }) => s.selected.has(`${g.child}:${x.img.id}`))
      .map(({ g, x }) => ({ ...x, folder: multi ? givenName(g.name) : '' }));
    downloadZip(picked, dlBtn);
  };
  nodes.push(all.length ? h('div', { class: 'dock' }, countEl, h('div', { class: 'dock-actions' }, refineBtn, dlBtn)) : stateView('찾은 사진이 없어요', '기준 얼굴을 기간별로 더 추가하거나 기간을 늘려보세요.'));
  container.replaceChildren(...nodes);
  updateCount();
  updateRefine();
}

async function downloadZip(list, btn) {
  const CHUNK = 200; // 브라우저 메모리를 위해 200장씩 나눠서 압축
  const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
  btn.disabled = true;
  let failed = 0;
  try {
    for (let part = 0; part * CHUNK < list.length; part++) {
      const zip = new JSZip();
      const slice = list.slice(part * CHUNK, (part + 1) * CHUNK);
      let n = 0;
      const queue = slice.map((x, i) => ({ x, i }));
      const worker = async () => {
        while (queue.length) {
          const { x, i } = queue.shift();
          let res;
          try {
            res = await fetch(x.img.original || x.img.large);
            if (!res.ok) throw new Error(res.status);
          } catch {
            failed++;
            continue; // 한 장 실패해도 나머지는 계속
          }
          const ext = (x.img.original_file_name || '').split('.').pop() || 'jpg';
          const dir = x.folder ? `${x.folder}/` : '';
          zip.file(`${dir}${x.date}_${safe(x.title)}_${String(part * CHUNK + i + 1).padStart(3, '0')}.${ext}`, await res.blob(), { date: new Date(`${x.date}T12:00:00+09:00`) });
          btn.textContent = `받는 중 ${part * CHUNK + ++n}/${list.length}`;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      btn.textContent = '압축하는 중…';
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `우리애_${today()}${list.length > CHUNK ? `_${part + 1}` : ''}.zip` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    btn.textContent = failed ? `완료 (${failed}장 실패)` : '다운로드 완료';
  } catch (e) {
    btn.textContent = '다시 시도';
    main.prepend(h('p', { class: 'error' }, '다운로드 중 오류가 났어요: ' + (e.message || e)))
  } finally {
    btn.disabled = false;
  }
}

// ───────────────────────── 기준 얼굴 (아이별 · 기간별) ─────────────────────────
// 아이 얼굴은 6개월만 지나도 달라지므로, 생년월일 기준 6개월 단위로 2개씩 등록하도록 안내한다.
// 기준 얼굴은 그 시기 알림장·앨범 사진 속 얼굴을 눌러서 고른다. 고르는 화면의 다른 얼굴은 메모리에만 있고 저장하지 않는다.
/** 예전 얼굴 모델로 만든 기준 얼굴을 새 모델로 다시 계산 (한 번만). 실패한 것은 지운다 */
async function upgradeRefs(childId) {
  const refs = await store.get(K.refs(childId), []);
  const { MODEL_ID } = await import('./lib/face.js');
  if (refs.every((r) => r.model === MODEL_ID)) return 0;
  render(stateView('얼굴 인식을 더 정확한 방식으로 바꾸는 중…', '등록해 둔 기준 얼굴을 한 번만 다시 계산해요.'));
  const { upgradeReference } = await import('./lib/face.js');
  const next = [];
  let lost = 0;
  for (const r of refs) {
    const u = await upgradeReference(r);
    u ? next.push(u) : lost++;
  }
  await store.set(K.refs(childId), next);
  await store.remove(K.scores(childId));
  photoState = null;
  return lost;
}

async function saveRefs(childId, newRefs) {
  const refs = await store.get(K.refs(childId), []);
  refs.push(...newRefs);
  await store.set(K.refs(childId), refs);
  await store.remove(K.scores(childId)); // 기준이 바뀌면 점수 다시 계산
  photoState = null;
}

async function showFaces(flash = '') {
  const { agePeriods } = await import('./lib/match.js');
  const kids = kidsOf(enrollments);
  const kid = kids.find((k) => k.child === currentKid) || kids[0];
  const lost = await upgradeRefs(kid.child);
  if (lost && !flash) flash = `예전 기준 얼굴 ${lost}개는 새 방식으로 바꾸지 못해서 지웠어요. 그 시기 얼굴을 다시 골라 주세요.`;
  const refs = await store.get(K.refs(kid.child), []);
  const strictness = await store.get(K.strictness, 0.5);
  const msg = h('div', { class: 'muted' }, flash);
  const periods = kid.birth ? agePeriods(kid.birth, today(), 3) : [{ start: cutoffYMD(365), end: today(), label: '최근 1년' }];
  const inPeriod = (r, p) => r.date && r.date >= p.start && r.date <= p.end;
  const undated = refs.filter((r) => !periods.some((p) => inPeriod(r, p)));

  const removeRef = async (id) => {
    const next = (await store.get(K.refs(kid.child), [])).filter((x) => x.id !== id);
    await store.set(K.refs(kid.child), next);
    await store.remove(K.scores(kid.child));
    photoState = null;
    showFaces();
  };
  const refChip = (r) => h('div', { class: 'ref' }, h('img', { src: r.thumb, alt: '' }), h('button', { onclick: () => removeRef(r.id) }, '삭제'));

  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.onchange = async () => {
    const { referenceFromFile } = await import('./lib/face.js');
    const files = [...fileInput.files];
    const made = [];
    let fail = 0;
    for (const [i, f] of files.entries()) {
      msg.textContent = `얼굴 찾는 중… ${i + 1}/${files.length}`;
      const r = await referenceFromFile(f, ymd(new Date(f.lastModified)));
      r ? made.push(r) : fail++;
    }
    await saveRefs(kid.child, made);
    showFaces(`${made.length}개 등록${fail ? `, ${fail}장은 얼굴을 찾지 못했어요` : ''}. 파일 날짜를 사진 날짜로 썼어요.`);
  };

  const slider = h('input', { type: 'range', min: '0', max: '1', step: '0.1', value: String(strictness) });
  slider.onchange = async () => {
    await store.set(K.strictness, Number(slider.value));
    photoState = null;
  };

  render(
    h('section', { class: 'panel' },
      h('h2', {}, `${kid.name}의 기준 얼굴`),
      h('p', { class: 'muted' }, '아이 얼굴은 금방 바뀌어서, 시기별로 2개씩 있으면 가장 정확해요. 사진을 찾을 때는 그 사진 날짜와 가까운 시기의 얼굴로 비교해요.'),
      h('div', { class: 'periods' }, periods.map((p) => {
        const mine = refs.filter((r) => inPeriod(r, p));
        return h('div', { class: 'period' + (mine.length < 2 ? ' need' : '') },
          h('div', { class: 'period-head' },
            h('b', {}, p.label),
            h('span', { class: 'muted' }, `${p.start.replaceAll('-', '.')} ~ ${p.end.replaceAll('-', '.')}`),
            h('span', { class: 'count' }, mine.length >= 2 ? `${mine.length}개 ✓` : `${mine.length}/2개`),
          ),
          mine.length ? h('div', { class: 'refs' }, mine.map(refChip)) : null,
          h('button', { class: 'btn ghost small', onclick: () => showPicker(kid, p) }, '이 시기 사진에서 고르기'),
        );
      })),
      undated.length ? h('div', {}, h('div', { class: 'section-label' }, '날짜 없는 기준 얼굴', h('small', {}, '예전 버전에서 등록한 얼굴')), h('div', { class: 'refs' }, undated.map(refChip))) : null,
      h('div', { class: 'toolbar', style: 'margin-top:12px' },
        h('button', { class: 'btn ghost small', onclick: () => fileInput.click() }, '내 사진 파일로 추가'),
        fileInput,
      ),
      msg,
    ),
    h('section', { class: 'panel' },
      h('h2', {}, '찾는 기준'),
      h('div', { class: 'slider' }, h('span', { class: 'muted' }, '많이 찾기'), slider, h('span', { class: 'muted' }, '정확하게')),
      h('p', { class: 'muted' }, '다른 아이가 섞이면 정확하게 쪽으로, 놓치는 사진이 많으면 많이 찾기 쪽으로 옮겨 보세요. 애매한 사진은 "확인이 필요해요"에 따로 모아 보여드려요.'),
    ),
    h('section', { class: 'panel' },
      h('h2', {}, '내 데이터'),
      h('p', { class: 'muted' }, '기준 얼굴과 사진 점수는 이 브라우저에만 저장돼요. 다른 아이들의 얼굴 정보는 비교 직후 버려지고 저장되지 않아요.'),
      h('button', { class: 'btn ghost small', onclick: async () => {
        if (!confirm(`${kid.name}의 기준 얼굴과 사진 점수를 모두 지울까요?`)) return;
        await Promise.all([store.remove(K.refs(kid.child)), store.remove(K.scores(kid.child))]);
        photoState = null;
        showFaces();
      } }, `${givenName(kid.name)} 데이터 모두 지우기`),
    ),
  );
}

/** 그 시기의 알림장·앨범 사진에서 얼굴을 모아 보여주고, 우리 아이 얼굴을 눌러서 고르게 한다 */
async function showPicker(kid, p) {
  const { detectFaces, initFace, MODEL_ID } = await import('./lib/face.js');
  const status = h('div', { class: 'muted' }, `${p.label} 사진을 찾는 중…`);
  const grid = h('div', { class: 'faces' });
  const picked = new Map();
  const saveBtn = h('button', { class: 'btn', disabled: true }, '선택한 얼굴 등록');
  const back = h('button', { class: 'btn ghost small', onclick: () => showFaces() }, '← 돌아가기');
  render(back, h('h2', { style: 'margin:14px 0 4px' }, `${kid.name} · ${p.label}`),
    h('p', { class: 'muted' }, `${p.start.replaceAll('-', '.')} ~ ${p.end.replaceAll('-', '.')} 사진 속 얼굴이에요. 우리 아이 얼굴을 2개 이상 눌러 주세요.`),
    h('ul', { class: 'guide' },
      h('li', {}, h('b', {}, '가운데 얼굴만 봐요. '), '칸마다 가운데 얼굴 하나만 기준이 돼요. 친구들과 같이 찍은 사진이라도 가운데가 우리 아이면 골라도 돼요.'),
      h('li', {}, h('b', {}, '골고루 섞어 주세요. '), '정면 독사진에 단체사진 속 얼굴, 살짝 옆모습을 1~2개 섞으면 단체사진에서도 더 잘 찾아요.'),
      h('li', {}, h('b', {}, '이런 얼굴은 빼 주세요. '), '가장자리에 잘린 얼굴, 다른 아이와 겹친 얼굴, 손이나 물건에 많이 가려진 얼굴, 완전히 옆으로 돌린 얼굴.'),
    ),
    status, grid, h('div', { class: 'dock' }, h('span', {}, '우리 아이 얼굴만 골라 주세요'), saveBtn));
  saveBtn.onclick = async () => {
    await saveRefs(kid.child, [...picked.values()]);
    showFaces(`${picked.size}개 등록했어요`);
  };

  try {
    await initFace();
    // 그 시기 알림장 사진(그 아이에게 온 것) 우선, 부족하면 앨범 사진. 반·기관 상관없이 아이 기준으로 찾는다
    const photos = [];
    const inRange = (x) => postYMD(x) >= p.start && postYMD(x) <= p.end;
    for await (const r of paginate(api.childReports, { child: kid.child }, { stop: (x) => postYMD(x) < p.start, maxPages: 100 })) {
      if (inRange(r)) for (const img of r.attached_images || []) photos.push({ img, date: postYMD(r) });
      if (photos.length >= 24) break;
    }
    for await (const a of paginate(api.childAlbums, { child: kid.child }, { stop: (x) => postYMD(x) < p.start, maxPages: 100 })) {
      if (photos.length >= 40) break;
      if (!inRange(a)) continue;
      for (const img of (a.attached_images || []).slice(0, 4)) photos.push({ img, date: postYMD(a) });
    }
    if (!photos.length) return (status.textContent = '이 시기의 사진을 찾지 못했어요. 키즈노트에 이 시기 자료가 없거나, 다른 기관에 다닐 때일 수 있어요.');

    let n = 0, count = 0;
    for (const ph of photos) {
      status.textContent = `사진 ${photos.length}장 중 ${++n}장 살펴보는 중… 얼굴 ${count}개`;
      let faces = [];
      try { faces = await detectFaces(ph.img.large || ph.img.original, { withCrops: true }); } catch { continue; }
      for (const f of faces) {
        count++;
        const ref = { id: crypto.randomUUID(), emb: f.emb, thumb: f.crop, date: ph.date, model: MODEL_ID };
        const b = h('button', { class: 'face', title: ph.date }, h('img', { src: f.crop, alt: '' }), h('span', { class: 'check' }, '✓'));
        b.onclick = () => {
          if (picked.has(ref.id)) picked.delete(ref.id);
          else picked.set(ref.id, ref);
          b.classList.toggle('sel');
          saveBtn.disabled = !picked.size;
          saveBtn.textContent = picked.size ? `선택한 얼굴 ${picked.size}개 등록` : '선택한 얼굴 등록';
        };
        grid.append(b);
      }
    }
    status.textContent = count ? `얼굴 ${count}개를 찾았어요.` : '얼굴을 찾지 못했어요.';
  } catch (err) {
    if (err instanceof NotLoggedInError) return showLogin();
    status.textContent = '오류: ' + (err.message || err);
  }
}

boot();
