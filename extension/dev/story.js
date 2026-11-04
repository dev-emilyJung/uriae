// 성장 기록 시안 (개발용, 배포 zip에는 포함하지 않음)
// 아이의 알림장을 기간만큼 읽어, 선생님 글에서 공지성 문장만 빼고 날짜별 타임라인 책으로 보여준다.
// 알림장과 사진은 이 브라우저 안에서만 읽고 그린다. PDF는 브라우저 인쇄의 "PDF로 저장"으로 만든다.
import { api, paginate, NotLoggedInError } from '../lib/api.js';
import { ymd } from '../lib/extract.js';
import { store } from '../lib/store.js';
import { buildStory, ageLabel, MONTH_TITLE, byParent, joinParts, norm } from './story-rules.js';

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const postYMD = (x) => (x.date_written ? String(x.date_written).slice(0, 10) : ymd(new Date(x.created)));
const WEEK = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const dayLabel = (d) => {
  const [y, m, dd] = d.split('-').map(Number);
  return `${m}월 ${dd}일 ${WEEK[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}`;
};
const dotDate = (d) => d.replaceAll('-', '. ') + '.';
const src = (img) => img.large || img.original || img.small;
// 사진은 칸에 맞춰 잘리므로, 얼굴이 있는 곳을 가운데로 둔다 (얼굴 위치는 이 컴퓨터에서 찾아 저장)
const FOCUS = 'dev:storyFocus'; // {"사진 id": "x% y%"}
let focus = {};
const smallUrl = new Map(); // 사진 id → 줄인 사진의 blob 주소 (shrink)
const photo = (img, cls = 'ph') => h('img', {
  class: cls, src: smallUrl.get(imgId(img)) || src(img), 'data-orig': src(img), alt: '', loading: 'lazy',
  'data-id': imgId(img), style: `object-position:${focus[imgId(img)] || '50% 30%'}`,
});
// "박선우" → "선우" (두 글자 이름은 그대로)
const givenName = (n = '') => (n.length === 3 ? n.slice(1) : n);
// 값 대신 모양만 (이름·글 내용은 화면에 안 띄운다. "parent" 같은 영문 종류 값과 숫자·참거짓만 그대로)
const shape = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
  Array.isArray(v) ? `배열 ${v.length}` : v && typeof v === 'object' ? shape(v)
    : typeof v === 'string' ? (/^[a-z_]{1,20}$/i.test(v) ? v : `글 ${v.length}자`) : v]));

// 직접 뺀 날·문장 (이 브라우저에만 저장)
const CUT = 'dev:storyCut'; // {"알림장id": true(그날 전체) | ["문장 키", …]}
let cut = {};
const CUT_PHOTO = 'dev:storyCutPhotos'; // {"사진 id": true}
let cutPhotos = {};
const imgId = (p) => String(p.id ?? src(p).split('?')[0]);
// 진행 막대: 지금 하는 일, 비율, 남은 시간 (지금까지 걸린 시간으로 어림)
function progress(label, frac, startedAt) {
  const box = $('progress');
  if (frac == null) { box.hidden = true; return; }
  box.hidden = false;
  const pct = Math.max(2, Math.min(100, Math.round(frac * 100)));
  box.querySelector('.fill').style.width = `${pct}%`;
  box.querySelector('.track').setAttribute('aria-valuenow', pct);
  let eta = '';
  const spent = (Date.now() - startedAt) / 1000;
  if (frac > 0.05 && spent > 3) {
    const left = Math.round(spent / frac - spent);
    eta = left < 10 ? ' · 곧 끝나요' : left < 60 ? ` · 약 ${Math.ceil(left / 10) * 10}초 남음` : ` · 약 ${Math.ceil(left / 60)}분 남음`;
  }
  box.querySelector('.label').textContent = `${label} ${pct}%${eta}`;
}

let kids = [];
let book = null; // {kid, name, days, reportCount, parentCount}
let editing = false;

