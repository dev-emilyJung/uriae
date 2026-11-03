// 문제 진단 파일: 잘 안 된다는 이용자가 직접 내려받아 직접 보내는 수치 모음.
// 확장 프로그램은 이 파일을 어디로도 보내지 않는다. 사진·얼굴 특징값·이름은 넣지 않는다.
import { store, K } from './store.js';

const KEEP = { runs: 20, ocr: 100, errors: 30 };

/** 주소·긴 숫자(키즈노트 id 등)를 지워 오류 문장만 남긴다 */
export function scrub(s = '') {
  return String(s)
    .replace(/https?:\/\/\S+|chrome-extension:\/\/[a-z]+/g, '…')
    .replace(/\d{5,}/g, '#')
    .slice(0, 300);
}

async function push(field, item) {
  const d = await store.get(K.diag, {});
  d[field] = [...(d[field] || []), item].slice(-KEEP[field]);
  await store.set(K.diag, d);
}

/** 사진 찾기 한 번의 수치 (사진 수, 걸린 시간, 백그라운드에 있던 시간, 얼굴 수 분포) */
export const logRun = (run) => push('runs', { at: Date.now(), ...run });
/** 그림 한 장 읽기의 수치 (걸린 시간, 안내문 판정, 글자 수) */
export const logOcr = (r) => push('ocr', { at: Date.now(), ...r });
export function logError(e, where = '') {
  return push('errors', { at: Date.now(), where, msg: scrub(e?.message || e), stack: scrub((e?.stack || '').split('\n').slice(1, 4).join(' | ')) }).catch(() => {});
}

/** 이 탭이 백그라운드에 있던 시간을 잰다 (사진 찾기가 느린 이유를 가르기 위해) */
export function hiddenTimer() {
  let total = 0, since = document.hidden ? Date.now() : 0;
  const on = () => {
    if (document.hidden) since = Date.now();
    else if (since) { total += Date.now() - since; since = 0; }
  };
  document.addEventListener('visibilitychange', on);
  return () => {
    document.removeEventListener('visibilitychange', on);
    return total + (since ? Date.now() - since : 0);
  };
}

const hangulRatio = (t) => {
  const s = t.replace(/\s/g, '');
  return s.length ? +((s.match(/[가-힣]/g) || []).length / s.length).toFixed(2) : 0;
};

/**
 * 진단 파일 내용. prep: 마지막으로 연 챙길 것 탭의 {posts, cards} (없으면 null)
 * withText 일 때만 알림장·공지 원문, 그림에서 읽은 글자, 뽑은 준비물을 넣는다.
 */
export function buildReport({ env, settings, diag, faceLog, ocr, prep, withText, isReadable, isReferenceDoc }) {
  const docs = Object.values(ocr).filter((v) => v.doc);
  const report = {
    kind: 'uriae-diagnostic',
    version: 1,
    madeAt: new Date().toISOString(),
    env,
    settings,
    photoRuns: diag.runs || [],
    photoAnswers: faceLog, // 맞아요/아니에요 답과 그 사진의 판정 숫자 (얼굴 정보·사진 없음)
    ocr: {
      images: Object.keys(ocr).length,
      docs: docs.length,
      docStats: docs.map((v) => ({ chars: v.text.length, hangul: hangulRatio(v.text), readable: isReadable(v.text), reference: isReferenceDoc(v.text) })),
      reads: diag.ocr || [],
    },
    prep: prep && {
      posts: prep.posts.length,
      cards: prep.cards.map((c) => ({
        source: c.source, prep: c.prep.length, events: c.events.length, times: c.times.length,
        dateGuessed: !!c.dateGuessed, images: c.images.length, fromImage: !!c.imgText,
      })),
    },
    errors: diag.errors || [],
  };
  if (withText && prep) {
    report.prepText = prep.posts.map((p) => {
      const key = `${p.source}:${p.id}`;
      const found = prep.cards.filter((c) => c.key === key || c.key.startsWith(key + '@'));
      return {
        source: p.source, date: p.date, title: p.title, content: p.content, imgText: p.imgText || '',
        found: found.map((c) => ({ date: c.date, dateGuessed: !!c.dateGuessed, prep: c.prep, events: c.events, times: c.times })),
      };
    });
  }
  return report;
}
