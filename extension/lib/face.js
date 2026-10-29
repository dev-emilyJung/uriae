// 얼굴 검출·특징값 계산. @vladmandic/human 을 확장 안에 포함해 브라우저(WebGL)에서만 실행.
// 사진과 얼굴 데이터는 외부로 전송되지 않는다.
// 저장하는 것은 우리 아이 기준 얼굴뿐이고, 다른 아이 얼굴은 비교 후 버린다.
import { Human } from '../vendor/human.esm.js';

const MIN_FACE_PX = 36; // 이보다 작은 얼굴은 특징값이 너무 부정확해서 제외 (단체사진 속 얼굴은 40~80px 정도)

const config = {
  modelBasePath: chrome.runtime.getURL('vendor/models/'),
  backend: 'webgl',
  debug: false,
  warmup: 'none',
  cacheSensitivity: 0,
  filter: { enabled: false },
  face: {
    enabled: true,
    detector: { rotation: true, maxDetected: 40, minConfidence: 0.4, return: false },
    mesh: { enabled: true },
    iris: { enabled: false },
    description: { enabled: true },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
    attention: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
};

let human;
export async function initFace() {
  if (human) return human;
  human = new Human(config);
  await human.load();
  return human;
}

/** URL 또는 Blob → 캔버스 (확장 권한으로 CORS 없이 가져옴) */
export async function loadCanvas(src, maxSide = 1280) {
  const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return c;
}

async function toDataURL(canvas, box, size = 112) {
  const [x, y, w, h] = box;
  const pad = Math.max(w, h) * 0.2;
  const sx = Math.max(0, x - pad), sy = Math.max(0, y - pad);
  const sw = Math.min(canvas.width - sx, w + pad * 2), sh = Math.min(canvas.height - sy, h + pad * 2);
  const t = new OffscreenCanvas(size, size);
  t.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, size, size);
  const blob = await t.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(blob);
  });
}

/**
 * 얼굴 아래 옷 부분의 색 분포 (색상 12 × 채도 3 × 밝기 3 = 108칸, 합이 1).
 * 같은 날 같은 옷을 입은 아이를 이어 주는 데 쓴다. 메모리에서만 쓰고 저장하지 않는다.
 */
function clothHistogram(canvas, box) {
  const [x, y, w, h] = box;
  const cx = x + w / 2;
  const left = Math.max(0, cx - w * 0.8), right = Math.min(canvas.width, cx + w * 0.8);
  const top = Math.min(canvas.height, y + h * 1.15), bottom = Math.min(canvas.height, y + h * 2.6);
  if (right - left < w * 0.6 || bottom - top < h * 0.5) return null; // 옷이 사진 밖으로 잘림
  const N = 24;
  const t = new OffscreenCanvas(N, N);
  const ctx = t.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, left, top, right - left, bottom - top, 0, 0, N, N);
  const px = ctx.getImageData(0, 0, N, N).data;
  const hist = new Array(108).fill(0);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0;
    if (d) hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const sat = max ? d / max : 0;
    const hb = Math.min(11, Math.floor(hue * 2)), sb = Math.min(2, Math.floor(sat * 3)), vb = Math.min(2, Math.floor(max * 3));
    hist[hb * 9 + sb * 3 + vb]++;
  }
  const n = N * N;
  return hist.map((v) => v / n);
}

/**
 * 사진 속 얼굴들의 특징값.
 * withCrops: 얼굴 고르기 화면용 작은 얼굴 이미지도 함께 (메모리에서만 사용, 저장하지 않음)
 */
export async function detectFaces(src, { withCrops = false } = {}) {
  const h = await initFace();
  const canvas = await loadCanvas(src);
  const res = await h.detect(canvas);
  const faces = [];
  for (const f of res.face || []) {
    if (!f.embedding || !f.embedding.length) continue;
    const size = Math.min(f.box[2], f.box[3]);
    if (size < MIN_FACE_PX) continue;
    faces.push({
      box: f.box,
      size,
      emb: Array.from(f.embedding),
      cloth: clothHistogram(canvas, f.box),
      crop: withCrops ? await toDataURL(canvas, f.box) : undefined,
    });
  }
  return faces;
}

/** 파일에서 기준 얼굴 하나 만들기 (여러 명이면 가장 큰 얼굴) */
export async function referenceFromFile(file, date) {
  const faces = await detectFaces(file, { withCrops: true });
  if (!faces.length) return null;
  faces.sort((a, b) => b.size - a.size);
  const f = faces[0];
  return { id: crypto.randomUUID(), emb: f.emb, thumb: f.crop, date };
}