async function boot() {
  try {
    cut = await store.get(CUT, {});
    cutPhotos = await store.get(CUT_PHOTO, {});
    focus = await store.get(FOCUS, {});
    const list = await api.enrollments();
    const m = new Map();
    for (const e of list) {
      const k = m.get(e.child) || { child: e.child, name: e.child_name, birth: e.child_birth ? String(e.child_birth).slice(0, 10) : null, classes: [] };
      k.classes.push({ name: e.class_name, created: e.created });
      m.set(e.child, k);
    }
    kids = [...m.values()];
    $('kid').replaceChildren(...kids.map((k, i) => h('option', { value: i }, k.name)));
    $('kid').onchange = fillYears;
    fillYears();
    $('status').textContent = '아이와 학년을 고르고 만들기를 눌러 주세요.';
  } catch (e) {
    $('status').textContent = e instanceof NotLoggedInError ? '키즈노트 웹에 먼저 로그인해 주세요.' : '오류: ' + (e.message || e);
  }
}

// 학년 단위 (입학·진급에 맞춰 3월 ~ 다음 해 2월). 나이는 그해 3월 1일 기준 만 나이.
// 선생님이 일기처럼 써 주는 어린이집 만 0~2세 반만 (유치원 나이는 알림장이 대부분 안내라 빼 둔다)
const MAX_AGE = 2;
function fillYears() {
  const kid = kids[Number($('kid').value)];
  const now = new Date();
  const cur = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  const born = kid?.birth ? Number(kid.birth.slice(0, 4)) : cur - 3;
  const opts = [];
  for (let y = cur; y >= born - 1; y--) {
    // 3월 1일에 아직 안 태어났으면 그 학년은 태어난 뒤부터 (만 0세)
    const label = kid?.birth && kid.birth > `${y}-03-01` ? '0개월' : ageLabel(kid?.birth, `${y}-03-01`);
    if (kid?.birth && kid.birth > `${y + 1}-02-28`) continue;
    const years = /만 (\d+)세/.exec(label)?.[1];
    if (years && Number(years) > MAX_AGE) continue;
    // 생일을 모르면 나이를 붙이지 않는다
    opts.push(h('option', { value: y }, `${y}년 3월 – ${y + 1}년 2월${kid?.birth ? ` (만 ${years ?? 0}세 반)` : ''}`));
  }
  $('year').replaceChildren(...opts);
  $('make').disabled = !opts.length;
  if (!opts.length) $('status').textContent = '성장 기록은 어린이집 만 0~2세 시기만 만들 수 있어요.';
}

$('make').onclick = async () => {
  const kid = kids[Number($('kid').value)];
  if (!kid) return;
  const y = Number($('year').value);
  const since = `${y}-03-01`;
  const until = `${y + 1}-02-31`;
  if (editing) $('edit').click(); // 새로 만들 때는 고치기를 끝낸 상태로 (버튼을 잠그기 전에)
  $('make').disabled = true;
  $('print').disabled = true;
  $('saveHtml').disabled = true;
  $('edit').disabled = true;
  try {
    const me = await api.me().catch(() => null);
    const reports = [];
    let parentCount = 0, sample = null, parentSample = null;
    // 알림장은 최신순으로 온다: 학년 끝에서 시작까지 어디쯤 왔는지로 진행을 잰다
    const t0 = Date.now();
    const end = Math.min(Date.parse(until.replace(/-31$/, '-28')), Date.now()), start = Date.parse(since);
    progress('알림장 읽는 중', 0, t0);
    for await (const r of paginate(api.childReports, { child: kid.child }, { stop: (x) => postYMD(x) < since, maxPages: 100 })) {
      progress(`알림장 읽는 중 (${reports.length}편)`, (end - Date.parse(postYMD(r))) / (end - start), t0);
      if (postYMD(r) > until) continue;
      // 우리가 기관에 보낸 알림장은 빼고, 어린이집에서 보낸 것만
      if (byParent(r, me?.id)) { parentCount++; parentSample ||= r; continue; }
      sample ||= r;
      reports.push({ id: r.id, date: postYMD(r), content: r.content || '', images: r.attached_images || [] });
    }
    progress(null);
    $('fields').textContent = JSON.stringify({ 내id: me?.id ?? null, 어린이집_글: sample && shape(sample), 부모_글로_본_것: parentSample && shape(parentSample) }, null, 1);
    const name = givenName(kid.name);
    book = { kid, name, days: buildStory(reports, { name }), reportCount: reports.length, parentCount };
    draw(); // PDF로 저장은 사진 위치를 다 맞추면 열린다 (printReady)
    $('edit').disabled = false;
  } catch (e) {
    progress(null);
    $('status').textContent = e instanceof NotLoggedInError ? '키즈노트 웹에 먼저 로그인해 주세요.' : '오류: ' + (e.message || e);
  } finally {
    $('make').disabled = false;
  }
};

