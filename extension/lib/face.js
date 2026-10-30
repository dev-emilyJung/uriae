// 얼굴 찾기와 얼굴 특징값 계산. 모두 브라우저(WebGL) 안에서만 실행하고, 사진과 얼굴 정보는 밖으로 보내지 않는다.
// 저장하는 것은 우리 아이 기준 얼굴뿐이고, 다른 아이 얼굴은 비교 후 버린다.
//
// 1) @vladmandic/human 으로 얼굴 위치와 윤곽점(468개)을 찾고
// 2) 눈·코·입꼬리 5점을 ArcFace 표준 위치에 맞춰 112×112로 정렬한 뒤
// 3) InsightFace(mobilenet-swish) 모델로 특징값을 계산한다.
// 정렬 없이 넣으면 정확도가 크게 떨어진다(공개 얼굴 데이터 측정: 정렬 시 같은 사람과 다른 사람 점수가 겹치지 않음).
import { Human } from '../vendor/human.esm.js';

export const MODEL_ID = 'insightface-swish-aligned-v1';
const MIN_FACE_PX = 36; // 이보다 작은 얼굴은 특징값이 너무 부정확해서 제외

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
    description: { enabled: false },
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

// ArcFace 표준 5점 (112×112): 왼눈, 오른눈, 코끝, 왼입꼬리, 오른입꼬리
const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

let human;
let embedder;
export async function initFace() {
  if (human && embedder) return human;
  human = new Human(config);
  // 다른 탭을 보고 있으면 크롬이 타이머를 최대 1분에 한 번으로 늦춘다. GPU 결과를 기다리는 확인을
  // 타이머 대신 postMessage로 하게 해서 탭이 가려져 있어도 속도가 유지되게 한다.
  human.tf.env().set('USE_SETTIMEOUTCUSTOM', true);
  await human.load();
  embedder = await human.tf.loadGraphModel(chrome.runtime.getURL('vendor/models/insightface-mobilenet-swish.json'));
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

async function toDataURL(canvas, box, size = 160) {
  const [x, y, w, h] = box;
  const pad = Math.max(w, h) * 0.2;
  const sx = Math.max(0, x - pad), sy = Math.max(0, y - pad);
  const sw = Math.min(canvas.width - sx, w + pad * 2), sh = Math.min(canvas.height - sy, h + pad * 2);
  const t = new OffscreenCanvas(size, size);
  t.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, size, size);
  const blob = await t.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(blob);
  });
}

const avg = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

/** 윤곽점(468개)에서 눈 중심 2개, 코끝, 입꼬리 2개 */
function fivePoints(mesh) {
  return [avg([mesh[33], mesh[133]]), avg([mesh[362], mesh[263]]), mesh[1], mesh[61], mesh[291]].map((p) => [p[0], p[1]]);
}

/** 5점 → 표준 위치로 가는 닮음변환(회전·크기·이동) 최소제곱 */
function similarity(src, dst) {
  const n = src.length;
  const [sx, sy] = avg(src), [dx, dy] = avg(dst);
  let a = 0, b = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy, qx = dst[i][0] - dx, qy = dst[i][1] - dy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    d += px * px + py * py;
  }
  const c = a / d, s = b / d;
  return { c, s, tx: dx - (c * sx - s * sy), ty: dy - (s * sx + c * sy) };
}

async function embedPixels(pixels) {
  const tf = human.tf;
  const input = tf.tidy(() => tf.expandDims(tf.div(tf.cast(tf.browser.fromPixels(pixels), 'float32'), 255), 0));
  const out = embedder.execute(input);
  const v = Array.from(await out.data());
  tf.dispose([input, out]);
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

/**
 * 정렬한 112×112 얼굴 → 특징값.
 * 좌우 반전한 얼굴의 특징값과 평균한다(ArcFace 표준 기법). 조명·고개 방향에 덜 흔들린다.
 * 반전 없는 예전 특징값과도 방향이 거의 같아서 저장된 기준 얼굴은 그대로 쓴다.
 */
async function embed(canvas, mesh) {
  const m = similarity(fivePoints(mesh), TEMPLATE);
  const t = new OffscreenCanvas(112, 112);
  const ctx = t.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(m.c, m.s, -m.s, m.c, m.tx, m.ty);
  ctx.drawImage(canvas, 0, 0);
  const a = await embedPixels(ctx.getImageData(0, 0, 112, 112));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 112, 112);
  ctx.setTransform(-m.c, m.s, m.s, m.c, 112 - m.tx, m.ty);
  ctx.drawImage(canvas, 0, 0);
  const b = await embedPixels(ctx.getImageData(0, 0, 112, 112));
  return a.map((x, i) => x + b[i]);
}

/**
 * 사진 속 얼굴들의 특징값.
 * withCrops: 얼굴 고르기 화면용 작은 얼굴 이미지도 함께 (메모리에서만 사용, 저장하지 않음)
 */
export async function detectFaces(src, { withCrops = false } = {}) {
  const h = await initFace();
  const canvas = src instanceof OffscreenCanvas ? src : await loadCanvas(src);
  const res = await h.detect(canvas);
  const faces = [];
  for (const f of res.face || []) {
    if (!f.mesh || f.mesh.length < 300) continue;
    const size = Math.min(f.box[2], f.box[3]);
    if (size < MIN_FACE_PX) continue;
    faces.push({
      box: f.box,
      nbox: [f.box[0] / canvas.width, f.box[1] / canvas.height, f.box[2] / canvas.width, f.box[3] / canvas.height], // 사진 크기 대비 비율
      size,
      emb: await embed(canvas, f.mesh),
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
  return { id: crypto.randomUUID(), emb: f.emb, thumb: f.crop, date, model: MODEL_ID };
}

/**
 * 예전 모델로 만든 기준 얼굴을 새 모델로 다시 계산. 저장해 둔 얼굴 썸네일에서 얼굴을 다시 찾는다.
 * 실패하면 null (다시 골라야 함)
 */
export async function upgradeReference(ref) {
  if (ref.model === MODEL_ID) return ref;
  try {
    const blob = await (await fetch(ref.thumb)).blob();
    const bmp = await createImageBitmap(blob);
    // 썸네일이 작아서 2배로 키운 뒤 얼굴을 찾는다
    const c = new OffscreenCanvas(bmp.width * 2, bmp.height * 2);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const faces = await detectFaces(c);
    if (!faces.length) return null;
    faces.sort((a, b) => b.size - a.size);
    return { ...ref, emb: faces[0].emb, model: MODEL_ID };
  } catch {
    return null;
  }
}
