import { api, paginate, currentEnrollments, NotLoggedInError } from './lib/api.js';
import { buildCards, ymd } from './lib/extract.js';
import { store, K } from './lib/store.js';

const main = document.getElementById('main');
const classBar = document.getElementById('classBar');
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

let enrollments = []; // 지금 다니는 모든 반 (아이 × 반)
let selected = new Set(); // 선택한 소속 id
let currentTab = 'prep';
let faceKid = null; // 기준 얼굴 탭에서 보고 있는 아이 id

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
  main.replaceChildren(...nodes);
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
const label = (e) => `${givenName(e.child_name)}·${shortClass(e.class_name)}`;
const selectedEnrollments = () => enrollments.filter((e) => selected.has(e.id));
/** 아이 목록 (중복 제거). onlySelected 면 선택된 반이 있는 아이만 */
function kidsOf(list) {
  const m = new Map();
  for (const e of list) if (!m.has(e.child)) m.set(e.child, { child: e.child, name: e.child_name, picture: e.child_picture, enrollments: [] });
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
  drawClassBar();
  showTab('prep');
}

function drawClassBar() {
  if (enrollments.length < 2) return;
  classBar.hidden = false;
  classBar.replaceChildren(...enrollments.map((e) => {
    const b = h('button', { class: 'chip', 'aria-pressed': String(selected.has(e.id)), title: `${e.child_name} · ${e.class_name}` },
      h('b', {}, givenName(e.child_name)), shortClass(e.class_name));
    b.onclick = async () => {
      if (selected.has(e.id)) {
        if (selected.size === 1) return; // 최소 하나는 선택
        selected.delete(e.id);
      } else selected.add(e.id);
      b.setAttribute('aria-pressed', String(selected.has(e.id)));
      await store.set(K.selected, [...selected]);
      if (currentTab !== 'faces') showTab(currentTab);
    };
    return b;
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
        addPost(`report:${r.id}`, { id: r.id, source: 'report', date: postYMD(r), title: '', content: r.content || '' }, label(e));
      }
      for await (const n of paginate(api.notices, args, { stop: (x) => postYMD(x) < since, maxPages: 5 })) {
        addPost(`notice:${n.id}`, { id: n.id, source: 'notice', date: postYMD(n), title: n.title || '', content: n.content || '' }, label(e));
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
  const cardView = (c) => {
    const d = daysBetween(t, c.date);
    const dday = d === 0 ? '오늘' : d === 1 ? '내일' : d > 0 ? `D-${d}` : `${-d}일 전`;
    const keys = c.prep.map((_, i) => `${c.key}#${i}`);
    const el = h('article', { class: 'card' + (keys.length && keys.every((k) => checked[k]) ? ' done' : '') },
      h('div', { class: 'card-head' },
        h('span', { class: 'dday' }, dday),
        h('span', { class: 'date' }, dateLabel(c.date) + (c.dateGuessed ? ' · 글 작성일' : '')),
        multi ? c.who.map((w) => h('span', { class: 'who' }, w)) : null,
        h('span', { class: 'badge' }, c.source === 'notice' ? '공지' : '알림장'),
      ),
      c.title ? h('h3', {}, c.title) : null,
      c.events.length ? h('div', { class: 'event' }, '📅 ' + c.events[0]) : null,
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
      c.times.length ? h('div', { class: 'time' }, '⏰ ' + c.times[0]) : null,
      h('details', {}, h('summary', {}, '원문 보기'), h('div', { class: 'raw' }, c.content)),
    );
    return el;
  };

  const out = [];
  out.push(h('div', { class: 'hero' },
    h('span', { class: 'big' }, left ? `${left}개` : '준비 끝!'),
    h('span', {}, left ? '오늘·내일 챙길 것이 남았어요' : upcoming.length ? '오늘·내일 챙길 것은 모두 체크했어요' : '다가오는 준비물 안내가 없어요'),
  ));
  for (const [name, fn] of groups) {
    const g = upcoming.filter(fn);
    if (!g.length) continue;
    out.push(h('div', { class: 'group-title' }, name, h('small', {}, `${g.length}건`)));
    g.forEach((c) => out.push(cardView(c)));
  }
  if (past.length) {
    out.push(h('details', { class: 'past' }, h('summary', {}, `지난 7일 안내 ${past.length}건`), past.map(cardView)));
  }
  if (!cards.length) out.push(stateView('최근 30일 안에 챙길 것을 찾지 못했어요', '규칙으로 찾기 때문에 놓친 게 있을 수 있어요. 키즈노트 원문도 한 번 확인해 주세요.'));
  out.push(h('p', { class: 'muted', style: 'margin-top:18px' }, '※ 문장 규칙으로 자동 추출한 결과예요. 중요한 안내는 원문을 꼭 확인해 주세요.'));
  render(...out);
}

// ───────────────────────── 우리 애 사진 ─────────────────────────
// photoState = { sig, th, groups:[{child, name, sure:[], maybe:[]}], selected:Set('child:imgId') }
let photoState = null;
const selSig = () => [...selected].sort().join(',');

async function showPhotos() {
  const kids = kidsOf(selectedEnrollments());
  const withRefs = [];
  const noRefs = [];
  for (const k of kids) {
    k.refs = await store.get(K.refs(k.child), []);
    (k.refs.length ? withRefs : noRefs).push(k);
  }
  if (!withRefs.length) {
    return render(stateView('먼저 아이 얼굴을 등록해 주세요', '기준 얼굴이 있어야 단체사진 속에서도 우리 아이를 찾을 수 있어요.',
      h('button', { class: 'btn', onclick: () => { faceKid = kids[0].child; showTab('faces'); } }, '기준 얼굴 등록하기')));
  }
  const period = h('select', { 'aria-label': '기간' },
    h('option', { value: '14' }, '최근 2주'),
    h('option', { value: '30', selected: true }, '최근 1개월'),
    h('option', { value: '90' }, '최근 3개월'),
    h('option', { value: '0' }, '전체'),
  );
  const runBtn = h('button', { class: 'btn' }, '우리 애 사진 찾기');
  const status = h('div', { class: 'muted' },
    `${withRefs.map((k) => givenName(k.name)).join(', ')}의 사진을 찾아요. 처음 한 번은 시간이 걸리고, 다음부터는 새 사진만 확인해요.`);
  const warn = noRefs.length
    ? h('div', { class: 'muted', style: 'margin-top:4px' }, `${noRefs.map((k) => givenName(k.name)).join(', ')}는 기준 얼굴이 없어서 이번엔 빠져요. `,
        h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); faceKid = noRefs[0].child; showTab('faces'); } }, '등록하기'))
    : null;
  const bar = h('div', { class: 'progress', hidden: true }, h('div'));
  const results = h('div');
  runBtn.onclick = () => runSearch(Number(period.value), withRefs, { runBtn, status, bar, results });
  render(h('div', { class: 'toolbar' }, period, runBtn), status, warn, bar, results);
  if (photoState && photoState.sig === selSig()) drawResults(results);
}

