import { api, paginate, currentEnrollments, NotLoggedInError } from './lib/api.js';
import { buildCards, ymd, fixOcrLine, isReadable, isReferenceDoc } from './lib/extract.js';
import { store, K } from './lib/store.js';

const main = document.getElementById('main');
// 홈페이지 "의견 보내기"로 갈 때 어느 버전에서 왔는지 함께 (주소에만 붙고, 이용자가 직접 보낼 때만 기록된다)
document.getElementById('feedbackLink').href = `https://uriae.emilysoft.com/?from=extension&v=${chrome.runtime.getManifest().version}#feedback`;
// 개발용 설치에서만: 측정 페이지 바로가기 (dev 폴더는 스토어 zip에 없다)
if (!('update_url' in chrome.runtime.getManifest())) {
  document.querySelector('.foot').append(
    Object.assign(document.createElement('a'), { href: 'dev/eval.html', target: '_blank', textContent: '개발: 얼굴 측정' }),
    Object.assign(document.createElement('a'), { href: 'dev/prep-eval.html', target: '_blank', textContent: '개발: 알림장 내보내기' }),
  );
}
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
      h('div', { class: 'toolbar' },
        h('a', { class: 'btn', href: 'https://www.kidsnote.com/', target: '_blank', rel: 'noopener' }, '키즈노트 열기'),
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
// 그림으로 온 가정통신문·안내문은 브라우저 안에서 글자를 읽어(lib/ocr.js) 본문과 함께 살핀다.
// 읽은 결과는 그림별로 저장해 두고(60일) 다시 읽지 않는다.
const OCR_KEEP_DAYS = 60;
const OCR_MAX_PER_POST = 6;
// 알림장 그림은 대부분 아이 사진이라, 안내문을 붙였다는 말이 있거나 글이 짧을 때만 살핀다 (공지는 모두)
const DOC_HINT = /통신문|안내문|안내장|첨부|신청서|동의서|식단|참고해?\s*주|확인해?\s*주/;
const imgKey = (img) => String(img.id ?? (img.original || img.large || '').split('?')[0]);
const hhmm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
let prepRun = 0;
let ocrJob = Promise.resolve(); // 지금 하고 있는 그림 읽기
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
        addPost(`report:${r.id}`, { id: r.id, source: 'report', date: postYMD(r), title: '', content: r.content || '', images: r.attached_images || [] }, shortClass(e.class_name));
      }
      for await (const n of paginate(api.notices, args, { stop: (x) => postYMD(x) < since, maxPages: 5 })) {
        addPost(`notice:${n.id}`, { id: n.id, source: 'notice', date: postYMD(n), title: n.title || '', content: n.content || '', images: n.attached_images || [] }, shortClass(e.class_name));
      }
    }
  } catch (e) {
    if (e instanceof NotLoggedInError) return showLogin();
    return render(stateView('불러오지 못했어요', String(e.message || e)));
  }
  if (currentTab !== 'prep' || run !== prepRun) return;

  const loadedAt = new Date();
  const checked = await store.get(K.checked, {});
  const hidden = await store.get(K.hidden, {}); // "해당 없음"으로 지운 카드
  const justHidden = new Set(); // 이번에 지운 카드는 그 자리에 취소선으로 두고, 다음에 열 때 아래로 접는다
  const old = cutoffYMD(60);
  for (const [k, d] of Object.entries(hidden)) if (d < old) delete hidden[k];
  const ocr = await store.get(K.ocr, {}); // 그림 key → {at: 글 날짜, doc: 안내문이면 1, text: 읽은 글자}
  const status = h('span', { class: 'ocr-status' });
  const t = today();
  const multi = list.length > 1;
  const save = () => store.set(K.checked, checked);
  let view = await store.get(K.prepView, 'list'); // 'list' | 'cal'
  let calMonth = t.slice(0, 7), calDay = t;

  const draw = () => {
    for (const p of posts.values()) {
      p.docImages = p.images.filter((img) => ocr[imgKey(img)]?.doc);
      // 식단표·교육계획안이나 글자가 대부분 깨진 그림은 카드에 그림만 붙이고 챙길 것은 뽑지 않는다
      p.imgText = p.docImages
        .map((img) => ocr[imgKey(img)].text.split('\n').map(fixOcrLine).join('\n'))
        .filter((text) => isReadable(text) && !isReferenceDoc(text))
        .join('\n');
    }
    const all = buildCards([...posts.values()]);
    const cards = all.filter((c) => !hidden[c.key] || justHidden.has(c.key));
    const hiddenCards = all.filter((c) => hidden[c.key] && !justHidden.has(c.key));
    const setHidden = (c, on) => {
      if (on) { hidden[c.key] = c.date; justHidden.add(c.key); }
      else delete hidden[c.key];
      store.set(K.hidden, hidden);
      draw();
    };
    const upcoming = cards.filter((c) => c.date >= t);
    const past = cards.filter((c) => c.date < t && daysBetween(c.date, t) <= 7).reverse();
    // 챙길 것을 못 찾은 그림 안내문 카드는 "확인했어요" 하나로 체크
    const keysOf = (c) => (c.prep.length ? c.prep.map((_, i) => `${c.key}#${i}`) : c.images.length ? [`${c.key}#img`] : []);
    // checked[k]: true(챙김) | 'na'(우리 아이와 해당 없음). 둘 다 남은 개수에서 빠진다
    const setNa = (k, on) => {
      if (on) checked[k] = 'na';
      else delete checked[k];
      save();
      draw();
    };

    const groups = [
      ['오늘', (c) => c.date === t],
      ['내일', (c) => daysBetween(t, c.date) === 1],
      ['이번 주', (c) => { const d = daysBetween(t, c.date); return d >= 2 && d <= 7; }],
      ['그 이후', (c) => daysBetween(t, c.date) > 7],
    ];

    const soonKeys = upcoming.filter((c) => !hidden[c.key] && daysBetween(t, c.date) <= 1).flatMap(keysOf);
    const left = soonKeys.filter((k) => !checked[k]).length;

    const cardView = (c, showDday = true) => {
      const d = daysBetween(t, c.date);
      const dday = d === 0 ? '오늘' : d === 1 ? '내일' : d > 0 ? `D-${d}` : `${-d}일 전`;
      const keys = keysOf(c);
      const labels = c.prep.length ? c.prep : ['그림 안내문 확인했어요'];
      const el = h('article', { class: 'card' + (hidden[c.key] ? ' na' : keys.length && keys.every((k) => checked[k]) ? ' done' : '') },
        h('div', { class: 'card-head' },
          showDday ? h('span', { class: 'dday' }, dday) : null,
          h('span', { class: 'date' }, dateLabel(c.date) + (c.dateGuessed ? ' · 글 작성일' : '')),
          multi ? c.who.map((w) => h('span', { class: 'who' }, w)) : null,
          h('span', { class: 'badge' }, c.source === 'notice' ? '공지' : '알림장'),
          c.images.length ? h('span', { class: 'badge' }, '그림 안내문') : null,
          hidden[c.key]
            ? h('button', { class: 'linkbtn hide-btn', onclick: () => setHidden(c, false) }, '되돌리기')
            : h('button', { class: 'linkbtn hide-btn', title: '우리 아이와 상관없는 안내는 지워요. 다음부터는 맨 아래에 접혀 있어요', onclick: () => setHidden(c, true) }, '해당 없음'),
        ),
        c.title ? h('h3', {}, c.title) : null,
        c.events.length && !c.events[0].includes(c.title.replace('…', '')) ? h('div', { class: 'event' }, c.events[0]) : null,
        keys.length
          ? h('ul', { class: 'items' }, keys.map((k, i) => {
              const na = checked[k] === 'na';
              const li = h('li', { class: na ? 'na' : checked[k] ? 'checked' : '' },
                h('input', {
                  type: 'checkbox', checked: checked[k] === true, disabled: na, 'aria-label': labels[i],
                  onchange: (ev) => {
                    if (ev.target.checked) checked[k] = true;
                    else delete checked[k];
                    li.classList.toggle('checked', ev.target.checked);
                    el.classList.toggle('done', !hidden[c.key] && keys.every((x) => checked[x]));
                    save();
                  },
                }),
                h('span', {}, labels[i]),
                // 준비물 줄마다 "해당 없음" (예: 남아만, 신청한 아이만). 카드가 하나뿐이면 카드의 해당 없음으로 충분
                keys.length > 1 && !hidden[c.key]
                  ? h('button', { class: 'linkbtn na-btn', onclick: () => setNa(k, !na) }, na ? '되돌리기' : '해당 없음')
                  : null,
              );
              return li;
            }))
          : null,
        c.times.length ? h('div', { class: 'time' }, h('b', {}, '시간 '), c.times[0]) : null,
        c.images.length
          ? h('div', { class: 'doc-imgs' }, c.images.map((img) => h('a', { href: img.original || img.large, target: '_blank', rel: 'noopener', title: '크게 보기' },
              h('img', { src: img.large || img.original, alt: '안내문 그림', loading: 'lazy' }))))
          : null,
        c.imgText && (c.prep.length || c.events.length)
          ? h('p', { class: 'muted ocr-note' }, '그림에서 읽은 내용이 섞여 있어요. 글자를 잘못 읽었을 수 있으니 그림도 확인해 주세요.')
          : null,
        h('details', {}, h('summary', {}, '원문 보기'),
          c.content.trim() ? h('div', { class: 'raw' }, c.content) : null,
          c.imgText ? h('div', { class: 'raw' }, h('b', {}, '그림에서 읽은 글자'), '\n' + c.imgText) : null,
        ),
      );
      return el;
    };

    // 달력: 날짜 칸에 안내 제목을 보여주고, 날짜를 누르면 그날 카드를 아래에 펼친다
    const calendarView = () => {
      const byDate = new Map();
      for (const c of cards) {
        if (!byDate.has(c.date)) byDate.set(c.date, []);
        byDate.get(c.date).push(c);
      }
      const [y, m] = calMonth.split('-').map(Number);
      const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const doneOf = (c) => hidden[c.key] || (keysOf(c).length && keysOf(c).every((k) => checked[k]));
      const cells = Array.from({ length: lead }, () => h('div', { class: 'cal-cell empty' }));
      for (let d = 1; d <= days; d++) {
        const key = `${calMonth}-${String(d).padStart(2, '0')}`;
        const cs = byDate.get(key) || [];
        cells.push(h('button', {
          class: 'cal-cell' + (key === t ? ' today' : '') + (key === calDay ? ' sel' : '') + (cs.length ? ' has' : ''),
          'aria-label': `${m}월 ${d}일 안내 ${cs.length}건`,
          onclick: () => { calDay = key; draw(); },
        },
        h('span', { class: 'cal-d' }, d),
        cs.slice(0, 2).map((c) => h('span', { class: 'cal-item' + (doneOf(c) ? ' done' : '') }, c.title || c.events[0] || c.prep.join(', ') || '안내')),
        cs.length > 2 ? h('span', { class: 'cal-more' }, `+${cs.length - 2}`) : null));
      }
      const shift = (n) => {
        calMonth = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
        draw();
      };
      const sel = byDate.get(calDay) || [];
      return [
        h('div', { class: 'cal-nav' },
          h('button', { class: 'linkbtn', onclick: () => shift(-1) }, '‹ 이전 달'),
          h('b', {}, `${y}년 ${m}월`),
          h('button', { class: 'linkbtn', onclick: () => shift(1) }, '다음 달 ›')),
        h('div', { class: 'cal' }, WEEK.map((w) => h('div', { class: 'cal-w' }, w)), cells),
        h('div', { class: 'group-title' }, dateLabel(calDay), h('small', {}, `${sel.length}건`)),
        sel.length ? sel.map((c) => cardView(c)) : h('p', { class: 'muted' }, '이 날 안내가 없어요.'),
      ];
    };
    const setView = (v) => {
      view = v;
      store.set(K.prepView, v);
      draw();
    };

    const out = [];
    out.push(h('div', { class: 'prep-bar' },
      h('span', {}, `${hhmm(loadedAt)}에 확인`),
      status,
      h('span', { class: 'view-switch', role: 'group', 'aria-label': '보기 방식' },
        h('button', { class: 'linkbtn', 'aria-pressed': String(view === 'list'), onclick: () => setView('list') }, '목록'),
        h('button', { class: 'linkbtn', 'aria-pressed': String(view === 'cal'), onclick: () => setView('cal') }, '달력')),
      h('button', { class: 'linkbtn', onclick: () => showPrep() }, '새로고침'),
    ));
    out.push(h('p', { class: 'summary' },
      left ? h('span', {}, '오늘·내일 챙길 것 ', h('mark', {}, `${left}개`), '가 남았어요')
        : upcoming.length ? '오늘·내일 챙길 것은 모두 체크했어요' : '다가오는 준비물 안내가 없어요',
    ));
    if (view === 'cal') {
      out.push(...calendarView());
    } else for (const [name, fn] of groups) {
      const g = upcoming.filter(fn);
      if (!g.length) continue;
      out.push(h('div', { class: 'group-title' }, name, h('small', {}, `${g.length}건`)));
      g.forEach((c) => out.push(cardView(c, name !== '오늘' && name !== '내일')));
    }
    if (view === 'list' && past.length) {
      out.push(h('details', { class: 'past' }, h('summary', {}, `지난 7일 안내 ${past.length}건`), past.map((c) => cardView(c))));
    }
    if (hiddenCards.length) {
      out.push(h('details', { class: 'past' }, h('summary', {}, `해당 없는 안내 ${hiddenCards.length}건`), hiddenCards.map((c) => cardView(c))));
    }
    if (!cards.length) out.push(stateView('최근 30일 안에 챙길 것을 찾지 못했어요', '규칙으로 찾기 때문에 놓친 게 있을 수 있어요. 키즈노트 원문도 한 번 확인해 주세요.'));
    out.push(h('p', { class: 'muted', style: 'margin-top:18px' }, '※ 문장 규칙으로 자동 추출한 결과예요. 그림으로 온 안내문도 글자를 읽어 살피지만, 중요한 안내는 원문을 꼭 확인해 주세요.'));
    render(...out);
  };
  draw();

  // 아직 안 읽은 그림 읽기 (이 컴퓨터 안에서만). 다 읽으면 안내문이 있을 때만 다시 그린다.
  // 새로고침을 연달아 눌러도 앞의 읽기가 끝난 뒤 이어서 한다 (엔진은 하나)
  const prev = ocrJob;
  let release;
  ocrJob = new Promise((r) => (release = r));
  try {
    await prev;
    if (currentTab !== 'prep' || run !== prepRun) return;
    Object.assign(ocr, await store.get(K.ocr, {})); // 앞에서 읽은 결과 반영
    await readDocImages(run, posts, ocr, status, draw);
  } finally {
    release();
  }
}

