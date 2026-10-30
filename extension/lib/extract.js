// 알림장/공지 본문에서 "챙길 것"(준비물·복장·당부)과 "일정"을 뽑아내는 규칙 기반 추출기.
// 외부 서버나 AI를 쓰지 않고 브라우저 안에서만 동작한다.
// 규칙은 놓치는 게 있을 수 있으므로 UI에서는 항상 원문을 함께 보여준다.

const BULLET = /^\s*(?:[*\-•·▶▷►✔✓☑✅■□◆◇○●⭐★☆※]|\d{1,2}[.)]|[①-⑳]|[가-하][.)])\s*/u;
const CHECK_BULLET = /^\s*[✔✓☑✅□]/u; // 체크 표시 목록은 앵커 낱말이 없어도 준비물 목록으로 본다
const PREP_ANCHOR = /(준비물|챙겨\s*(?:주|보내)|챙길\s*것|지참)/;
const DRESS_ANCHOR = /(복장|옷차림)/;
// 부모에게 무언가를 해 달라는 말 (챙기기·보내기·입히기·제출·납부·회신)
const REQUEST = /(챙겨|보내\s*주|지참|가져\s*(?:와|오|옵)|입혀\s*주|입혀\s*서|입고\s*(?:와|오|등원)|착용(?:시켜|하여|해)\s*(?:주|보내|등원)|신겨\s*주|준비해\s*주|넣어\s*주|(?:회신|제출|납부|신청)(?:해|하여)?\s*(?:주(?:세요|시기|십시오|시면)|부탁|바랍)|제출합니다|체크(?:해|하여)\s*주|참여해\s*주|알려\s*주(?:세요|시기|십시오))/;
// 하지 말라는 말·하지 않아도 된다는 말·고를 수 있는 것("가져오시거나 …확인해 주세요")은 준비물이 아니다
const NOTE = /(않습니다|않아도|않으셔도|않으며|보내지\s*않|안\s*보내셔도|필요\s*없|금지|제한|자제|금합니다|삼가|시거나[^.]*확인|라고\s*(?:이야기|말|하))/; // 마지막: 전한 말("챙겨 오라고 이야기했더니")
// 아플 때만 해당하는 당부 ("증상이 있는 경우 마스크를 …")
const IF_SICK = /(증상|발열|열이|아픈|아플)[^.]{0,40}(?:경우|시\s)/;
const SENTENCE_END = /(니다|세요|요|죠)[.!~^]*\s*$/;
// "보내실 교재 : …", "보낼 날짜 : …" 처럼 "이름 : 값" 으로 쓴 줄
const LABEL_LINE = /^([가-힣][가-힣\s()]{0,12}?)\s*[:：]\s*(.+)$/;
const DATE_LABEL = /(일자|날짜|기한|마감|기간)/; // 마감일 (대상 기간·교육 기간 등은 제외)
const ITEM_LABEL = /(준비물|복장|교재|보내실|보낼|가져올|지참|제출)/;
const HEADING = /^\s*[◆■□▣◇●○【[]\s*([^\]】:：]{2,24}?)\s*[\]】]?\s*$/u; // "◆ 수와 셈", "[졸업사진 대금 납부 안내]"
const GENDER = /^(남아|여아|남자\s*어린이|여자\s*어린이)\s*[):：]\s*/;
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

  // "2026. 10. 29.(목)", "10. 29.(목)", "2026-10-29"
  m = text.match(/(?:20\d{2}\s*[.\-]\s*)?(\d{1,2})\s*[.\-]\s*(\d{1,2})\s*\.?\s*\([일월화수목금토]\)/) || text.match(/20\d{2}-(\d{2})-(\d{2})/);
  if (m) {
    const r = fix(+m[1], +m[2]);
    if (r) return r;
  }

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
    .replace(/[⭐★☆✨❤️💕😊🙏💛]|️/gu, '')
    .replace(/\s*\([^)]{8,}\)?\s*$/, '') // "물통 (도보 유아는 9시 30분까지 …)" 처럼 뒤에 붙은 긴 덧붙임
    .replace(/\s+/g, ' ')
    .trim();
}