// 고치기: 문장을 누르면 그 문장만, "이 날 빼기"를 누르면 그날 전체를 뺀다. 한 번 더 누르면 되돌린다
$('edit').onclick = () => {
  editing = !editing;
  $('edit').setAttribute('aria-pressed', String(editing));
  $('edit').textContent = editing ? '고치기 끝' : '고치기';
  document.body.classList.toggle('editing', editing);
  draw();
};
const sKey = (s) => norm(s).slice(0, 40);
const cutDay = (d) => cut[d.id] === true;
const cutSentence = (d, s) => Array.isArray(cut[d.id]) && cut[d.id].includes(sKey(s));
function toggleDay(d) {
  if (cutDay(d)) delete cut[d.id];
  else cut[d.id] = true;
  store.set(CUT, cut);
  draw();
}
function toggleSentence(d, s) {
  const list = Array.isArray(cut[d.id]) ? cut[d.id] : [];
  cut[d.id] = list.includes(sKey(s)) ? list.filter((x) => x !== sKey(s)) : [...list, sKey(s)];
  if (!cut[d.id].length) delete cut[d.id];
  store.set(CUT, cut);
  draw();
}

function togglePhoto(p) {
  if (cutPhotos[imgId(p)]) delete cutPhotos[imgId(p)];
  else cutPhotos[imgId(p)] = true;
  store.set(CUT_PHOTO, cutPhotos);
  draw();
}