async function readDocImages(run, posts, ocr, status, draw) {
  const todo = new Map(); // 그림 key → {p, img}
  for (const p of posts.values()) {
    if (p.source === 'report' && !DOC_HINT.test(p.content) && p.content.trim().length >= 80) continue;
    for (const img of p.images.slice(0, OCR_MAX_PER_POST)) {
      const k = imgKey(img);
      if (!(k in ocr) && !todo.has(k)) todo.set(k, { p, img });
    }
  }
  if (!todo.size) return;
  const { readImage, closeOcr } = await import('./lib/ocr.js'); // 필요할 때만 엔진을 불러온다
  let found = 0, i = 0;
  try {
    for (const [k, { p, img }] of todo) {
      if (currentTab !== 'prep' || run !== prepRun) break;
      status.textContent = `그림 안내문 확인 중 ${++i}/${todo.size}`;
      try {
        const r = await readImage(img.original || img.large);
        ocr[k] = r.doc ? { at: p.date, doc: 1, text: r.text } : { at: p.date };
        if (r.doc) found++;
      } catch { /* 받지 못한 그림은 다음에 다시 */ }
    }
  } finally {
    await closeOcr();
  }
  const cut = cutoffYMD(OCR_KEEP_DAYS);
  for (const [k, v] of Object.entries(ocr)) if (v.at < cut) delete ocr[k];
  await store.set(K.ocr, ocr);
  if (currentTab !== 'prep' || run !== prepRun) return;
  status.textContent = '';
  if (found) draw();
}