/** 줄 단위로 쪼개되, 한 줄에 "* A * B" 처럼 붙은 불릿도 분리 */
function toLines(content) {
  const out = [];
  for (const raw of content.split(/\r?\n/)) {
    const parts = raw.split(/\s(?=[*•·▶✔☑■◆●]\s)/);
    for (const p of parts) {
      // 문장 사이의 꾸밈 이모지는 지운다("한복을 입고⭐ 등원"). 맨 앞은 불릿일 수 있어 둔다
      const t = p.trim().replace(/(?<=.)(?:[⭐★☆✨❤💕😊🙏💛]|️)/gu, '');
      if (!t) continue;
      // 문장 중간에서 줄이 바뀐 짧은 끝부분("…월요일까지\n가져옵니다.")은 앞 줄에 잇는다
      const prev = out[out.length - 1];
      const tail = t.length <= 12 && !BULLET.test(t) && !/[:：]/.test(t) && /(니다|세요|요)[.!~]*$/.test(t);
      if (prev && tail && !/[.!?:：)]\s*$|(니다|세요|요)\s*$/.test(prev)) out[out.length - 1] = `${prev} ${t}`;
      else out.push(t);
    }
  }
  return out;
}

function sentences(line) {
  return line.split(/(?<=[.!?。])\s+|(?<=다\.)/).map((s) => s.trim()).filter(Boolean);
}

/** "원복 입혀서 보내주시고 운동화 신겨 주세요" → 요청 하나씩 */
function clauses(sentence) {
  return sentence.split(/(?<=(?:주시고|하시고|보내시고|챙기시고))\s+/).map((s) => s.trim()).filter(Boolean);
}

/** 날짜·요청 말을 빼고 남는 게 없는 요청 ("(목)까지 원으로 보내주세요", "월요일에 보내주시면 감사하겠습니다") */
function objectless(s) {
  const rest = s
    .replace(/\d{1,4}\s*[.\-/년월일]\s*/g, '')
    .replace(/\([일월화수목금토]\)|[일월화수목금토]요일|다음\s*주|이번\s*주|내일|모레|오늘|까지|매주/g, '')
    .replace(/(챙겨|보내|가져|제출|회신|납부|주세요|주시기|주시면|주십시오|바랍니다|감사|하겠습니다|부탁|드립니다|원으로|으로|에|꼭|다시|미리|함께|해|주|요)/g, '')
    .replace(/[^가-힣a-zA-Z0-9]/g, '');
  return rest.length < 2;
}

/** 나열을 낱개로: "칫솔, 치약, 컵" / 요청 앞의 짧은 나열 "수저통, 개인수건 챙겨 보내주세요" */
function splitList(item) {
  const m = item.match(/^(.*?)\s*(?:을|를)?\s*(챙겨|보내|가져|준비해|넣어)/);
  const head = m ? m[1] : SENTENCE_END.test(item) ? null : item;
  if (!head) return [item];
  const parts = head
    .replace(/^(기존대로|평소대로|꼭|반드시|함께|그리고|또한)\s*/, '')
    .split(/(?<!\d)\s*[,，、]\s*(?!\d)|(?<=[가-힣])(?:와|과)\s+|\s및\s/) // "68,000원" 의 쉼표는 나누지 않는다
    .map((x) => x.replace(/\s*총?\s*\d+\s*권$/, '').trim())
    .filter(Boolean);
  // 낱말 나열일 때만 나눈다 ("긴바지 세트로 바꾸어 함께" 같은 마디가 섞이면 그대로)
  if (parts.length < 2 || parts.some((x) => x.length > 16 || /(하여|으로|로\s|에서|에게|하고|[은는]\s|[어아여]\s)/.test(x))) return [item];
  return parts;
}