function draw() {
  if (!book) return;
  const { kid, name, reportCount, parentCount } = book;
  // 직접 뺀 것을 반영한 날들 (고치는 중에는 뺀 것도 흐리게 보여준다)
  const days = book.days.map((d) => {
    const parts = d.parts.filter((s) => !cutSentence(d, s));
    const photos = d.photos.filter((p) => !cutPhotos[imgId(p)]);
    return { ...d, parts, photos, text: joinParts(parts), first: d.first && parts.includes(d.first) ? d.first : null, cut: cutDay(d) };
  }).filter((d) => editing || (!d.cut && (d.text || d.photos.length)));
  const shown = days.filter((d) => !d.cut);
  if (!days.length || (!shown.length && !editing)) {
    $('book').replaceChildren(h('p', { class: 'hint' }, reportCount
      ? '이 학년의 알림장은 대부분 안내·공지여서 남길 이야기를 찾지 못했어요. 다른 학년을 골라 보세요.'
      : '이 학년에는 어린이집에서 보낸 알림장이 없어요. 다른 학년을 골라 보세요.'));
    $('status').textContent = `알림장 ${reportCount}편` + (parentCount ? ` · 우리가 보낸 알림장 ${parentCount}편 제외` : '');
    printReady(false);
    $('print').textContent = 'PDF로 저장';
    return;
  }
  const dropped = book.days.reduce((n, d) => n + d.dropped, 0);
  $('status').textContent = `알림장 ${reportCount}편 → 이야기 ${shown.length}날 · 자동으로 뺀 문장 ${dropped}개` + (parentCount ? ` · 우리가 보낸 알림장 ${parentCount}편 제외` : '');

  const ref = shown.length ? shown : days;
  const first = ref[0].date, last = ref[ref.length - 1].date;
  const span = (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(last.slice(5, 7)) - Number(first.slice(5, 7)) + 1;
  const pics = shown.flatMap((d) => d.photos);
  const cls = [...new Map(kid.classes.filter((c) => c.created?.slice(0, 10) <= last).map((c) => [c.name, c])).values()].pop() || kid.classes[0];
  const firsts = shown.filter((d) => d.first);
  let page = 1;
  const pageFoot = () => h('div', { class: 'pagefoot' }, h('span', {}, `${name}의 어린이집 이야기`), h('span', {}, ++page));

  // 표지: 처음 사진을 크게, 중간과 마지막 사진을 작게
  const coverPics = [pics[0], pics[Math.floor(pics.length / 2)], pics[pics.length - 1]];
  const cover = h('section', { class: 'sheet cover' },
    h('div', { class: 'kicker' }, `GROWING DAYS · ${first.slice(0, 4)}${last.slice(0, 4) !== first.slice(0, 4) ? `–${last.slice(0, 4)}` : ''}`),
    h('h1', {}, `${name}의`, h('br'), span >= 10 ? '어린이집 한 해' : '어린이집 날들'),
    h('p', { class: 'sub' }, `선생님이 들려준 ${name}의 하루들`),
    pics.length >= 3 ? h('div', { class: 'photos' }, photo(coverPics[0]), h('div', { class: 'side' }, photo(coverPics[1]), photo(coverPics[2])))
      : pics.length ? h('div', { class: 'photos', style: 'grid-template-columns:1fr' }, photo(pics[0])) : null,
    h('div', { class: 'foot' },
      h('div', {}, h('b', {}, [cls?.name, ageLabel(kid.birth, first)].filter(Boolean).join(' · ')), h('span', {}, `${dotDate(first)} – ${dotDate(last)}`)),
      h('span', {}, `알림장 ${reportCount}편에서 모은 기록`)),
  );

  // 처음의 순간들: 감동이 먼저 오도록 표지 바로 다음
  const firstsSheet = firsts.length
    ? h('section', { class: 'sheet firsts' },
      h('div', { class: 'kicker' }, 'FIRSTS'),
      h('h2', { style: 'font-size:40px;margin-top:14px' }, '처음의 순간들'),
      h('p', { class: 'lead' }, `선생님이 알림장에 적어 준 ${name}의 "처음"과 "스스로"를 모았어요.`),
      h('div', { class: 'grid' }, firsts.slice(0, 12).map((d) => h('div', { class: 'item reveal' },
        d.photos[0] ? photo(d.photos[0]) : null,
        h('span', {}, [dayLabel(d.date).replace(/ \S+요일$/, ''), ageLabel(kid.birth, d.date)].filter(Boolean).join(' · ')),
        h('p', {}, d.first),
      ))),
      pageFoot())
    : null;

  // 달마다 한 장 (내용이 길면 인쇄할 때 다음 장으로 이어진다)
  const months = new Map();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(d);
  }
  const monthSheets = [...months].map(([k, ds]) => {
    const m = Number(k.slice(5, 7));
    const live = ds.filter((d) => !d.cut);
    return h('section', { class: 'sheet month' },
      h('div', { class: 'month-head' },
        h('span', { class: 'num' }, m),
        h('div', {}, h('h2', {}, MONTH_TITLE[m]),
          h('small', {}, [ageLabel(kid.birth, `${k}-01`), `알림장 ${live.length}편`, live.some((d) => d.photos.length) ? `사진 ${live.reduce((n, d) => n + d.photos.length, 0)}장` : ''].filter(Boolean).join(' · ')))),
      h('div', { class: 'line' }, ds.map((d) => dayView(d))),
      pageFoot(),
    );
  });

  const lastDay = [...shown].reverse().find((d) => d.text.length > 30) || shown[shown.length - 1];
  const closing = h('section', { class: 'sheet closing' },
    h('div', { class: 'kicker' }, span >= 10 ? 'ONE YEAR' : 'OUR DAYS'),
    h('h2', { style: 'font-size:40px;margin-top:14px' }, span >= 10 ? '함께한 한 해' : '함께한 날들'),
    h('div', { class: 'nums' },
      h('div', {}, h('b', {}, shown.length), h('span', {}, '선생님이 들려준 날')),
      h('div', {}, h('b', {}, pics.length), h('span', {}, `${name}의 사진`)),
      h('div', {}, h('b', {}, firsts.length), h('span', {}, '처음의 순간'))),
    lastDay ? h('div', { class: 'last reveal' }, h('span', {}, `${dayLabel(lastDay.date)} · 마지막 장의 이야기`), h('p', {}, lastDay.text)) : null,
    h('div', { class: 'write' }, h('b', {}, '엄마·아빠가 남기는 말'), h('div'), h('div'), h('div'), h('div')),
    h('div', { class: 'pagefoot' }, h('span', {}, '이 기록은 내 컴퓨터 안에서만 만들어졌어요 · 우리애 한눈에'), h('span', {}, ++page)),
  );

  const y = scrollY;
  $('book').replaceChildren(cover, firstsSheet, ...monthSheets, closing);
  scrollTo(0, y);
  document.title = `${name}의 어린이집 이야기`;
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('on'), io.unobserve(e.target))), { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach((el) => (editing ? el.classList.add('on') : io.observe(el)));
  // 고치는 중에는 그날 사진이 모두 보이지만, 책에 들어가지 않는 사진까지 맞추지 않는다 (고치기 끝에 새로 들어온 사진만)
  if (!editing) startFocus();
}