// ───────────────────────── 우리 애 사진 ─────────────────────────
// 판정: 1024px 사진에서 얼굴을 찾고, 사진 날짜와 가까운 시기의 기준 얼굴로 비교한 뒤
//       이번에 확인한 모든 얼굴의 점수 분포에서 "튀게 높은" 것만 우리 아이로 본다.
// 저장: 사진별 얼굴 점수(숫자)만 저장. 다른 아이들의 얼굴 특징값은 저장하지 않는다.
let stopRequested = false;
let photoState = null;
// 개발용 설치(압축 해제 로드)인지. 스토어 설치에는 update_url 이 있다
const DEV = !('update_url' in chrome.runtime.getManifest());

/** 사진 찾기 정확도 기록 (개발용): 처음 판정별로 Y/N 답 수만 남긴다. dev/eval.html 에서 본다 */
async function saveFaceLog(log) {
  const c = { sureYes: 0, sureNo: 0, maybeYes: 0, maybeNo: 0 };
  for (const [key, yes] of log.answers) c[`${log.first.get(key)}${yes ? 'Yes' : 'No'}`]++;
  // samples: 답한 사진마다 판정 숫자와 답 (어떤 숫자에서 맞고 틀리는지 분석용)
  const samples = [...log.answers].map(([key, yes]) => ({ kind: log.first.get(key), yes, ...log.info.get(key) }));
  const entry = { at: log.at, label: log.label, strictness: log.strictness, refs: log.refs, sure: log.sure, maybe: log.maybe, ...c, samples };
  const list = (await store.get(K.faceLog, [])).filter((x) => x.at !== log.at);
  await store.set(K.faceLog, [...list, entry].slice(-50));
}
const faceMem = new Map(); // 사진 id → 얼굴 특징값 (이 탭이 열려 있는 동안만, 저장 안 함)
const selSig = () => [...selected].sort().join(',');
const refsSig = (refs) => refs.map((r) => r.id).sort().join(',');