/**
 * @param {{id:number, source:'report'|'notice', date:string, title?:string, content:string}} post
 * @returns {{prep:string[], dates:(string|null)[], events:string[], times:string[], date:string|null}}
 *   dates: 준비물마다의 날짜 (행사 준비물은 행사일, "~까지 보내주세요"는 그 마감일). date: 그중 가장 이른 날
 */
export function extractFromPost(post) {
  const lines = toLines(post.content || '');
  const prep = [];
  const meta = []; // prep 과 같은 순서: { list: 준비물 목록·복장인지, due: 이 항목에 적힌 마감일 }
  const events = [];
  const times = [];
  const deadlines = []; // "~까지 보내주세요", "보낼 날짜 : …" 처럼 행동의 마감일
  const seen = new Set();
  const push = (arr, s, { list = false, due = null } = {}) => {
    const c = cleanItem(s);
    // 한 글자는 "컵"·"책" 같은 낱말만 (나열에서 나온 것)
    if ((c.length < 2 && !(list && /^[가-힣]$/.test(c))) || c.length > 90) return false;
    // 표 칸막이(|)·밑줄·홀로 된 자음/모음이 든 줄은 그림 글자를 잘못 읽은 것이라 항목이 아니다
    if (/[|｜_]|(?:^|\s)[ㄱ-ㅎㅏ-ㅣ](?=\s|$)/.test(c)) return false;
    if (arr === prep && (NOTE.test(c) || IF_SICK.test(c) || (!list && objectless(c)))) return false;
    const key = c.replace(/\s/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    arr.push(c);
    if (arr === prep) meta.push({ list, due });
    return true;
  };
  const addDeadline = (text) => {
    const cut = text.lastIndexOf('까지');
    const d = resolveDate(cut >= 0 ? text.slice(0, cut + 2) : text, post.date);
    if (d) deadlines.push(d);
    return d;
  };

  let prepLine = -1; // 준비물이 처음 나온 줄 (날짜를 그 근처에서 찾는다)
  let heading = null; // 바로 위 소제목 ("◆ 수와 셈"). "- …까지 가져옵니다" 같은 하위 줄의 항목 이름이 된다
  let headingDone = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isAnchor = PREP_ANCHOR.test(line) || DRESS_ANCHOR.test(line);
    const sub = /^\s*[-·]/.test(line); // 소제목 아래 하위 줄

    const hd = line.match(HEADING);
    if (hd && !SENTENCE_END.test(line)) {
      heading = cleanItem(hd[1]).replace(/\s*안내$/, '');
      headingDone = false;
    } else if (!sub) heading = null;

    // "이름 : 값" 줄: 마감일(보낼 날짜·납부기간·신청 기한 …) 또는 항목(보내실 교재·준비물·복장 …)
    const lbl = line.replace(BULLET, '').match(LABEL_LINE);
    if (lbl) {
      const [, name, value] = lbl;
      // 마감일: "기한·마감"은 그대로, "기간·일자·날짜"는 보내기·제출·신청·납부 같은 행동과 함께 쓸 때만 ("상담기간"은 일정)
      if (DATE_LABEL.test(name) && (/(기한|마감)/.test(name) || /(보내|보낼|제출|신청|납부|회신|조사|접수|모집)/.test(name) || /까지/.test(value))) {
        const range = value.split(/\s*~\s*/);
        const before = deadlines.length;
        addDeadline(range[range.length - 1]);
        if (range.length > 1 && deadlines.length === before) addDeadline(range[0]);
        continue;
      }
      if (ITEM_LABEL.test(name)) {
        if (prepLine < 0) prepLine = i;
        // "제출 : 쓰기노트 가정연계 후 매주 월요일 …제출합니다" → 앞의 이름만
        const isSubmit = /제출/.test(name);
        const v = isSubmit ? value.split(/\s+(?:가정연계|후|매주|매일|까지)\s|(?<=[가-힣])(?:을|를)\s/)[0] : value;
        const due = isSubmit || /까지/.test(value) ? addDeadline(value) : null;
        v.split(/[,，、/]|\s및\s/).forEach((x) => push(prep, x.replace(/\s*총?\s*\d+\s*권$/, ''), { list: !due, due }));
        continue;
      }
    }

    // "준비물: 물통, 모자, 운동화" 같은 한 줄 나열 (그림 글자에서는 : 가 ; 로 읽히기도 한다)
    const inline = line.match(/(?:준비물|복장)\s*[:：;]\s*(.+)/);
    if (inline) {
      if (prepLine < 0 && /준비물/.test(line)) prepLine = i;
      inline[1].split(/[,，、/]|\s및\s/).forEach((x) => push(prep, x, { list: true }));
      continue;
    }

    // 앵커 뒤에 이어지는 목록 수집 (불릿 줄, 또는 복장 안내 아래의 짧은 줄들). 체크 표시(✅) 목록은 앵커 없이도
    let collected = 0;
    const checkList = !isAnchor && CHECK_BULLET.test(line) && CHECK_BULLET.test(lines[i + 1] || '');
    if (isAnchor || checkList) {
      let j = isAnchor ? i + 1 : i;
      const dress = DRESS_ANCHOR.test(line);
      const tagged = []; // 남아/여아 복장 [{tag, part}]
      while (j < lines.length && collected < 15) {
        const next = lines[j];
        // "4. 겨울방학 일정 안내" 같은 다음 단락 제목에서는 멈춘다
        if (/^\d+\.\s.*(안내|일정|알림)\s*$/.test(next)) break;
        const declarative = SENTENCE_END.test(next) && !REQUEST.test(next);
        const ok = BULLET.test(next) || (dress && collected < 4 && next.length < 60 && !PREP_ANCHOR.test(next) && !/^\d+\.\s/.test(next) && !declarative);
        if (!ok) break;
        const item = cleanItem(next);
        const g = item.match(GENDER);
        if (g) {
          for (const part of splitList(item.slice(g[0].length))) tagged.push({ tag: g[1].startsWith('남') ? '남아' : '여아', part });
        } else if (!declarative) {
          // "수저통, 개인수건 챙겨 보내주세요" 는 낱개로, 긴 요청 문장은 요청 하나로
          const due = /까지/.test(next) ? addDeadline(next) : null;
          splitList(sentences(item)[0] || item).forEach((x) => push(prep, x, { list: true, due }));
        }
        j++;
        collected++;
      }
      // 남아·여아 모두 같은 것은 하나로, 한쪽만이면 (남아)/(여아)
      for (const { tag, part } of tagged) {
        const both = tagged.some((x) => x.tag !== tag && x.part === part);
        push(prep, both ? part : `${part} (${tag})`, { list: true });
      }
      if (collected) {
        if (prepLine < 0) prepLine = i;
        i = j - 1;
      }
    }

    // 한 줄에서는 요청 문장 하나만 (뒤 문장은 대개 앞 요청의 덧붙임). 한 문장 안의 "~주시고 ~주세요" 는 모두
    let asked = !!collected;
    for (const s of sentences(line)) {
      const before = asked;
      for (const c of clauses(s)) {
        // "준비물을 확인하시고 꼭 챙겨주세요" 같은 안내 문장, 묻는 문장은 항목이 아니다
        if (before || !REQUEST.test(c) || /준비물을?\s*(확인|참고)/.test(c) || /\?\s*$/.test(s) || NOTE.test(c) || IF_SICK.test(c)) continue;
        const due = /까지/.test(c) ? addDeadline(c) : null;
        if (heading && sub) {
          // 소제목 아래 "- …까지 가져옵니다" → 항목 이름은 소제목
          if (!headingDone) headingDone = push(prep, heading, { due });
          asked = true;
          continue;
        }
        if (objectless(cleanItem(c))) continue;
        if (prepLine < 0) prepLine = i;
        // 긴 문장은 요청 말이 있는 마디까지만
        const r = c.match(REQUEST);
        const short = c.length > 60 ? c.slice(0, r.index) + c.slice(r.index).split(/(?<!\d)[,.](?!\d)/)[0] : c;
        splitList(cleanItem(short)).forEach((x) => push(prep, x, { due }));
        asked = true;
      }
      if (EVENT.test(s) && !PREP_ANCHOR.test(s)) push(events, s.replace(/^안녕하세요[^\s]*\s*/, ''));
      const t = s.match(TIME);
      if (t) times.push(cleanItem(s));
    }
  }

  // "[졸업사진 대금 납부 안내]" + "납부기간 : …" 처럼 납부·신청을 제목으로만 알린 글
  if (!prep.length && deadlines.length) {
    const head = [post.title, ...lines.slice(0, 3)].map((l) => (l || '').match(/\[([^\]]{2,30})\]/)).find(Boolean);
    if (head && /(납부|신청|회신|제출)/.test(head[1])) push(prep, head[1].replace(/^\d{4}학년도\s*/, '').replace(/\s*안내$/, ''));
  }

  // 행사일: 준비물 줄 바로 위의 "일시 : 11월 5일" 같은 줄(여러 행사를 한 장에 안내하는 가정통신문),
  // 다음은 앵커/일정 문장이 있는 줄, 없으면 본문 전체
  let eventDate = null;
  for (let j = prepLine; !eventDate && j >= 0 && j >= prepLine - 4; j--) {
    if (j < prepLine && /^\d+[.,]\s/.test(lines[j])) break; // 앞 단락으로 넘어가지 않는다
    eventDate = resolveDate(lines[j], post.date);
  }
  const focus = lines.filter((l) => PREP_ANCHOR.test(l) || EVENT.test(l)).join(' ');
  eventDate ||= resolveDate(focus, post.date) || resolveDate((post.title || '') + ' ' + (post.content || ''), post.date);
  // 글 쓴 날짜는 대개 "오늘 보내드립니다" 같은 말이라 행사일로 보지 않는다
  if (eventDate === post.date) eventDate = null;
  const firstDeadline = deadlines.length ? [...deadlines].sort()[0] : null;

  // 항목별 날짜: 적힌 마감일 > (준비물 목록·복장이면) 행사일 > 이 글의 마감일 > 행사일
  const dates = meta.map((m) => m.due || (m.list ? eventDate || firstDeadline : firstDeadline || eventDate));
  const date = dates.filter(Boolean).sort()[0] || (prep.length ? null : firstDeadline || eventDate);

  return { prep, dates, events: events.slice(0, 3), times: times.slice(0, 2), date };
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
    const base = {
      source: p.source,
      who: p.who || [],
      postDate: p.date,
      title: p.title || bracketTitle(p.content) || shorten(r.events[0]) || firstLine(p.content) || firstLine(p.imgText) || '그림으로 온 안내',
      content: p.content,
      imgText: p.imgText || '',
    };
    // 한 글에 날짜가 다른 할 일이 있으면(소풍 준비물은 11/5, 동의서는 11/3까지) 날짜별 카드로 나눈다.
    // 첫 항목의 카드가 원래 카드(일정·그림 포함), 나머지는 "글키@날짜"
    const groups = new Map();
    r.prep.forEach((item, i) => {
      const d = r.dates[i] || r.date || '';
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(item);
    });
    if (!groups.size) groups.set(r.date || '', []);
    [...groups].forEach(([d, prep], n) => cards.push({
      ...base,
      key: n ? `${p.source}:${p.id}@${d}` : `${p.source}:${p.id}`,
      date: d || p.date,
      dateGuessed: !d,
      prep,
      events: n ? [] : r.events,
      times: n ? [] : r.times,
      images: n ? [] : images,
    }));
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
