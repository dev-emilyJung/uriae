// 알림장 추출 정답 만들기 (개발용, 배포 zip에는 포함하지 않음)
// 내 알림장·공지에서 뽑은 결과를 직접 바로잡아 정답 파일을 만든다. 정답 파일은 tests/private/ (저장소에 안 올라감) 에 두고 채점한다.
import { api, paginate, currentEnrollments, NotLoggedInError } from '../lib/api.js';
import { extractFromPost, fixOcrLine, isReadable, isReferenceDoc, ymd } from '../lib/extract.js';
import { store, K } from '../lib/store.js';

const $ = (id) => document.getElementById(id);
const LABELS = 'dev:prepLabels'; // {postKey: {ok, prep: 정답 준비물, date: 정답 날짜, bad: 틀린 항목, missing: 빠진 항목}}
const HINT = /준비물|챙겨|보내\s*주|복장|지참|가져\s*(오|와)/;

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
const imgKey = (img) => String(img.id ?? (img.original || img.large || '').split('?')[0]);

let posts = [];
let labels = {};
let names = [];

$('load').onclick = async () => {
  $('load').disabled = true;
  try {
    labels = await store.get(LABELS, {});
    const ocr = await store.get(K.ocr, {});
    const enrollments = currentEnrollments(await api.enrollments());
    names = [...new Set(enrollments.flatMap((e) => [e.child_name, e.child_name?.length >= 3 ? e.child_name.slice(1) : null]).filter(Boolean))]
      .sort((a, b) => b.length - a.length);
    const since = ymd(new Date(Date.now() - Number($('days').value) * 86400000));
    const map = new Map();
    for (const e of enrollments) {
      const args = { child: e.child, cls: e.belong_to_class, center: e.center_id };
      for (const [source, fn] of [['report', api.reports], ['notice', api.notices]]) {
        for await (const x of paginate(fn, args, { stop: (y) => postYMD(y) < since, maxPages: 20 })) {
          $('status').textContent = `불러오는 중… ${map.size}개`;
          const images = x.attached_images || [];
          // 앱과 같은 방식으로 그림 안내문에서 읽은 글자를 붙인다 (챙길 것 탭에서 한 번 읽은 그림만)
          const imgText = images.filter((img) => ocr[imgKey(img)]?.doc)
            .map((img) => ocr[imgKey(img)].text.split('\n').map(fixOcrLine).join('\n'))
            .filter((t) => isReadable(t) && !isReferenceDoc(t))
            .join('\n');
          map.set(`${source}:${x.id}`, { key: `${source}:${x.id}`, id: x.id, source, date: postYMD(x), title: x.title || '', content: x.content || '', imgText });
        }
      }
    }
    posts = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
    draw();
    $('export').disabled = false;
    $('exportRaw').disabled = false;
  } catch (e) {
    $('status').textContent = e instanceof NotLoggedInError ? '키즈노트 웹에 먼저 로그인해 주세요.' : '오류: ' + (e.message || e);
  } finally {
    $('load').disabled = false;
  }
};

const extract = (p) => extractFromPost({ ...p, content: [p.content, p.imgText].filter(Boolean).join('\n') });

function draw() {
  const only = $('onlyFound').checked;
  const shown = posts.filter((p) => {
    if (!only || labels[p.key]) return true;
    const r = extract(p);
    return r.prep.length || r.events.length || HINT.test(p.content + p.imgText);
  });
  const done = posts.filter((p) => labels[p.key]?.ok).length;
  $('status').textContent = `글 ${posts.length}개 중 ${shown.length}개 표시 · 확인 완료 ${done}개`;
  $('list').replaceChildren(...shown.map(postView));
}
$('onlyFound').onchange = () => posts.length && draw();

function postView(p) {
  const r = extract(p);
  const lb = labels[p.key] || {};
  const bad = new Set(lb.bad || []);
  const dateIn = h('input', { type: 'date', value: lb.date !== undefined ? lb.date || '' : r.date || '' });
  const missing = h('textarea', { placeholder: '빠진 준비물 (한 줄에 하나)' });
  missing.value = (lb.missing || []).join('\n');
  const items = h('ul', { class: 'items' }, r.prep.map((it) => {
    const li = h('li', { class: bad.has(it) ? 'bad' : '' });
    const btn = h('button', { onclick: () => { bad.has(it) ? bad.delete(it) : bad.add(it); li.classList.toggle('bad'); btn.textContent = bad.has(it) ? '되돌리기' : '✗ 틀림'; } }, bad.has(it) ? '되돌리기' : '✗ 틀림');
    li.append(btn, h('span', {}, it));
    return li;
  }));
  const box = h('div', { class: 'post' + (lb.ok ? ' ok' : '') },
    h('div', {},
      h('div', { class: 'meta' }, `${p.date} · ${p.source === 'notice' ? '공지' : '알림장'} · ${p.key}`),
      p.title ? h('b', {}, p.title) : null,
      h('div', { class: 'raw' }, p.content, p.imgText ? `\n\n── 그림에서 읽은 글자 ──\n${p.imgText}` : ''),
    ),
    h('div', {},
      h('div', { class: 'meta' }, '뽑힌 준비물 (틀린 것은 ✗)'),
      r.prep.length ? items : h('div', { class: 'note' }, '뽑힌 준비물 없음'),
      h('div', { class: 'row' }, missing),
      h('div', { class: 'row' }, '챙길 날짜 ', dateIn, h('span', { class: 'note' }, ` (자동: ${r.date || '없음'}, 비우면 날짜 없음)`)),
      r.events.length ? h('div', { class: 'note' }, '일정: ' + r.events.join(' / ')) : null,
      h('div', { class: 'row' }, h('button', {
        onclick: async () => {
          const miss = missing.value.split('\n').map((s) => s.trim()).filter(Boolean);
          labels[p.key] = { ok: true, bad: [...bad], missing: miss, date: dateIn.value || null, prep: [...r.prep.filter((x) => !bad.has(x)), ...miss] };
          await store.set(LABELS, labels);
          box.classList.add('ok');
          draw();
        },
      }, lb.ok ? '다시 저장' : '확인 완료')),
    ),
  );
  return box;
}

/** 아이 이름 가리기 (선생님 이름 등은 내려받은 파일에서 한 번 더 확인해 주세요) */
const mask = (s) => names.reduce((t, n) => t.split(n).join('○○'), s || '');

const download = (name, data) => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 1)], { type: 'application/json' });
  h('a', { href: URL.createObjectURL(blob), download: name }).click();
};
const masked = (p) => ({ key: p.key, source: p.source, date: p.date, title: mask(p.title), content: mask(p.content), imgText: mask(p.imgText) });

$('export').onclick = () => {
  const cases = posts.filter((p) => labels[p.key]?.ok).map((p) => ({
    ...masked(p),
    expect: { prep: labels[p.key].prep.map(mask), date: labels[p.key].date },
  }));
  download('prep-cases.json', { cases });
  $('status').textContent = `정답 ${cases.length}개를 내려받았어요. tests/private/prep-cases.json 으로 옮겨 주세요.`;
};

// 정답 없이 원문만 (Claude가 읽고 정답을 만든다). 준비물이 없는 일상 글도 잘못 뽑는지 보려고 모두 넣는다
$('exportRaw').onclick = () => {
  download('prep-raw.json', { posts: posts.map(masked) });
  $('status').textContent = `글 ${posts.length}개를 내려받았어요. tests/private/ 폴더에 넣어 주세요.`;
};

$('load').click(); // 열자마자 불러오기