async function runSearch(days, kids, ui) {
  const { initFace, scoreImage } = await import('./lib/face.js');
  ui.runBtn.disabled = true;
  ui.bar.hidden = false;
  ui.results.replaceChildren();
  const fill = ui.bar.firstChild;
  const since = cutoffYMD(days);

  try {
    ui.status.textContent = '얼굴 인식 모델을 준비하는 중…';
    await initFace();

    // 1) 아이별로 선택된 반의 앨범 + 알림장 사진 모으기 (같은 사진은 한 번만)
    ui.status.textContent = '사진 목록을 모으는 중…';
    const jobs = []; // {kid, img, title, date}
    for (const kid of kids) {
      const seen = new Set();
      const add = (post, kind) => {
        for (const img of post.attached_images || []) {
          if (seen.has(img.id)) continue;
          seen.add(img.id);
          jobs.push({ kid, img, title: post.title || (kind === 'report' ? '알림장' : '앨범'), date: postYMD(post) });
        }
      };
      for (const e of kid.enrollments) {
        const args = argsOf(e);
        for await (const a of paginate(api.albums, args, { stop: (x) => postYMD(x) < since, maxPages: 200 })) add(a, 'album');
        for await (const r of paginate(api.reports, args, { stop: (x) => postYMD(x) < since, maxPages: 200 })) add(r, 'report');
      }
      ui.status.textContent = `사진 목록을 모으는 중… ${jobs.length}장`;
    }

    // 2) 썸네일로 아이별 얼굴 점수 (이미 본 사진은 캐시 사용)
    const cache = new Map();
    for (const kid of kids) cache.set(kid.child, await store.get(K.scores(kid.child), {}));
    let done = 0;
    let dirty = 0;
    const flush = () => Promise.all(kids.map((k) => store.set(K.scores(k.child), cache.get(k.child))));
    const queue = jobs.slice();
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        const scores = cache.get(it.kid.child);
        if (scores[it.img.id] === undefined) {
          try {
            const r = await scoreImage(it.img.small_resize || it.img.small || it.img.large, it.kid.refs);
            scores[it.img.id] = Math.round(r.score * 1000) / 1000;
          } catch {
            scores[it.img.id] = 0;
          }
          if (++dirty >= 20) { dirty = 0; flush(); }
        }
        it.score = scores[it.img.id];
        done++;
        fill.style.width = `${(done / jobs.length) * 100}%`;
        ui.status.textContent = `${jobs.length}장 중 ${done}장 확인`;
      }
    };
    await Promise.all([worker(), worker()]);
    await flush();

    const th = await store.get(K.threshold, { sure: 0.55, maybe: 0.45 });
    const groups = kids.map((kid) => {
      const mine = jobs.filter((j) => j.kid === kid && j.score >= th.maybe).sort((a, b) => b.date.localeCompare(a.date));
      return { child: kid.child, name: kid.name, sure: mine.filter((j) => j.score >= th.sure), maybe: mine.filter((j) => j.score < th.sure) };
    });
    photoState = {
      sig: selSig(),
      th,
      groups,
      selected: new Set(groups.flatMap((g) => g.sure.map((j) => `${g.child}:${j.img.id}`))),
    };
    drawResults(ui.results);
    ui.status.textContent = `전체 ${jobs.length}장 확인 · ` + groups.map((g) => `${givenName(g.name)} ${g.sure.length + g.maybe.length}장`).join(' · ');
  } catch (e) {
    if (e instanceof NotLoggedInError) return showLogin();
    ui.status.textContent = '오류: ' + (e.message || e);
  } finally {
    ui.runBtn.disabled = false;
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
  const tile = (g, x, isMaybe) => {
    const key = `${g.child}:${x.img.id}`;
    const el = h('button', { class: 'tile' + (isMaybe ? ' maybe' : '') + (s.selected.has(key) ? ' sel' : ''), title: `${x.date} ${x.title}` },
      h('img', { src: x.img.small_resize || x.img.small, loading: 'lazy', alt: '' }),
      isMaybe ? h('span', { class: 'tag' }, '확인') : null,
      h('span', { class: 'check' }, '✓'),
    );
    el.onclick = () => {
      if (s.selected.has(key)) s.selected.delete(key);
      else s.selected.add(key);
      el.classList.toggle('sel');
      updateCount();
    };
    if (isMaybe) {
      const add = h('span', { class: 'addref', role: 'button' }, '+기준에 추가');
      add.onclick = async (ev) => {
        ev.stopPropagation();
        add.textContent = '추가 중…';
        const ok = await addReference(g.child, x.img.large || x.img.original);
        add.textContent = ok ? '추가됨' : '얼굴 없음';
      };
      el.append(add);
    }
    return el;
  };

  const multi = s.groups.length > 1;
  const nodes = [];
  for (const g of s.groups) {
    const who = multi ? `${givenName(g.name)} · ` : '';
    if (g.sure.length) {
      nodes.push(h('div', { class: 'section-label' }, `${who}우리 아이`, h('small', {}, `${g.sure.length}장 · 자동 선택`)));
      nodes.push(h('div', { class: 'grid' }, g.sure.map((x) => tile(g, x, false))));
    }
    if (g.maybe.length) {
      nodes.push(h('div', { class: 'section-label' }, `${who}확인이 필요해요`, h('small', {}, `${g.maybe.length}장 · 맞으면 눌러서 선택`)));
      nodes.push(h('div', { class: 'grid' }, g.maybe.map((x) => tile(g, x, true))));
    }
    if (multi && !g.sure.length && !g.maybe.length) {
      nodes.push(h('div', { class: 'section-label' }, `${givenName(g.name)}`, h('small', {}, '찾은 사진이 없어요')));
    }
  }
  const total = s.groups.reduce((n, g) => n + g.sure.length + g.maybe.length, 0);
  dlBtn.onclick = () => {
    const picked = s.groups.flatMap((g) => [...g.sure, ...g.maybe]
      .filter((x) => s.selected.has(`${g.child}:${x.img.id}`))
      .map((x) => ({ ...x, folder: multi ? givenName(g.name) : '' })));
    downloadZip(picked, dlBtn);
  };
  nodes.push(total ? h('div', { class: 'dock' }, countEl, dlBtn) : stateView('찾은 사진이 없어요', '기준 얼굴을 더 추가하거나 기간을 늘려보세요.'));
  container.replaceChildren(...nodes);
  updateCount();
}

