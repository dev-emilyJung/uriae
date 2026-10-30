// 모의 반 앨범 만들기 (face-sim 테스트와 분석 스크립트가 함께 쓴다).
// 아이마다 중심 벡터가 있고 사진마다 흔들리는 얼굴. 우리 아이(0), 닮은 친구 2명(1·2), 나머지 17명. 단체사진·흐린 얼굴·알림장 포함.

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function album(seed) {
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const D = 128;
  const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  const randUnit = () => norm(Array.from({ length: D }, gauss));
  const mix = (a, b, w) => norm(a.map((x, i) => w * x + (1 - w) * b[i]));
  const ours = randUnit();
  const kids = [ours, mix(ours, randUnit(), 0.55), mix(ours, randUnit(), 0.5), ...Array.from({ length: 17 }, randUnit)];
  // 아이 중심에 길이 blur 인 잡음을 더한 얼굴 (blur 가 클수록 흐리고 작은 얼굴)
  const shake = (k, blur) => {
    const n = Array.from({ length: D }, gauss);
    const nn = Math.hypot(...n);
    return norm(kids[k].map((x, i) => x + (blur * n[i]) / nn));
  };
  const mk = (k) => {
    const blur = 0.7 + rand() * 0.9;
    return { kid: k, emb: shake(k, blur), size: blur > 1.4 ? 40 + rand() * 20 : 60 + rand() * 120, score: 0.85 + rand() * 0.15 };
  };
  const photos = [];
  for (let i = 0; i < 400; i++) {
    const r = rand();
    const n = r < 0.35 ? 1 : r < 0.6 ? 2 + Math.floor(rand() * 2) : 6 + Math.floor(rand() * 10);
    const who = new Set();
    while (who.size < n) who.add(Math.floor(rand() * kids.length));
    photos.push({ id: `p${i}`, date: '2026-10-01', faces: [...who].map(mk) });
  }
  const refs = Array.from({ length: 5 }, () => ({ emb: shake(0, 0.7), date: '2026-10-01' }));
  // 알림장: 대부분 우리 아이 독사진, 가끔 다른 아이·단체사진
  const trusted = Array.from({ length: 30 }, (_, i) => {
    const k = rand() < 0.85 ? 0 : 3 + Math.floor(rand() * 17);
    return { id: `r${i}`, date: '2026-10-01', faces: rand() < 0.8 ? [mk(k)] : [mk(k), mk(5), mk(6)] };
  });
  return { photos, refs, trusted };
}
