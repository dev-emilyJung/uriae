// 얼굴 검출·임베딩·비교. @vladmandic/human 을 확장 안에 포함해 브라우저(WebGL)에서만 실행.
// 사진과 얼굴 데이터는 외부로 전송되지 않는다.
// 기준(우리 아이) 얼굴 임베딩만 저장하고, 다른 아이 얼굴은 비교 후 즉시 버린다.
import { Human } from '../vendor/human.esm.js';

const config = {
  modelBasePath: chrome.runtime.getURL('vendor/models/'),
  backend: 'webgl',
  debug: false,
  warmup: 'none',
  cacheSensitivity: 0,
  filter: { enabled: false },
  face: {
    enabled: true,
    detector: { rotation: false, maxDetected: 30, minConfidence: 0.3, return: false },
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
export async function loadCanvas(src) {
  const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

/** 이미지 속 모든 얼굴의 임베딩과 위치 */
export async function detectFaces(src) {
  const h = await initFace();
  const canvas = await loadCanvas(src);
  const res = await h.detect(canvas);
  return {
    width: canvas.width,
    height: canvas.height,
    faces: (res.face || [])
      .filter((f) => f.embedding && f.embedding.length)
      .map((f) => ({ box: f.box, score: f.score, emb: Array.from(f.embedding) })),
  };
}

/** 얼굴 하나 vs 기준 얼굴들 → 0~1 (높을수록 같은 사람) */
export function bestSimilarity(emb, refs) {
  let best = 0;
  for (const r of refs) {
    const s = human.match.similarity(emb, r.emb);
    if (s > best) best = s;
  }
  return best;
}

/** 사진 한 장의 "우리 아이" 점수 = 사진 속 얼굴들 중 최고 유사도 */
export async function scoreImage(src, refs) {
  const { faces } = await detectFaces(src);
  let best = 0;
  for (const f of faces) best = Math.max(best, bestSimilarity(f.emb, refs));
  return { score: best, faceCount: faces.length };
}

/** 기준 사진에서 얼굴 하나를 뽑아 임베딩 + 썸네일 생성. 여러 명이면 가장 큰 얼굴 */
export async function makeReference(src) {
  const canvas = await loadCanvas(src);
  const h = await initFace();
  const res = await h.detect(canvas);
  const faces = (res.face || []).filter((f) => f.embedding && f.embedding.length);
  if (!faces.length) return null;
  faces.sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
  const f = faces[0];
  const [x, y, w, hh] = f.box;
  const pad = Math.max(w, hh) * 0.25;
  const sx = Math.max(0, x - pad), sy = Math.max(0, y - pad);
  const sw = Math.min(canvas.width - sx, w + pad * 2), sh = Math.min(canvas.height - sy, hh + pad * 2);
  const t = new OffscreenCanvas(96, 96);
  t.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, 96, 96);
  const thumbBlob = await t.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  const thumb = await new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(thumbBlob);
  });
  return { id: crypto.randomUUID(), emb: Array.from(f.embedding), thumb, multi: faces.length > 1 };
}