// 책에 실제로 나온 사진(하루 최대 3장, 표지, 처음의 순간들) 중 아직 얼굴 위치를 모르는 것만, 위에서부터 차례로.
// 이미 맞춘 위치는 저장돼 있어서 다시 하지 않는다. 다 끝났을 때 그사이 책이 바뀌었으면 새로 나온 사진만 이어서 한다
const failed = new Set(); // 이번에 받지 못한 사진 (다시 열면 재시도)
function startFocus() {
  if (focusJob) return;
  const todo = [...new Map([...document.querySelectorAll('#book img[data-id]')]
    .map((el) => [el.dataset.id, { id: el.dataset.id, url: el.dataset.orig }])).values()]
    .filter((p) => !(p.id in focus) && !failed.has(p.id));
  if (!todo.length) return printReady(true);
  printReady(false);
  focusJob = findFaces(todo).finally(() => {
    focusJob = null;
    if (!editing) startFocus();
  });
}

// 사진 속 얼굴 위치를 맞추는 동안에는 PDF로 저장을 잠그고, 끝나면 연다 (잘린 얼굴로 저장되지 않게)
function printReady(ready) {
  const btn = $('print');
  btn.disabled = !ready;
  $('saveHtml').disabled = !ready;
  btn.textContent = ready ? 'PDF로 저장' : '사진 맞추는 중… 끝나면 PDF로 저장';
  btn.title = ready ? '' : '사진마다 얼굴이 잘리지 않게 위치를 맞추고 있어요. 아래 막대가 끝나면 눌러 주세요.';
}

// 얼굴 위치 찾기: 모든 얼굴을 감싸는 상자의 가운데를 사진의 기준점으로 (얼굴이 없으면 위쪽 1/3)
let focusJob = null;
async function findFaces(todo) {
  const t0 = Date.now();
  progress(`사진 속 얼굴 위치 맞추는 중 (0/${todo.length}장)`, 0, t0);
  // 위치만 알면 되니 얼굴 특징값은 계산하지 않고, 작은 크기로 줄여서 빠르게 찾는다
  const { initFace, loadCanvas } = await import('../lib/face.js');
  const human = await initFace();
  let n = 0;
  try {
  for (const p of todo) {
    progress(`사진 속 얼굴 위치 맞추는 중 (${n}/${todo.length}장)`, n / todo.length, t0);
    n++;
    try {
      // 인쇄용으로 줄인 사진도 이때 같이 만들어 둔다 (PDF 미리보기가 빨라진다)
      const canvas = await loadCanvas(await shrink(p), 512);
      const res = await human.detect(canvas);
      const faces = (res.face || []).filter((f) => (f.faceScore ?? f.score ?? 1) >= 0.5 && Math.min(f.box[2], f.box[3]) >= 16)
        .map((f) => [f.box[0] / canvas.width, f.box[1] / canvas.height, f.box[2] / canvas.width, f.box[3] / canvas.height]);
      if (faces.length) {
        const x0 = Math.min(...faces.map((b) => b[0])), x1 = Math.max(...faces.map((b) => b[0] + b[2]));
        const y0 = Math.min(...faces.map((b) => b[1])), y1 = Math.max(...faces.map((b) => b[1] + b[3]));
        // 얼굴 위쪽에 머리카락 몫으로 조금 여유를 둔다
        focus[p.id] = `${Math.round(((x0 + x1) / 2) * 100)}% ${Math.round(Math.max(0, (y0 + y1) / 2 - (y1 - y0) * 0.15) * 100)}%`;
      } else focus[p.id] = '50% 30%';
    } catch {
      failed.add(p.id); // 받지 못한 사진은 위쪽 1/3 기준 그대로 두고, 다음에 페이지를 열면 다시
      continue;
    }
    document.querySelectorAll(`img[data-id="${CSS.escape(p.id)}"]`).forEach((el) => { el.style.objectPosition = focus[p.id]; });
    if (n % 10 === 0) await store.set(FOCUS, focus);
  }
  } finally {
    await store.set(FOCUS, focus).catch(() => {});
    progress(null);
  }
}

