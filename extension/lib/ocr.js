// 그림으로 온 가정통신문·안내문의 글자 읽기. 모든 처리는 브라우저 안에서만 한다(외부 전송 없음).
// tesseract.js 엔진과 한국어 데이터는 vendor/ocr 에 들어 있고, 인터넷에서 받아오지 않는다.
import Tesseract from '../vendor/ocr/tesseract.esm.min.js';
import { cleanOcrText, extractFromPost } from './extract.js';

const MIN_HANGUL = 20; // 이만큼 한글이 읽혀야 안내문으로 본다 (흰 벽 앞 사진 같은 것 거르기)

let worker = null;
function getWorker() {
  const BASE = chrome.runtime.getURL('vendor/ocr/');
  worker ||= Tesseract.createWorker('kor', 1, {
    workerPath: BASE + 'worker.min.js',
    corePath: BASE + 'tesseract-core-simd-lstm.wasm.js',
    langPath: BASE.slice(0, -1),
    workerBlobURL: false,
    cacheMethod: 'none',
  }).then(async (w) => {
    // 4: 크기가 다른 글이 한 단으로 이어진 문서. 표의 "준비물 | 도시락, 물통" 줄을 가장 잘 읽는다
    await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
    return w;
  });
  return worker;
}

/** 다 읽었으면 엔진을 내려 메모리를 돌려준다 */
export async function closeOcr() {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate();
}

function gray(data, n) {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return g;
}

/** 주변 평균보다 확실히 어두운 점만 검정으로(적응형 이진화). 색 상자·그림자 위 글자도 살린다. 어두운 점 비율을 돌려준다 */
function binarize(img, r, t) {
  const { data, width: W, height: H } = img;
  const g = gray(data, W * H);
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += g[y * W + x];
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
    }
  }
  let ink = 0;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const m = (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const dark = g[y * W + x] < m * (1 - t);
      if (dark) ink++;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = dark ? 0 : 255;
    }
  }
  return ink / (W * H);
}

/** 흰 바탕에 글자가 있는 그림인지 빠르게 판단 (200px로 줄여서). 사진은 밝고 평평한 바탕이 적다 */
function looksLikeDocument(bmp) {
  const W = 200, H = Math.max(1, Math.round((bmp.height * W) / bmp.width));
  const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const g = gray(img.data, W * H);
  let bright = 0, sat = 0;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      if (g[i] > 150 && Math.abs(g[i] - g[i + 1]) + Math.abs(g[i] - g[i + W]) < 6) bright++;
      const d = img.data;
      sat += (Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) / 255;
    }
  }
  const n = (W - 1) * (H - 1);
  const ink = binarize(img, 7, 0.2);
  return bright / n >= 0.5 && sat / n <= 0.35 && ink >= 0.01 && ink <= 0.25;
}

/**
 * 그림 한 장을 읽는다.
 * @returns {Promise<{doc:boolean, text:string}>} doc: 글자 안내문으로 보이는지, text: 정리한 글자
 */
export async function readImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`그림을 받지 못했어요 (${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  try {
    if (!looksLikeDocument(bmp)) return { doc: false, text: '' };
    // 본문 글자가 20~30px 쯤일 때 가장 잘 읽히는데(너무 크면 오히려 표·상자 글자를 놓친다) 글자 크기는 그림마다 달라서,
    // 원본 크기와 몇 가지 너비로 읽어 보고, 챙길 것·날짜를 가장 많이 찾은 쪽을 쓴다 (원본보다 많이 키우지는 않는다)
    const native = Math.min(1700, Math.max(900, bmp.width));
    const widths = [...new Set([native, 900, 1300, 1700])].filter((w) => w === native || w === 900 || w <= bmp.width * 1.3);
    let best = { score: -1, text: '' };
    for (const w of widths) {
      const text = await recognizeAt(bmp, w);
      const r = extractFromPost({ content: text, date: '2000-01-01' });
      // 실제 준비물은 "물통", "사탕 담을 바구니" 처럼 짧다. 긴 문장은 잘못 읽은 줄이 섞여 들어온 경우가 많다
      const score = r.prep.reduce((n, p) => n + (p.length <= 20 ? 10 : 4), 0) + r.events.length * 5 + (r.date ? 5 : 0) + hangul(text) / 100;
      if (score > best.score) best = { score, text };
    }
    return { doc: hangul(best.text) >= MIN_HANGUL, text: best.text };
  } finally {
    bmp.close();
  }
}

const hangul = (s) => (s.match(/[가-힣]/g) || []).length;

async function recognizeAt(bmp, width) {
  const s = width / bmp.width;
  const W = width, H = Math.round(bmp.height * s);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  binarize(img, Math.round(Math.max(W, H) / 80), 0.15);
  ctx.putImageData(img, 0, 0);
  const { data } = await (await getWorker()).recognize(canvas);
  return cleanOcrText(data.text || '');
}
