// 얼굴 인식 측정 페이지 (개발용, 배포 zip에는 포함하지 않음)
import { initFace, detectFaces, MODEL_ID } from '../lib/face.js';
import { pairScores, separation, simulate } from './metrics.js';

const $ = (id) => document.getElementById(id);
const HISTORY = 'uriae-eval-history';
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const n3 = (v) => v.toFixed(3);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.flat());
  return el;
}
const table = (head, rows) => h('table', {}, h('tr', {}, head.map((x) => h('th', {}, x))), rows.map((r) => h('tr', {}, r.map((x) => h('td', {}, String(x))))));

let files = [];
$('dir').onchange = () => {
  files = [...$('dir').files].filter((f) => /\.(jpe?g|png|webp|bmp)$/i.test(f.name) && f.webkitRelativePath.split('/').length >= 3);
  files.sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath));
  const people = new Set(files.map(labelOf));
  $('status').textContent = `${people.size}명, ${files.length}장`;
  $('run').disabled = !files.length;
};
const labelOf = (f) => f.webkitRelativePath.split('/').slice(-2)[0];

$('run').onclick = async () => {
  $('run').disabled = true;
  $('out').replaceChildren();
  try {
    $('status').textContent = '모델 준비 중…';
    await initFace();
    const items = [];
    const noFace = [];
    const started = Date.now();
    for (const [i, f] of files.entries()) {
      $('status').textContent = `얼굴 계산 ${i + 1} / ${files.length}`;
      let faces = [];
      try { faces = await detectFaces(f); } catch { /* 읽기 실패는 얼굴 없음으로 */ }
      if (!faces.length) { noFace.push(f); continue; }
      faces.sort((a, b) => b.size - a.size); // 여러 명이면 가장 큰 얼굴
      items.push({ label: labelOf(f), name: f.name, file: f, emb: faces[0].emb, size: faces[0].size, score: faces[0].score });
    }
    const msPer = (Date.now() - started) / Math.max(files.length, 1);
    $('status').textContent = '계산 중…';
    await new Promise((r) => setTimeout(r));
    report(items, noFace, msPer);
    $('status').textContent = '완료';
  } catch (e) {
    $('status').textContent = '오류: ' + (e.message || e);
  } finally {
    $('run').disabled = false;
  }
};

function report(items, noFace, msPer) {
  const people = new Set(items.map((x) => x.label)).size;
  const { gen, imp } = pairScores(items);
  const s = separation(gen, imp);
  const sims = [0, 0.5, 1].map((st) => ({ st, ...simulate(items, { strictness: st }) }));
  const mid = sims[1];

  const out = $('out');
  out.append(
    h('h2', {}, '데이터'),
    h('p', {}, `${people}명, 얼굴 찾은 사진 ${items.length}장, 얼굴 못 찾음 ${noFace.length}장, 사진당 ${Math.round(msPer)}ms · 모델 ${MODEL_ID}`),
    noFace.length ? h('p', { class: 'note' }, '얼굴 못 찾음: ' + noFace.slice(0, 20).map((f) => f.webkitRelativePath).join(', ') + (noFace.length > 20 ? ' …' : '')) : '',
  );
  if (s) {
    out.append(
      h('h2', {}, '① 같은 사람 / 다른 사람 점수 분리'),
      table(['항목', '값'], [
        ['같은 사람 쌍 / 다른 사람 쌍', `${s.nGen} / ${s.nImp}`],
        ['같은 사람 최저 점수', n3(s.minGen)],
        ['다른 사람 최고 점수', n3(s.maxImp)],
        ['겹친 같은 사람 쌍 (다른 사람 최고보다 낮음)', s.overlap],
        ['EER (낮을수록 좋음)', `${pct(s.eer)} @ ${n3(s.eerTh)}`],
        ['오인 1%일 때 맞히는 비율', pct(s.tar1)],
        ['오인 0.1%일 때 맞히는 비율', pct(s.tar01)],
      ]),
    );
  }
  out.append(
    h('h2', {}, '② 앱과 같은 판정 (사람마다 기준 얼굴 2장)'),
    table(['찾는 기준', '대상', '맞음', '확인 필요로 빠짐', '놓침', '잘못 찾음', '다른 사람이 확인 필요에'],
      sims.map((r) => [['많이 찾기', '기본', '정확하게'][r.st * 2], r.targets, r.hit, r.maybe, r.miss, r.wrong, r.wrongMaybe])),
    h('h2', {}, `③ 틀린 사례 (기본 기준, ${mid.errors.length}건 중 최대 40건)`),
    h('div', { class: 'errors' }, mid.errors.slice(0, 40).map(errorCard)),
  );

  const memo = prompt('이번 측정 메모 (예: 좌우 반전 추가)', '') || '';
  saveHistory({
    at: new Date().toLocaleString('ko-KR'), memo, model: MODEL_ID, people, faces: items.length, noFace: noFace.length,
    msPer: Math.round(msPer), eer: s && s.eer, tar01: s && s.tar01,
    hit: mid.hit, maybe: mid.maybe, miss: mid.miss, wrong: mid.wrong,
  });
}