let lastPeriod = '최근 1개월'; // 사진 탭에서 고른 기간 (기준 얼굴을 고르고 돌아와도 유지)

async function showPhotos(flash = '') {
  const { REF_MIN, REF_GOAL, missingPeriods, searchRanges } = await import('./lib/match.js');
  const kids = kidsOf(selectedEnrollments());
  for (const k of kids) await upgradeRefs(k.child);
  const withRefs = [];
  const noRefs = [];
  const everyone = kidsOf(enrollments);
  for (const k of kids) {
    k.refs = await store.get(K.refs(k.child), []);
    k.periods = await periodsOf(k);
    k.others = [];
    for (const o of everyone) if (o.child !== k.child) k.others.push(...(await store.get(K.refs(o.child), [])));
    (k.refs.length >= REF_MIN ? withRefs : noRefs).push(k);
  }
  if (!withRefs.length) {
    return render(stateView(`먼저 아이 얼굴을 ${REF_MIN}개 이상 등록해 주세요`, `최근 사진 속 우리 아이 얼굴을 ${REF_GOAL}개 정도 고르면 가장 정확해요. 알림장 사진 속 얼굴을 눌러서 고를 수 있어요.`,
      h('button', { class: 'btn', onclick: () => showTab('faces') }, '기준 얼굴 등록하기')));
  }
  // 최근 기간 + 예전 1년 단위. 한 번에 최대 1년치만 찾는다 (사진을 한 장씩 살펴보므로 길면 몇 시간이 걸리고 서버에도 부담)
  const ranges = searchRanges(today(), withRefs[0].periods, !!withRefs[0].birth);
  const period = h('select', { 'aria-label': '기간' },
    ranges.slice(0, 5).map((r, i) => h('option', { value: i, selected: r.label === lastPeriod }, r.label)),
    ranges.length > 5 ? h('optgroup', { label: '예전 사진 (1년씩)' },
      ranges.slice(5).map((r, i) => h('option', { value: i + 5, selected: r.label === lastPeriod }, r.label))) : null,
  );
  const range = () => ranges[Number(period.value)];
  const runBtn = h('button', { class: 'btn' }, '우리 애 사진 찾기');
  const stopBtn = h('button', { class: 'btn ghost', hidden: true, onclick: () => { stopRequested = true; stopBtn.textContent = '멈추는 중…'; } }, '중지하고 지금까지 결과 보기');
  const status = h('div', { class: 'muted' }, flash ||
    `예전 반과 다른 기관 사진까지, 반과 상관없이 ${withRefs.map((k) => givenName(k.name)).join(', ')}의 사진을 찾아요.`);
  const warn = noRefs.length
    ? h('div', { class: 'muted', style: 'margin-top:4px' }, `${noRefs.map((k) => givenName(k.name)).join(', ')}는 기준 얼굴이 부족해서 이번엔 빠져요. `,
        h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); showTab('faces'); } }, '등록하기'))
    : null;
  // 고른 기간 안에 기준 얼굴이 부족한 시기가 있으면, 찾기 전에 그 시기 얼굴을 고르도록 안내한다
  const gaps = h('div');
  const drawGaps = () => {
    const { since, until, label } = range();
    lastPeriod = label;
    const rows = withRefs.flatMap((k) => missingPeriods(k.periods, k.refs, since, until).map((p) => ({ k, p })));
    const long = daysBetween(since, until) > 200;
    gaps.replaceChildren(...[
      rows.length ? h('div', { class: 'gaps' },
        h('b', {}, '이 기간에 기준 얼굴이 부족한 시기가 있어요'),
        h('p', { class: 'muted' }, `그 시기 사진은 놓치기 쉬워요. 시기마다 ${REF_MIN}개 이상(${REF_GOAL}개 정도면 더 좋아요) 골라 주시거나, 그대로 찾아도 돼요.`),
        // 키즈노트를 쓰기 전 시기까지 줄줄이 나오지 않게 최근 4개만 (나머지는 기준 얼굴 탭에서)
        h('div', { class: 'toolbar' }, rows.slice(0, 4).map(({ k, p }) => h('button', {
          class: 'btn ghost small',
          onclick: () => showPicker(k, p, (msg) => showPhotos(msg)),
        }, `${withRefs.length > 1 ? givenName(k.name) + ' ' : ''}${p.label} 고르기`)),
        rows.length > 4 ? h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); showTab('faces'); } }, `외 ${rows.length - 4}개 시기`) : null),
      ) : null,
      long ? h('div', { class: 'muted', style: 'margin-top:4px' }, '사진을 한 장씩 살펴보기 때문에 오래 걸릴 수 있어요. 중간에 멈추면 그때까지 찾은 결과를 보여드려요.') : null,
    ].filter(Boolean));
  };
  period.onchange = drawGaps;
  drawGaps();
  const bar = h('div', { class: 'progress', hidden: true }, h('div'));
  const results = h('div');
  runBtn.onclick = () => runSearch(range(), withRefs, { runBtn, stopBtn, status, bar, results });
  render(h('div', { class: 'toolbar' }, period, runBtn, stopBtn), status, warn, gaps, bar, results);
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
  const fb = fbOf(kid.child);
  // 사용자가 직접 고친 사진은 그대로 따른다
  const forced = new Map();
  for (const j of mine) {
    const key = `${kid.child}:${j.img.id}`;
    if (fb.pos.has(key)) forced.set(j.img.id, 3);
    if (fb.neg.has(key)) forced.set(j.img.id, 0);
  }
  const photos = mine.map((j) => ({ id: j.img.id, date: j.date, faces: faceMem.get(j.img.id) || [] }));
  const opts = {
    pos: [...fb.pos.values()].map((p) => ({ emb: p.emb, date: p.date })),
    neg: [...fb.neg.values()].map((n) => n.emb),
    forced,
    strictness,
    // 선생님이 이 아이에게 보낸 알림장 사진 (독사진은 기준 얼굴로 더한다)
    trusted: reports.map((j) => ({ id: j.img.id, date: j.date, faces: faceMem.get(j.img.id) || [] })),
    // 형제자매 기준 얼굴 (가장 닮은 아이라 그 아이와 더 닮은 얼굴은 우리 아이가 아니다)
    others: kid.others || [],
  };
  const res = matchLib.classifyPhotos(photos, kid.refs, opts);
  // 개발용: 1.0.1 방식 판정도 함께 남겨 Y/N 답으로 두 방식을 비교한다
  const old = DEV ? matchLib.classifyPhotos(photos, kid.refs, { ...opts, legacy: true }) : null;
  for (const j of mine) {
    const r = res.get(j.img.id);
    j.level = r.level;
    j.score = r.z;
    j.raw = r.raw;
    j.faceIdx = r.faceIdx;
    j.first = r.first;
    j.near = r.near;
    if (old) {
      j.legacy = old.get(j.img.id).level;
      j.levelNow = r.level;
      // 기존 방식은 찾았는데 새 방식이 뺀 사진도 Y/N을 받을 수 있게 확인 필요에 보인다 (개발용 설치에서만)
      if (j.legacy && !j.level) j.level = 1;
    }
  }
  return {
    child: kid.child,
    name: kid.name,
    // 알림장 사진 중 얼굴이 하나도 없는 것(안내문·배치도 등)은 따로. 아직 확인 못 한 사진은 사진으로 둔다
    reports: reports.filter((j) => faceMem.get(j.img.id)?.length !== 0).sort((a, b) => b.date.localeCompare(a.date)),
    notices: reports.filter((j) => faceMem.get(j.img.id)?.length === 0).sort((a, b) => b.date.localeCompare(a.date)),
    sure: mine.filter((j) => j.level === 3).sort((a, b) => b.date.localeCompare(a.date)),
    maybe: mine.filter((j) => j.level === 1).sort((a, b) => b.score - a.score).slice(0, 300),
    total: mine.length,
  };
}
let matchLib = null;

