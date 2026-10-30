// 알림장/공지 본문에서 "챙길 것"(준비물·복장·당부)과 "일정"을 뽑아내는 규칙 기반 추출기.
// 외부 서버나 AI를 쓰지 않고 브라우저 안에서만 동작한다.
// 규칙은 놓치는 게 있을 수 있으므로 UI에서는 항상 원문을 함께 보여준다.

const BULLET = /^\s*(?:[*\-•·▶▷►✔✓☑✅■□◆◇○●⭐★☆]|\d{1,2}[.)]|[①-⑳]|[가-하][.)])\s*/;
const PREP_ANCHOR = /(준비물|챙겨\s*(?:주|보내)|챙길\s*것|지참)/;
const DRESS_ANCHOR = /(복장|옷차림)/;
const REQUEST = /(챙겨|보내\s*주|지참|가져\s*(?:와|오)|입혀\s*주|입고\s*(?:와|오|등원)|착용|신겨\s*주|준비해\s*주|넣어\s*주)/;
const EVENT = /(견학|현장\s*학습|체험\s*학습|소풍|행사|공연|발표회|운동회|참관|휴원|방학|졸업|입학|생일\s*파티|축제|설명회|상담)/;
const TIME = /(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?\s*까지/;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Date → 'YYYY-MM-DD' (한국 시간 기준) */
export function ymd(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);
}
function parseYMD(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3)); // 정오 근처로 두어 시간대 경계 문제 회피
}
function addDays(s, n) {
  const d = parseYMD(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function weekday(s) {
  return parseYMD(s).getUTCDay();
}

/** 본문 속 날짜 표현을 기준일(글 작성일)로부터 계산 */
export function resolveDate(text, baseYMD) {
  const [by, bm, bd] = baseYMD.split('-').map(Number);
  const fix = (m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let y = by;
    // 12월에 쓴 글에서 "1월 5일" → 다음 해
    if (m < bm - 6) y += 1;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  let m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return fix(+m[1], +m[2]);

  m = text.match(/(?:^|[^\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/);
  if (m) {
    const r = fix(+m[1], +m[2]);
    if (r) return r;
  }

  m = text.match(/(?:^|[\s(（])(\d{1,2})\s*일\s*[)）(]/) || text.match(/\((\d{1,2})\s*일\)/);
  if (m) {
    const day = +m[1];
    let mon = bm;
    let year = by;
    if (day < bd - 7) mon += 1; // 작성일보다 한참 앞이면 다음 달
    if (mon > 12) { mon = 1; year += 1; }
    if (day < 1 || day > 31) return null;
    return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (/모레/.test(text)) return addDays(baseYMD, 2);
  if (/내일/.test(text)) return addDays(baseYMD, 1);
  if (/오늘/.test(text)) return baseYMD;

  m = text.match(/(다음\s*주|이번\s*주)?\s*([일월화수목금토])요일/);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    const cur = weekday(baseYMD);
    // 다음 주 X요일: 기준일이 속한 주(일~토)의 다음 주. 그 외: 기준일 이후 가장 가까운 X요일(당일 포함)
    const diff = m[1] && /다음/.test(m[1]) ? 7 - cur + target : (target - cur + 7) % 7;
    return addDays(baseYMD, diff);
  }
  return null;
}

function cleanItem(s) {
  return s
    .replace(/^\s*[*\-•·]+\s*/, '')
    .replace(BULLET, '')
    .replace(/^[\s:：\-|]+/, '')
    .replace(/[⭐★☆✨❤️💕😊🙏]/gu, '')
    .replace(/\s*\([^)]{8,}\)?\s*$/, '') // "물통 (도보 유아는 9시 30분까지 …)" 처럼 뒤에 붙은 긴 덧붙임
    .replace(/\s+/g, ' ')
    .trim();
}

/** 줄 단위로 쪼개되, 한 줄에 "* A * B" 처럼 붙은 불릿도 분리 */
function toLines(content) {
  const out = [];
  for (const raw of content.split(/\r?\n/)) {
    const parts = raw.split(/\s(?=[*•·▶✔☑■◆●]\s)/);
    for (const p of parts) if (p.trim()) out.push(p.trim());
  }
  return out;
}

function sentences(line) {
  return line.split(/(?<=[.!?。])\s+|(?<=다\.)/).map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {{id:number, source:'report'|'notice', date:string, title?:string, content:string}} post
 * @returns {{prep:string[], events:string[], times:string[], date:string|null}}
 */
export function extractFromPost(post) {
  const lines = toLines(post.content || '');
  const prep = [];
  const events = [];
  const times = [];
  const seen = new Set();
  const push = (arr, s) => {
    const c = cleanItem(s);
    if (c.length < 2 || c.length > 90) return;
    // 표 칸막이(|)·밑줄·홀로 된 자음/모음이 든 줄은 그림 글자를 잘못 읽은 것이라 항목이 아니다
    if (/[|｜_]|(?:^|\s)[ㄱ-ㅎㅏ-ㅣ](?=\s|$)/.test(c)) return;
    // "도시락은 준비하지 않습니다" 처럼 챙기지 않아도 된다는 안내
    if (arr === prep && /(?:않습니다|않아도|안\s*보내셔도|필요\s*없)/.test(c)) return;
    const key = c.replace(/\s/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    arr.push(c);
  };

  let prepLine = -1; // 준비물이 처음 나온 줄 (날짜를 그 근처에서 찾는다)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isAnchor = PREP_ANCHOR.test(line) || DRESS_ANCHOR.test(line);

    // "준비물: 물통, 모자, 운동화" 같은 한 줄 나열 (그림 글자에서는 : 가 ; 로 읽히기도 한다)
    const inline = line.match(/(?:준비물|복장)\s*[:：;]\s*(.+)/);
    if (inline) {
      if (prepLine < 0 && /준비물/.test(line)) prepLine = i;
      inline[1].split(/[,，、/]|\s및\s/).forEach((x) => push(prep, x));
      continue;
    }

    // 앵커 뒤에 이어지는 목록 수집 (불릿 줄, 또는 복장 안내 아래의 짧은 줄들)
    let collected = 0;
    if (isAnchor) {
      let j = i + 1;
      const dress = DRESS_ANCHOR.test(line);
      while (j < lines.length && collected < 15) {
        const next = lines[j];
        // "4. 겨울방학 일정 안내" 같은 다음 단락 제목에서는 멈춘다
        if (/^\d+\.\s.*(안내|일정|알림)\s*$/.test(next)) break;
        const ok = BULLET.test(next) || (dress && collected < 4 && next.length < 60 && !PREP_ANCHOR.test(next) && !/^\d+\.\s/.test(next));
        if (!ok) break;
        push(prep, next);
        j++;
        collected++;
      }
      if (collected) i = j - 1;
    }

    for (const s of sentences(line)) {
      // 목록을 이미 모은 앵커 줄의 문장은 항목으로 넣지 않음.
      // "준비물을 확인하시고 꼭 챙겨주세요" 같은 안내 문장도 실제 항목이 아니므로 제외
      if (!collected && REQUEST.test(s) && !/준비물을?\s*(확인|참고)/.test(s)) push(prep, s);
      if (EVENT.test(s) && !PREP_ANCHOR.test(s)) push(events, s.replace(/^안녕하세요[^\s]*\s*/, ''));
      const t = s.match(TIME);
      if (t) times.push(cleanItem(s));
    }
  }

  // 날짜: 준비물 줄 바로 위의 "일정 : 10월 28일" 같은 줄(여러 행사를 한 장에 안내하는 가정통신문),
  // 다음은 앵커/일정 문장이 있는 줄, 없으면 본문 전체
  let date = null;
  for (let j = prepLine; j >= 0 && j >= prepLine - 4 && !date; j--) {
    if (j < prepLine && /^\d+[.,]\s/.test(lines[j])) break; // 앞 단락으로 넘어가지 않는다
    date = resolveDate(lines[j], post.date);
  }
  const focus = lines.filter((l) => PREP_ANCHOR.test(l) || EVENT.test(l)).join(' ');
  date ||= resolveDate(focus, post.date) || resolveDate((post.title || '') + ' ' + (post.content || ''), post.date);

  return { prep, events: events.slice(0, 3), times: times.slice(0, 2), date };
}

/** 여러 글을 카드 목록으로. 챙길 것이 하나도 없는 글은 제외 */
export function buildCards(posts) {
  const cards = [];
  for (const p of posts) {
    // 그림 안내문(p.docImages)에서 읽은 글자(p.imgText)도 본문과 같이 살핀다
    const r = extractFromPost({ ...p, content: [p.content, p.imgText].filter(Boolean).join('\n') });
    const images = p.docImages || [];
    // 챙길 것도 일정도 못 찾았어도 그림 안내문이 있으면 직접 볼 수 있게 카드로 남긴다
    if (!r.prep.length && !r.events.length && !images.length) continue;
    cards.push({
      key: `${p.source}:${p.id}`,
      source: p.source,
      who: p.who || [],
      postDate: p.date,
      date: r.date || p.date,
      dateGuessed: !r.date,
      title: p.title || bracketTitle(p.content) || shorten(r.events[0]) || firstLine(p.content) || firstLine(p.imgText) || '그림으로 온 안내',
      prep: r.prep,
      events: r.events,
      times: r.times,
      content: p.content,
      images,
      imgText: p.imgText || '',
    });
  }
  cards.sort((a, b) => a.date.localeCompare(b.date));
  return cards;
}

/** "[생일파티 안내] ..." 처럼 대괄호로 시작하는 제목 */
function bracketTitle(s = '') {
  const m = s.trim().match(/^\[([^\]]{2,30})\]/);
  return m ? m[1].trim() : '';
}
/** 일정 문장을 제목으로 쓸 때: 인사말·끝맺음 정리 */
function shorten(s) {
  if (!s) return '';
  const t = s.replace(/^\[[^\]]*\]\s*/, '').replace(/\s*(입니다|있습니다|예정입니다|진행됩니다)[.!~]*$/, '').trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

function firstLine(s = '') {
  const l = s.split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
  return l.length > 40 ? l.slice(0, 40) + '…' : l;
}

/**
 * 그림 안내문에서 읽은 글자 정리 (lib/ocr.js).
 * - 표: "준비물      도시락, 물통" (짧은 이름 + 큰 빈칸) → "준비물: 도시락, 물통" 으로 바꿔 준비물 규칙이 알아듣게
 * - 두 단: 왼쪽 글이 길면 큰 빈칸 뒤는 오른쪽 단으로 보고 왼쪽 단 다음에 이어 붙인다
 * - 기호만 남은 줄(그림·테두리를 글자로 잘못 읽은 것)은 버린다
 */
const TABLE_LABEL = /^(?=.{1,8}$)[가-힣()\s]*[가-힣)](?<![요다])$/; // 일시, 장소, 준비물, 복장(남아) … 문장 끝(요·다)은 제외
export function cleanOcrText(raw) {
  const left = [], right = [];
  for (const line of raw.replace(/＊/g, '*').split(/\r?\n/)) {
    const parts = line.trim().split(/\s{4,}/).filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1) left.push(parts[0]);
    else if (TABLE_LABEL.test(parts[0])) left.push(`${parts[0]}: ${parts.slice(1).join(' ')}`);
    else {
      left.push(parts[0]);
      right.push(...parts.slice(1));
    }
  }
  return [...left, ...right]
    // 줄 앞에 붙은 부스러기(홀로 된 자음·모음, 세로줄, 마침표 따위)는 떼어낸다. 불릿(* - · ※)은 남긴다
    .map((l) => l.replace(/\s+/g, ' ').trim().replace(/^(?:[ㄱ-ㅎㅏ-ㅣ|。:;$>]+\s+)+/, ''))
    .filter((l) => {
      const ok = (l.match(/[가-힣0-9]/g) || []).length;
      return ok >= 2 && ok >= l.replace(/\s/g, '').length * 0.5;
    })
    .map(fixOcrLine)
    .join('\n');
}

// ── 그림 글자 바로잡기 ──
// 그림 글자는 한 글자 안에서 자음·모음 하나가 비슷한 모양으로 바뀌는 일이 많다 (준비몰→준비물, 불통→물통, 5열→5일).
// 날짜와 안내문에 자주 나오는 낱말만, 자모 하나(긴 낱말은 둘)까지 다를 때 바로잡는다.
// 낱말 뒤가 비었거나 조사일 때만 고친다: "상당히"·"복잡한" 같은 다른 낱말을 건드리지 않게
const OCR_WORDS = [
  '준비물', '물통', '수저', '수저통', '도시락', '여벌옷', '원복', '체육복', '운동화', '실내화', '모자', '돗자리', '우비', '장화',
  '물티슈', '손수건', '간식', '점심', '견학', '현장학습', '소풍', '행사', '일정', '행사일정', '상담', '학부모', '담임', '등원',
  '방학', '방학식', '개학식', '졸업', '수료', '생일', '생일축하', '참가비', '동의서', '신청서', '가정통신문',
  '출발', '도착', '장소', '일시', '안내', '유치원', '어린이집', '선생님', '체험학습', '겨울방학', '여름방학', '보내주세요', '챙겨주세요',
];
// 그림 글자에서 실제로 자주 헷갈리는 모양 (초성·중성·종성 번호 짝). 두 글자 낱말은 이 경우만 고친다 ("우리"→"우비" 같은 일 막기)
const LOOKALIKE = [
  [[6, 7], [6, 11], [14, 18]], // 초성 ㅁㅂ ㅁㅇ ㅊㅎ
  [[4, 6], [8, 13], [6, 20], [1, 5], [13, 18]], // 중성 ㅓㅕ ㅗㅜ ㅕㅣ ㅐㅔ ㅜㅡ
  [[8, 16], [16, 21], [7, 8]], // 종성 ㄹㅁ ㅁㅇ ㄷㄹ
].map((pairs) => new Set(pairs.flatMap(([a, b]) => [`${a},${b}`, `${b},${a}`])));
function lookalike(a, b) {
  const x = jamo(a), y = jamo(b);
  return !!x && !!y && [0, 1, 2].every((i) => x[i] === y[i] || LOOKALIKE[i].has(`${x[i]},${y[i]}`));
}
const OCR_SET = new Set(OCR_WORDS);
const PARTICLE = /^(?:은|는|이|가|을|를|의|에|에서|에게|도|과|와|로|으로|만|까지|부터|및|입니다)?$/;
const WEEKDAY = '월화수목금토일';

function jamo(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  return c < 0 || c > 11171 ? null : [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28];
}
/** 두 글자의 초성·중성·종성 중 다른 개수 (한글이 아니면 크게) */
function jamoDiff(a, b) {
  if (a === b) return 0;
  const x = jamo(a), y = jamo(b);
  return x && y ? (x[0] !== y[0]) + (x[1] !== y[1]) + (x[2] !== y[2]) : 9;
}
function fixWord(w) {
  for (let n = 2; n <= w.length; n++) if (OCR_SET.has(w.slice(0, n)) && PARTICLE.test(w.slice(n))) return w; // 이미 맞는 낱말
  for (const word of OCR_WORDS) {
    const n = word.length;
    if (w.length < n || !PARTICLE.test(w.slice(n))) continue;
    let d = 0;
    for (let i = 0; i < n && d < 9; i++) d += jamoDiff(w[i], word[i]);
    if (d === 0 || d > (n >= 4 ? 2 : 1)) continue;
    if (n === 2 && ![0, 1].every((i) => w[i] === word[i] || lookalike(w[i], word[i]))) continue;
    return word + w.slice(n);
  }
  return w;
}

/** 그림에서 읽은 한 줄 바로잡기 (낱말, 날짜, 요일) */
export function fixOcrLine(line) {
  return line
    .replace(/[가-힣]+/g, fixWord)
    // 숫자 뒤 "월"·"일"이 비슷한 글자로 읽힌 것: 11뭘, 11될, 12를 → 월 / 5열, 6얼, 19밀 → 일
    .replace(/(\d)\s?(?:뭘|될|훨|윌|웰|를|뮐|룰|웜)(?=[\s(~),.]|$)/g, '$1월')
    .replace(/(\d)\s?(?:열|얼|밀|길|엘|올)(?=[\s(~),.]|$)/g, '$1일')
    // 괄호 속 요일: (복)→(목), (뭘)→(월), (목} → (목)
    .replace(/\(([가-힣])[)}]/g, (m, c) => {
      if (WEEKDAY.includes(c)) return `(${c})`;
      const near = [...WEEKDAY].filter((w) => jamoDiff(c, w) === 1);
      return near.length === 1 ? `(${near[0]})` : m;
    })
    // 12를 넘는 달: 1 을 7 로 잘못 읽은 것 (17월 → 11월, 77월 → 11월)
    .replace(/(?<!\d)(\d{2})월/g, (m, mm) => {
      if (+mm <= 12) return m;
      const f = mm.replaceAll('7', '1');
      return +f >= 1 && +f <= 12 ? `${f}월` : m;
    });
}

/** 식단표·주간교육계획안처럼 표가 많은 참고 자료: 그림은 보여주되 챙길 것을 뽑지는 않는다 */
export function isReferenceDoc(text) {
  const head = text.split('\n').slice(0, 4).join(' ');
  return /식단|계획안|교육\s*계획|생활\s*주제|교육\s*기간|시기\s*\d{4}/.test(head);
}

/** 글자가 대부분 깨져 읽힌 그림(영어 교재, 사진이 많은 안내 등): 챙길 것을 뽑지 않는다 */
export function isReadable(text) {
  const chars = text.replace(/\s/g, '');
  return chars.length > 0 && (text.match(/[가-힣]/g) || []).length / chars.length >= 0.55;
}