function errorCard(e) {
  const img = (f) => h('img', { src: URL.createObjectURL(f), title: f.webkitRelativePath });
  return h('div', { class: 'err' },
    h('div', { class: e.kind.startsWith('다른') ? 'bad' : '' }, e.kind),
    h('div', {}, img(e.ref.file), ' ', img(e.item.file)),
    h('div', {}, `찾는 사람 ${e.target} · 이 사진 ${e.item.label}`),
    h('div', { class: 'note' }, `${e.item.name} · z ${e.z.toFixed(2)} · 점수 ${n3(e.raw)} · 얼굴 ${Math.round(e.item.size)}px`),
  );
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY)) || []; } catch { return []; }
}
function saveHistory(entry) {
  const list = [...loadHistory(), entry];
  try { localStorage.setItem(HISTORY, JSON.stringify(list)); } catch { /* 저장 못 해도 화면에는 보임 */ }
  drawHistory(list);
}
function drawHistory(list = loadHistory()) {
  $('history').replaceChildren(list.length ? table(
    ['시각', '메모', '사람', '얼굴', '못 찾음', 'ms/장', 'EER', '오인0.1%시 맞힘', '맞음', '확인 필요', '놓침', '잘못 찾음'],
    list.map((r) => [r.at, r.memo, r.people, r.faces, r.noFace, r.msPer, r.eer == null ? '-' : pct(r.eer), r.tar01 == null ? '-' : pct(r.tar01), r.hit, r.maybe, r.miss, r.wrong]),
  ) : h('p', { class: 'note' }, '아직 없음'));
}
async function drawUsage() {
  const { store, K } = await import('../lib/store.js');
  const log = await store.get(K.faceLog, []);
  const rate = (a, b) => (a + b ? pct(a / (a + b)) : '-');
  $('usage').replaceChildren(log.length ? table(
    ['찾은 시각', '기간', '기준', '우리 아이', '확인한 수', '잘못 찾음(N)', '잘못 찾는 비율', '확인 필요', '확인한 수', '놓칠 뻔함(Y)', '그중 우리 아이 비율'],
    [...log].reverse().map((r) => [
      new Date(r.at).toLocaleString('ko-KR'), r.label || '', r.strictness,
      r.sure, r.sureYes + r.sureNo, r.sureNo, rate(r.sureNo, r.sureYes),
      r.maybe, r.maybeYes + r.maybeNo, r.maybeYes, rate(r.maybeYes, r.maybeNo),
    ]),
  ) : h('p', { class: 'note' }, '아직 없음. 압축 해제로 불러온(개발용) 확장에서 사진을 찾고 Y/N을 눌러 주세요.'));
}
drawUsage();

$('clear').onclick = () => {
  try { localStorage.removeItem(HISTORY); } catch { /* 무시 */ }
  drawHistory([]);
};
drawHistory();