// 사진을 책에 쓰기 좋은 크기(긴 쪽 1000px, JPEG)로 줄여 둔다. 원본은 수 MB라 인쇄 미리보기가 아주 느려진다.
// 줄인 사진은 이 컴퓨터의 브라우저 캐시(Cache Storage)에 두어, 페이지를 다시 열어도 다시 줄이지 않는다
const small = new Map(); // 사진 id → Blob (이번에 쓴 것)
const SMALL_CACHE = 'uriae-story-small-v1';
const cacheKey = (id) => `https://uriae.local/story-small/${encodeURIComponent(id)}`;
async function shrink(p) {
  if (small.has(p.id)) return small.get(p.id);
  const cache = await caches.open(SMALL_CACHE).catch(() => null);
  let blob = await cache?.match(cacheKey(p.id)).then((r) => r?.blob()).catch(() => null);
  if (!blob) {
    const { loadCanvas } = await import('../lib/face.js');
    blob = await (await loadCanvas(p.url, 1000)).convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    await cache?.put(cacheKey(p.id), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } })).catch(() => {});
  }
  small.set(p.id, blob);
  const url = URL.createObjectURL(blob);
  smallUrl.set(p.id, url);
  document.querySelectorAll(`img[data-id="${CSS.escape(p.id)}"]`).forEach((el) => { el.src = url; });
  return blob;
}
// 책에 나온 사진을 모두 줄인다 (얼굴 맞추기에서 이미 줄인 것은 건너뛴다)
async function shrinkAll(label) {
  const pics = [...new Map([...document.querySelectorAll('#book img[data-id]')].map((el) => [el.dataset.id, { id: el.dataset.id, url: el.dataset.orig }])).values()];
  const todo = pics.filter((p) => !small.has(p.id));
  const t0 = Date.now();
  let n = 0;
  try {
    for (const p of todo) {
      progress(`${label} (${n++}/${todo.length}장)`, n / todo.length, t0);
      await shrink(p).catch(() => {});
    }
  } finally {
    progress(null);
  }
  return pics;
}

function dayView(d) {
  // 고치는 중에는 원래 남은 문장을 모두 보여주고, 뺀 문장은 줄을 긋는다
  const orig = book.days.find((x) => x.id === d.id);
  const all = editing ? orig.parts : d.parts;
  // 고치는 중에는 사진을 모두 보여주고(뺀 사진은 흐리게), 누르면 빼거나 되돌린다
  const pics = editing ? orig.photos : d.photos.slice(0, 3);
  const picView = (p) => (editing
    ? h('button', { class: 'pic' + (cutPhotos[imgId(p)] ? ' off' : ''), title: cutPhotos[imgId(p)] ? '누르면 되돌려요' : '누르면 이 사진을 빼요', onclick: () => togglePhoto(p) }, photo(p))
    : photo(p));
  return h('div', { class: 'day reveal' + (d.first ? ' first' : '') + (d.cut ? ' cut' : '') },
    h('div', { class: 'when' }, dayLabel(d.date), d.first ? h('span', { class: 'tag' }, '처음의 순간') : null,
      editing ? h('button', { class: 'cut-day', onclick: () => toggleDay(d) }, d.cut ? '되돌리기' : '이 날 빼기') : null),
    all.length
      ? editing
        ? h('p', {}, all.map((s) => h('button', { class: 'sent' + (cutSentence(d, s) ? ' off' : ''), title: '누르면 이 문장을 빼요', onclick: () => toggleSentence(d, s) }, s)))
        : h('p', {}, d.text)
      : null,
    pics.length ? h('div', { class: `pics n${Math.min(pics.length, 3)}` }, pics.map(picView)) : null,
  );
}

