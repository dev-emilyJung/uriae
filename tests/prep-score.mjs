// 알림장 추출 채점 (정답: 준비물 목록과 마감일). prep-cases·prep-styles 테스트가 함께 쓴다.
import { extractFromPost } from '../extension/lib/extract.js';

const norm = (s) => s.replace(/[\s.,·()[\]~!*\-•:'‘’"]/g, '').toLowerCase();
// 정답 항목은 "A|B" 처럼 같은 뜻의 여러 표현을 허용한다
const same = (got, want) => want.split('|').some((w) => {
  const x = norm(got), y = norm(w);
  return x === y || (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)));
});

export function score(cases) {
  let tp = 0, fp = 0, fn = 0, dateOk = 0, dated = 0;
  const fails = [];
  for (const c of cases) {
    const r = extractFromPost({ ...c, content: [c.content, c.imgText].filter(Boolean).join('\n') });
    const want = [...c.expect.prep];
    const wrong = [];
    for (const got of r.prep) {
      const i = want.findIndex((w) => same(got, w));
      if (i >= 0) { tp++; want.splice(i, 1); } else { fp++; wrong.push(got); }
    }
    fn += want.length;
    // 날짜는 챙길 것이 있는 글만 본다 (마감일. 없는 글은 카드가 안 생긴다)
    const dOk = !c.expect.prep.length || (r.date || null) === (c.expect.date || null);
    if (c.expect.prep.length) { dated++; if (dOk) dateOk++; }
    if (wrong.length || want.length || !dOk) fails.push({ key: c.key, wrong, missed: want, date: dOk ? null : `${r.date} → 정답 ${c.expect.date}` });
  }
  return {
    cases: cases.length,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
    date: dated ? dateOk / dated : 1,
    fails,
  };
}