async function runSearch({ since, until, label }, kids, ui) {
  matchLib = await import('./lib/match.js');
  const { initFace, detectFaces } = await import('./lib/face.js');

  stopRequested = false;
  ui.runBtn.disabled = true;
  ui.stopBtn.hidden = false;
  ui.bar.hidden = false;
  ui.results.replaceChildren();
  const fill = ui.bar.firstChild;

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
        if (postYMD(r) > until) continue; // 최신순이라 고른 기간보다 새 글은 건너뛴다
        for (const img of r.attached_images || []) {
          if (seen.has(img.id)) continue;
          seen.add(img.id);
          reportJobs.push({ kid, img, title: '알림장', date: postYMD(r) });
        }
      }
      for await (const a of paginate(api.childAlbums, { child: kid.child }, { stop: (x) => postYMD(x) < since, maxPages: 100 })) {
        if (postYMD(a) > until) continue;
        for (const img of a.attached_images || []) {
          if (seen.has(img.id)) continue;
          seen.add(img.id);
          albumJobs.push({ kid, img, title: a.title || '앨범', date: postYMD(a) });
        }
        ui.status.textContent = `사진 목록을 모으는 중… ${reportJobs.length + albumJobs.length}장`;
      }
    }

    // 2) 앨범·알림장 사진 속 얼굴 찾기. 얼굴 특징값은 이 탭이 열려 있는 동안 메모리에만 두고 저장하지 않는다.
    //    얼굴을 찾는 동안 다음 사진 몇 장을 미리 받아 두어 다운로드 대기 시간을 줄인다.
    const PREFETCH = 6;
    // 알림장 사진도 얼굴을 확인해서, 얼굴이 없는 첨부(안내문·배치도 등)는 따로 모은다
    const todo = [...reportJobs, ...albumJobs].filter((j) => !faceMem.has(j.img.id));
    const total = reportJobs.length + albumJobs.length;
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
      ui.status.textContent = `사진 ${total.toLocaleString('ko-KR')}장 중 ${done.toLocaleString('ko-KR')}장 확인 · 시작 ${clock(started)} · ${eta}`;
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
        try { faces = (await detectFaces(blob)).map((f) => ({ emb: f.emb, size: f.size, score: f.score, box: f.nbox })); } catch { faces = []; }
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
    if (DEV) {
      // 처음 판정(고치기 전)을 기준으로 Y/N 답을 모아 정확도를 잰다 (숫자만, 개발용 설치에서만)
      const first = new Map();
      const info = new Map(); // 사진별 판정 숫자 (얼굴 정보·사진은 남기지 않는다)
      for (const g of groups) {
        for (const [kind, list] of [['sure', g.sure], ['maybe', g.maybe]]) {
          for (const j of list) {
            const key = `${g.child}:${j.img.id}`;
            const faces = faceMem.get(j.img.id) || [];
            const f = faces[j.faceIdx] || {};
            first.set(key, kind);
            info.set(key, {
              z: +j.score.toFixed(3), raw: +j.raw.toFixed(3), size: Math.round(f.size || 0), score: +(f.score ?? 1).toFixed(2), faces: faces.length, pass1: j.first,
              now: j.levelNow, legacy: j.legacy, near: j.near == null ? null : +j.near.toFixed(3),
            });
          }
        }
      }
      const refs = kids.reduce((n, k) => n + k.refs.length, 0);
      photoState.log = { at: Date.now(), label, strictness, refs, sure: groups.reduce((n, g) => n + g.sure.length, 0), maybe: groups.reduce((n, g) => n + g.maybe.length, 0), first, info, answers: new Map() };
    }
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
  const tiles = new Map(); // 사진 key → 목록의 칸

  /**
   * 사진 하나를 "우리 아이 맞음/아님"으로 표시하고, 고친 내용을 다음 판정용으로 기억한다.
   * idx: 우리 아이 얼굴 번호. 크게 보기에서 다른 얼굴을 누르면 그 얼굴로 바뀐다.
   * seen: 크게 보기에서 노란 네모(짚은 얼굴)를 보고 답했는지.
   *   "맞아요"는 seen일 때만 그 얼굴을 우리 아이로 배운다. 목록에서는 짚은 얼굴이 안 보여서, 단체사진이면
   *   옆 친구 얼굴을 우리 아이로 배우고 그 친구 사진이 줄줄이 들어오게 된다.
   *   "아니에요"는 짚은 얼굴이 우리 아이가 아니라는 뜻이라 어디서든 배운다.
   */
  const mark = (g, x, kind, yes, { idx = x.faceIdx, seen = false } = {}) => {
    const key = `${g.child}:${x.img.id}`;
    const fb = fbOf(g.child);
    const faces = faceMem.get(x.img.id) || [];
    const face = faces[idx];
    if (yes) {
      s.selected.add(key);
      fb.neg.delete(key);
      if (seen && face) {
        s.manual?.delete(key);
        fb.pos.set(key, { emb: face.emb, date: x.date });
        // 잘못 짚었던 얼굴은 "다른 아이"로 기억
        if (idx !== x.faceIdx && faces[x.faceIdx]) fb.neg.set(`${key}#${x.faceIdx}`, { emb: faces[x.faceIdx].emb });
        x.faceIdx = idx;
      } else if (!seen) {
        (s.manual ??= new Set()).add(key); // 배우지 않고 고르기만. 다시 찾아도 고른 상태 유지
      }
    } else {
      s.selected.delete(key);
      s.manual?.delete(key);
      fb.pos.delete(key);
      if (face) fb.neg.set(key, { emb: face.emb });
    }
    tiles.get(key)?.classList.toggle('sel', yes);
    updateCount();
    updateRefine();
    if (s.log?.first.has(key)) {
      s.log.answers.set(key, yes);
      saveFaceLog(s.log);
    }
  };

  const tile = (items, i) => {
    const { g, x, kind } = items[i];
    const key = `${g.child}:${x.img.id}`;
    const check = h('span', { class: 'check', title: s.selected.has(key) ? '빼기' : '고르기' }, '✓');
    const el = h('button', { class: 'tile' + (kind === 'maybe' ? ' maybe' : '') + (s.selected.has(key) ? ' sel' : ''), title: `${x.date} ${x.title} · 눌러서 크게 보기` },
      h('img', { src: x.img.small_resize || x.img.small, loading: 'lazy', alt: '' }),
      kind === 'maybe' ? h('span', { class: 'tag' }, '확인') : null,
      check,
    );
    check.onclick = (e) => {
      e.stopPropagation();
      mark(g, x, kind, !s.selected.has(key));
      check.title = s.selected.has(key) ? '빼기' : '고르기';
    };
    el.onclick = () => openViewer(items, i);
    tiles.set(key, el);
    return el;
  };

  // 크게 보기. 우리 아이로 본 얼굴에 노란 네모를 두르고 옆에 확대해서 보여준다. 다른 얼굴을 누르면 "이 아이가 우리 아이"
  const SECTION = { sure: '우리 아이', report: '알림장 사진', notice: '알림장 첨부 자료', maybe: '확인이 필요해요' };
  const faceZoom = (img, [bx, by, bw, bh]) => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const side = Math.max(bw * W, bh * H) * 1.8;
    const cx = (bx + bw / 2) * W, cy = (by + bh / 2) * H;
    const c = h('canvas', { width: 240, height: 240 });
    c.getContext('2d').drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, 240, 240);
    return c;
  };
  const openViewer = (items, start) => {
    let i = start;
    const info = h('div', { class: 'vw-info' });
    const state = h('span', { class: 'vw-state' });
    const closeBtn = h('button', { class: 'vw-close', 'aria-label': '닫기', title: '닫기 (Esc)' }, '✕');
    const prevBtn = h('button', { class: 'vw-nav', 'aria-label': '이전 사진', title: '이전 (←)' }, '‹');
    const nextBtn = h('button', { class: 'vw-nav', 'aria-label': '다음 사진', title: '다음 (→)' }, '›');
    const stage = h('div', { class: 'vw-stage' });
    const zoom = h('div', { class: 'vw-zoom' });
    const count = h('span', { class: 'vw-count' });
    const noBtn = h('button', { class: 'btn ghost vw-answer' }, h('kbd', {}, 'N'), '아니에요');
    const yesBtn = h('button', { class: 'btn vw-answer' }, h('kbd', {}, 'Y'), '맞아요');
    const key = (k, label) => h('span', { class: 'vw-key' }, h('kbd', {}, k), label);
    const view = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'vw-top' }, count, info, state, closeBtn),
      h('div', { class: 'vw-main' }, prevBtn, stage, zoom, nextBtn),
      h('div', { class: 'vw-bottom' }, noBtn, yesBtn,
        // 키보드로 빠르게: 크게 보여서 처음 보는 사람도 알 수 있게
        h('div', { class: 'vw-keys' }, key('Y', '맞아요'), key('N', '아니에요'), h('span', { class: 'vw-key' }, h('kbd', {}, '←'), h('kbd', {}, '→'), '넘기기'), key('Esc', '닫기')),
        h('div', { class: 'vw-hint' }, '답하면 다음 사진으로 넘어가요. 노란 네모가 다른 아이면 사진 속 우리 아이 얼굴을 눌러 주세요.')),
    );

    const show = () => {
      const { g, x, kind } = items[i];
      const key = `${g.child}:${x.img.id}`;
      const faces = faceMem.get(x.img.id) || [];
      const on = s.selected.has(key);
      count.textContent = `${i + 1} / ${items.length}`;
      info.textContent = `${SECTION[kind]} · ${x.date} ${x.title}`;
      state.textContent = on ? '✓ 고른 사진' : '고르지 않은 사진';
      state.classList.toggle('on', on);
      const img = h('img', { src: x.img.large || x.img.original, alt: '' });
      const boxes = faces.map((f, idx) => {
        if (!f.box) return null;
        const [bx, by, bw, bh] = f.box;
        const me = idx === x.faceIdx;
        const b = h('button', {
          class: 'vw-face' + (me ? ' me' : ''),
          title: me ? '우리 아이로 본 얼굴' : '이 아이가 우리 아이예요',
          style: `left:${bx * 100}%;top:${by * 100}%;width:${bw * 100}%;height:${bh * 100}%`,
        });
        b.onclick = () => { mark(g, x, kind, true, { idx, seen: true }); show(); };
        return b;
      });
      stage.replaceChildren(h('div', { class: 'vw-frame' }, img, boxes));
      const f = faces[x.faceIdx];
      zoom.replaceChildren();
      zoom.hidden = !f?.box;
      if (f?.box) img.addEventListener('load', () => zoom.replaceChildren(faceZoom(img, f.box), '우리 아이로 본 얼굴'), { once: true });
      prevBtn.disabled = i === 0;
      nextBtn.disabled = i === items.length - 1;
      const next = items[i + 1];
      if (next) new Image().src = next.x.img.large || next.x.img.original; // 다음 사진 미리 받기
    };
    const go = (d) => {
      const n = i + d;
      if (n < 0 || n >= items.length) return;
      i = n;
      show();
    };
    const answer = (yes) => {
      const { g, x, kind } = items[i];
      mark(g, x, kind, yes, { seen: true });
      if (i === items.length - 1) close();
      else go(1);
    };
    const onKey = (e) => {
      if (e.code === 'Escape') close();
      else if (e.code === 'ArrowRight') go(1);
      else if (e.code === 'ArrowLeft') go(-1);
      else if (e.code === 'KeyY') answer(true); // 한글 자판(ㅛ)에서도 같은 키
      else if (e.code === 'KeyN') answer(false); // (ㅜ)
      else return;
      e.preventDefault();
    };
    const close = () => {
      document.removeEventListener('keydown', onKey);
      view.remove();
      document.body.classList.remove('noscroll');
      const { g, x } = items[i];
      tiles.get(`${g.child}:${x.img.id}`)?.scrollIntoView({ block: 'nearest' });
    };
    closeBtn.onclick = close;
    prevBtn.onclick = () => go(-1);
    nextBtn.onclick = () => go(1);
    yesBtn.onclick = () => answer(true);
    noBtn.onclick = () => answer(false);
    view.onclick = (e) => { if (e.target === view || e.target === stage) close(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('noscroll');
    document.body.append(view);
    show();
  };
  const refineBtn = h('button', { class: 'btn ghost', hidden: true }, '');
  const updateRefine = () => {
    // 같은 사진에서 얼굴을 바꿔 고르면 pos와 neg가 함께 생기므로 사진 단위로 센다
    const n = s.groups.reduce((sum, g) => {
      const fb = fbOf(g.child);
      return sum + new Set([...fb.pos.keys(), ...fb.neg.keys()].map((k) => k.split('#')[0])).size;
    }, 0);
    refineBtn.hidden = !n;
    refineBtn.textContent = `고친 ${n}장을 반영해서 다시 찾기`;
  };
  refineBtn.onclick = async () => {
    const strictness = await store.get(K.strictness, 0.5);
    s.groups = s.kids.map((kid) => classifyKid(kid, s.jobs.albumJobs.filter((j) => j.kid === kid), s.jobs.reportJobs.filter((j) => j.kid === kid), strictness));
    // 선택 상태도 새 판정에 맞춘다 (직접 고친 것은 유지)
    s.selected = new Set(s.groups.flatMap((g) => [...g.reports, ...g.sure].map((j) => `${g.child}:${j.img.id}`)));
    // 목록에서 체크로 고른 사진(배우지 않은 것)도 고른 상태 유지
    for (const k of s.manual || []) s.selected.add(k);
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
      const items = list.map((x) => ({ g, x, kind }));
      const review = h('button', { class: 'linkbtn' }, '하나씩 크게 보기');
      review.onclick = () => openViewer(items, 0);
      nodes.push(h('div', { class: 'section-label' }, `${who}${title}`, h('small', {}, `${list.length}장 · ${note}`), review));
      nodes.push(h('div', { class: 'grid' }, items.map((_, i) => tile(items, i))));
    };
    block('우리 아이', '사진을 누르면 크게 보여요. 아닌 사진은 체크를 눌러 빼 주세요', g.sure, 'sure');
    block('알림장 사진', '선생님이 우리 아이에게 보낸 사진', g.reports, 'report');
    block('알림장 첨부 자료', '얼굴이 없는 사진(안내문·배치도 등) · 필요하면 체크해서 받으세요', g.notices, 'notice');
    block('확인이 필요해요', '하나씩 크게 보며 Y/N으로 고르면, 노란 네모 얼굴을 우리 아이로 배워서 다시 찾을 때 반영돼요', g.maybe, 'maybe');
    if (multi && !g.sure.length && !g.maybe.length && !g.reports.length && !g.notices.length) {
      nodes.push(h('div', { class: 'section-label' }, givenName(g.name), h('small', {}, '찾은 사진이 없어요')));
    }
  }
  const all = s.groups.flatMap((g) => [...g.sure, ...g.reports, ...g.notices, ...g.maybe].map((x) => ({ g, x })));
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