// PDF: 늦게 불러오는 사진까지 다 받은 뒤 인쇄 창을 연다
$('print').onclick = async () => {
  const btn = $('print');
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  if (editing) $('edit').click();
  try {
    btn.textContent = '사진 준비하는 중…';
    await shrinkAll('인쇄용으로 사진 줄이는 중');
    const imgs = [...document.querySelectorAll('#book img')];
    imgs.forEach((i) => { i.loading = 'eager'; });
    // 받지 못하는 사진 하나 때문에 멈추지 않게 20초까지만 기다린다
    await Promise.race([
      Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); })))),
      new Promise((r) => setTimeout(r, 20000)),
    ]);
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('on'));
    print();
  } finally {
    btn.textContent = 'PDF로 저장';
    delete btn.dataset.busy;
  }
};

// HTML 파일 하나로 받기: 사진(줄인 것)과 음악 한 곡을 파일 안에 넣어서, 인터넷이나 확장 없이도 열어 보고 인쇄할 수 있게
const toDataUrl = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
$('saveHtml').onclick = async () => {
  const btn = $('saveHtml');
  if (btn.dataset.busy || !book) return;
  btn.dataset.busy = '1';
  if (editing) $('edit').click();
  try {
    btn.textContent = '파일 만드는 중…';
    await shrinkAll('파일에 넣을 사진 줄이는 중');
    const clone = $('book').cloneNode(true);
    // 책에 들어간 사진만 파일에 넣는다 (같은 사진이 표지와 본문에 두 번 나오면 한 번만 변환)
    const data = new Map();
    for (const el of clone.querySelectorAll('img')) {
      const id = el.dataset.id;
      if (!data.has(id) && small.has(id)) data.set(id, await toDataUrl(small.get(id)));
      if (data.has(id)) el.src = data.get(id);
      el.removeAttribute('loading');
      el.removeAttribute('data-orig');
    }
    clone.querySelectorAll('.reveal').forEach((el) => el.classList.add('on'));
    const css = await (await fetch('story.css')).text();
    const music = await fetch('audio/calm-piano.mp3').then((r) => (r.ok ? r.blob() : null)).then((b) => b && toDataUrl(b)).catch(() => null);
    const title = `${book.name}의 어린이집 이야기`.replace(/[<>&"]/g, '');
    const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap">
<style>${css}
.play{position:fixed;right:20px;bottom:20px;z-index:5;font:600 14px var(--sans);padding:10px 16px;border-radius:99px;border:1px solid var(--accent);background:#fff;color:var(--accent);cursor:pointer}
@media print{.play{display:none}}</style></head>
<body>${music ? `<button class="play" id="play">♪ 음악 켜기</button><audio id="au" loop src="${music}"></audio>` : ''}
<main id="book">${clone.innerHTML}</main>
${music ? `<script>const b=document.getElementById('play'),a=document.getElementById('au');b.onclick=()=>{if(a.paused){a.volume=.5;a.play();b.textContent='♪ 음악 끄기'}else{a.pause();b.textContent='♪ 음악 켜기'}}</script>` : ''}
</body></html>`;
    const a = h('a', { href: URL.createObjectURL(new Blob([html], { type: 'text/html' })), download: `${title}.html` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } finally {
    btn.textContent = 'HTML 파일로 받기';
    delete btn.dataset.busy;
  }
};

// 배경 음악: Pixabay 피아노 3곡을 섞어서 이어 튼다 (기본 꺼짐, 누르면 천천히 커진다)
const TRACKS = ['calm-piano.mp3', 'peaceful-piano.mp3', 'romantic-piano.mp3'].sort(() => Math.random() - 0.5);
let track = 0;
const audio = $('audio');
audio.onended = () => { track = (track + 1) % TRACKS.length; audio.src = `audio/${TRACKS[track]}`; audio.play(); };
$('music').onclick = async () => {
  const btn = $('music');
  if (!audio.paused) {
    audio.pause();
    btn.textContent = '♪ 음악 켜기';
    btn.setAttribute('aria-pressed', 'false');
    return;
  }
  if (!audio.src) audio.src = `audio/${TRACKS[track]}`;
  audio.volume = 0;
  try { await audio.play(); } catch { btn.textContent = '음악 파일 없음'; return; }
  btn.textContent = '♪ 음악 끄기';
  btn.setAttribute('aria-pressed', 'true');
  const fade = setInterval(() => { audio.volume = Math.min(0.6, audio.volume + 0.03); if (audio.volume >= 0.6) clearInterval(fade); }, 120);
};

boot();