async function downloadZip(list, btn) {
  const CHUNK = 200; // 브라우저 메모리를 위해 200장씩 나눠서 압축
  const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
  btn.disabled = true;
  try {
    for (let part = 0; part * CHUNK < list.length; part++) {
      const zip = new JSZip();
      const slice = list.slice(part * CHUNK, (part + 1) * CHUNK);
      let n = 0;
      const queue = slice.map((x, i) => ({ x, i }));
      const worker = async () => {
        while (queue.length) {
          const { x, i } = queue.shift();
          const res = await fetch(x.img.original || x.img.large);
          const ext = (x.img.original_file_name || '').split('.').pop() || 'jpg';
          const dir = x.folder ? `${x.folder}/` : '';
          zip.file(`${dir}${x.date}_${safe(x.title)}_${String(part * CHUNK + i + 1).padStart(3, '0')}.${ext}`, await res.blob());
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
    btn.textContent = '다운로드 완료';
  } catch (e) {
    btn.textContent = '다시 시도';
    main.prepend(h('div', { class: 'hero', style: 'background:var(--warn-soft)' }, '다운로드 중 오류: ' + (e.message || e)));
  } finally {
    btn.disabled = false;
  }
}

// ───────────────────────── 기준 얼굴 (아이별) ─────────────────────────
async function addReference(childId, src) {
  const { makeReference } = await import('./lib/face.js');
  const ref = await makeReference(src);
  if (!ref) return false;
  const refs = await store.get(K.refs(childId), []);
  refs.push(ref);
  await store.set(K.refs(childId), refs);
  await store.remove(K.scores(childId)); // 기준이 바뀌면 점수 다시 계산
  return true;
}

async function showFaces(flash = '') {
  const kids = kidsOf(enrollments);
  const kid = kids.find((k) => k.child === faceKid) || kids[0];
  faceKid = kid.child;
  const refs = await store.get(K.refs(kid.child), []);
  const th = await store.get(K.threshold, { sure: 0.55, maybe: 0.45 });
  const msg = h('div', { class: 'muted' }, flash);

  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.onchange = async () => {
    const files = [...fileInput.files];
    let ok = 0, fail = 0;
    for (const [i, f] of files.entries()) {
      msg.textContent = `얼굴 찾는 중… ${i + 1}/${files.length}`;
      (await addReference(kid.child, f)) ? ok++ : fail++;
    }
    photoState = null;
    showFaces(`${ok}장 등록${fail ? `, ${fail}장은 얼굴을 찾지 못했어요` : ''}`);
  };

  const profileUrl = kid.picture && (kid.picture.large || kid.picture.original);
  const slider = h('input', { type: 'range', min: '0.45', max: '0.65', step: '0.01', value: String(th.sure) });
  slider.onchange = async () => {
    const sure = Number(slider.value);
    await store.set(K.threshold, { sure, maybe: Math.round((sure - 0.1) * 100) / 100 });
    photoState = null;
  };

  render(
    kids.length > 1
      ? h('div', { class: 'kid-tabs' }, kids.map((k) => h('button', {
          class: 'chip', 'aria-pressed': String(k.child === kid.child),
          onclick: () => { faceKid = k.child; showFaces(); },
        }, givenName(k.name))))
      : null,
    h('section', { class: 'panel' },
      h('h2', {}, `${kid.name}의 기준 얼굴`),
      h('p', { class: 'muted' }, '정면·옆모습, 최근 사진 위주로 5~20장 정도가 좋아요. 아이 얼굴은 금방 바뀌니 가끔 새 사진을 추가해 주세요.'),
      refs.length
        ? h('div', { class: 'refs' }, refs.map((r) => h('div', { class: 'ref' },
            h('img', { src: r.thumb, alt: '' }),
            h('button', { onclick: async () => {
              const next = (await store.get(K.refs(kid.child), [])).filter((x) => x.id !== r.id);
              await store.set(K.refs(kid.child), next);
              await store.remove(K.scores(kid.child));
              photoState = null;
              showFaces();
            } }, '삭제'),
          )))
        : h('p', {}, '아직 등록된 얼굴이 없어요.'),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: () => fileInput.click() }, '사진 파일로 추가'),
        profileUrl ? h('button', { class: 'btn ghost', onclick: async () => {
          msg.textContent = '프로필 사진에서 얼굴 찾는 중…';
          const ok = await addReference(kid.child, profileUrl);
          photoState = null;
          if (ok) showFaces('프로필 사진에서 얼굴을 등록했어요'); else msg.textContent = '프로필 사진에서 얼굴을 찾지 못했어요';
        } }, '키즈노트 프로필 사진으로 추가') : null,
        fileInput,
      ),
      msg,
    ),
    h('section', { class: 'panel' },
      h('h2', {}, '찾는 기준'),
      h('div', { class: 'slider' }, h('span', { class: 'muted' }, '많이 찾기'), slider, h('span', { class: 'muted' }, '정확하게')),
      h('p', { class: 'muted' }, '많이 찾기 쪽은 놓치는 사진이 줄지만 다른 아이가 섞일 수 있어요. 애매한 사진은 "확인이 필요해요"에 따로 모아 보여드려요.'),
    ),
    h('section', { class: 'panel' },
      h('h2', {}, '내 데이터'),
      h('p', { class: 'muted' }, '기준 얼굴, 체크 상태, 사진 점수는 이 브라우저에만 저장돼요. 다른 아이들의 얼굴 정보는 비교 직후 버려지고 저장되지 않아요.'),
      h('button', { class: 'btn ghost small', onclick: async () => {
        if (!confirm(`${kid.name}의 기준 얼굴과 사진 점수를 모두 지울까요?`)) return;
        await Promise.all([store.remove(K.refs(kid.child)), store.remove(K.scores(kid.child))]);
        photoState = null;
        showFaces();
      } }, `${givenName(kid.name)} 데이터 모두 지우기`),
    ),
  );
}

boot();