/** 아이의 6개월 단위 시기 목록 (최근부터). 생년월일을 모르면 오늘부터 거슬러 올라간다 */
async function periodsOf(kid) {
  const { agePeriods, recentPeriods } = await import('./lib/match.js');
  return kid.birth ? agePeriods(kid.birth, today(), 8) : recentPeriods(today(), 4);
}

async function showFaces(flash = '') {
  const { REF_MIN, REF_GOAL } = await import('./lib/match.js');
  const kids = kidsOf(enrollments);
  const kid = kids.find((k) => k.child === currentKid) || kids[0];
  const lost = await upgradeRefs(kid.child);
  if (lost && !flash) flash = `예전 기준 얼굴 ${lost}개는 새 방식으로 바꾸지 못해서 지웠어요. 그 시기 얼굴을 다시 골라 주세요.`;
  const refs = await store.get(K.refs(kid.child), []);
  const strictness = await store.get(K.strictness, 0.5);
  const msg = h('div', { class: 'muted' }, flash);
  const periods = await periodsOf(kid);
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

  const periodRow = (p) => {
    const mine = refs.filter((r) => inPeriod(r, p));
    return h('div', { class: 'period' + (mine.length < REF_MIN ? ' need' : '') },
      h('div', { class: 'period-head' },
        h('b', {}, p.label),
        h('span', { class: 'muted' }, `${p.start.replaceAll('-', '.')} ~ ${p.end.replaceAll('-', '.')}`),
        h('span', { class: 'count' }, mine.length >= REF_GOAL ? `${mine.length}개 ✓` : `${mine.length}/${REF_GOAL}개`),
      ),
      mine.length ? h('div', { class: 'refs' }, mine.map(refChip)) : null,
      h('button', { class: 'btn ghost small', onclick: () => showPicker(kid, p) }, '이 시기 사진에서 고르기'),
    );
  };
  // 처음엔 가장 최근 시기만 보이고, 예전 시기는 등록한 얼굴이 있는 것만 펼쳐 둔다
  const shown = periods.filter((p, i) => i === 0 || refs.some((r) => inPeriod(r, p)));
  const folded = periods.filter((p) => !shown.includes(p));
  const first = !refs.length;

  render(
    h('section', { class: 'panel' },
      h('h2', {}, `${kid.name}의 기준 얼굴`),
      h('p', { class: 'muted' }, first
        ? `처음이라면 가장 최근 시기에서 우리 아이 얼굴을 ${REF_GOAL}개 정도 골라 주세요. ${REF_MIN}개만 있어도 바로 사진을 찾을 수 있어요.`
        : `아이 얼굴은 금방 바뀌어서, 시기마다 ${REF_GOAL}개 정도 있으면 가장 정확해요. 사진을 찾을 때는 그 사진 날짜와 가까운 시기의 얼굴로 비교해요.`),
      h('div', { class: 'periods' }, shown.map(periodRow)),
      folded.length ? h('details', { class: 'past' },
        h('summary', {}, `예전 시기 ${folded.length}개 · 옛날 사진도 찾으려면 그때 얼굴을 골라 주세요`),
        h('div', { class: 'periods' }, folded.map(periodRow))) : null,
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
async function showPicker(kid, p, done = (flash) => showFaces(flash)) {
  const { detectFaces, initFace, MODEL_ID } = await import('./lib/face.js');
  const { REF_GOAL } = await import('./lib/match.js');
  const status = h('div', { class: 'muted' }, `${p.label} 사진을 찾는 중…`);
  const grid = h('div', { class: 'faces' });
  const picked = new Map();
  const saveBtn = h('button', { class: 'btn', disabled: true }, '선택한 얼굴 등록');
  const back = h('button', { class: 'btn ghost small', onclick: () => done() }, '← 돌아가기');
  render(back, h('h2', { style: 'margin:14px 0 4px' }, `${kid.name} · ${p.label}`),
    h('p', { class: 'muted' }, `${p.start.replaceAll('-', '.')} ~ ${p.end.replaceAll('-', '.')} 사진 속 얼굴이에요. 우리 아이 얼굴을 ${REF_GOAL}개 정도 눌러 주세요.`),
    h('ul', { class: 'guide' },
      h('li', {}, h('b', {}, '가운데 얼굴만 봐요. '), '칸마다 가운데 얼굴 하나만 기준이 돼요. 친구들과 같이 찍은 사진이라도 가운데가 우리 아이면 골라도 돼요.'),
      h('li', {}, h('b', {}, '골고루 섞어 주세요. '), '정면 독사진에 단체사진 속 얼굴, 살짝 옆모습을 1~2개 섞으면 단체사진에서도 더 잘 찾아요.'),
      h('li', {}, h('b', {}, '이런 얼굴은 빼 주세요. '), '가장자리에 잘린 얼굴, 다른 아이와 겹친 얼굴, 손이나 물건에 많이 가려진 얼굴, 완전히 옆으로 돌린 얼굴.'),
    ),
    status, grid, h('div', { class: 'dock' }, h('span', {}, '우리 아이 얼굴만 골라 주세요'), saveBtn));
  saveBtn.onclick = async () => {
    await saveRefs(kid.child, [...picked.values()]);
    done(`${picked.size}개 등록했어요`);
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
