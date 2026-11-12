// 성장 기록: 알림장에서 공지성 문장을 빼고, 선생님이 들려준 우리 아이 이야기만 남기는 규칙.
// 글은 고쳐 쓰거나 지어내지 않는다. 선생님 문장을 그대로 두고, 빼기만 한다.

// 준비물·안내·부탁·인사처럼 기록으로 남길 필요가 없는 문장
const NOTICE = new RegExp([
  '준비물', '챙겨\\s*주', '보내\\s*주', '지참', '가져\\s*(?:오|와|가)', '회신', '납부', '신청', '동의서', '제출', '서명',
  '공지', '안내\\s*(?:드|해|합)', '알려\\s*드', '참고\\s*(?:해|하|부탁|바)', '부탁\\s*드', '확인\\s*(?:해|부탁|바)', '바랍니다',
  '투약', '약\\s*(?:을|은|도)?\\s*(?:보내|넣어|챙)', '여벌', '기저귀', '물티슈', '이불', '낮잠\\s*이불',
  '휴원', '등원\\s*(?:시간|시|때)', '하원\\s*(?:시간|시)', '체온', '발열', '코로나', '독감', '수족구', '전염',
  '가정에서', '가정\\s*내', '학부모', '부모님들', '어머님들', '문의', '연락\\s*(?:주|드|부탁)',
  '감사(?:합|드립)니다', '고맙습니다', '죄송', '양해',
  // 돈 이야기: 비용·경비·회비·입금, "36,000원" 같은 금액
  '비용', '경비', '회비', '[가-힣]{1,6}비\\s*[:：]', '입학금', '입금', '납입', '환불', '계좌', '면제', '금액', '수납', '\\d[\\d,]*\\s*원', '원\\s*(?:입니다|이에요)',
  // 부모가 보낸 말투 (기관에 남긴 글이 섞여 들어올 때)
  '보내겠습니다', '보낼게요', '데리러', '일찍\\s*하원', '유선상', '말씀\\s*(?:주신|드린)', '되는\\s*거지요',
  // 결석·가정 보육
  '결석', '등원\\s*(?:을\\s*)?(?:못|안|어렵|힘들)', '못\\s*(?:가요|갑니다|갈\\s*것|보내|온다|와요|오)', '쉬(?:겠습니다|게\\s*(?:요|되)|려고|기로)', '가정\\s*보육', '아파서\\s*(?:등원|못|쉬)',
  // 부모에게 하는 부탁·답장 ("입혀 주세요", "네 알겠습니다", "그러셨군요")
  '주세요', '주시기', '주십시오', '주시면', '알겠습니다', '그러셨군요', '그랬군요', '그렇군요', '확인했습니다', '전달\\s*(?:드|해|받)', '^네[\\s,~!.]',
  // 행사·견학 안내 (장소·출발·복장·시간)
  '예금주', '은행', '반명', '원복', '복장', '착용', '도보\\s*등원', '출발', '집합', '도착\\s*예정', '예정(?:입니다|이에요|이니)', '진행(?:합니다|됩니다|될|할\\s*예정)', '제한(?:됩니다|돼요)', '\\d{1,2}\\s*시\\s*\\d{0,2}\\s*분?\\s*(?:까지|정각)',
  // 교재·숙제 같은 행정 이야기
  '교재', '\\d+\\s*권', '복사', '숙제',
  // 쪽지처럼 주고받는 말투 ("~같네요^^;")
  '\\^\\^;',
  // 생일 답례품·물건 보내기 ("○○ 답례품 보내드립니다", "엘린반 김○○- 음료수")
  '답례품', '보내\\s*드(?:립|려|릴)', '^(?:[가-힣]+\\s)?[가-힣]{2,4}\\s*-\\s*[가-힣]{2,8}[.!]?$',
  // 다음 일정 예고 ("내일 설날행사를 합니다", "20일(월)에 보강")
  '^(?:내일|모레|다음\\s*주)(?:은|는|에|에는)?\\s.*(?:합니다|갑니다|있습니다|입니다|예정)', '\\d{1,2}\\s*일\\s*\\([월화수목금토일]\\)', '결강', '보강\\s*(?:해\\s*드|이\\s*이루어|수업|합니다|됩니다|예정)',
  // 선생님 개인 사정
  '교통사고', '선생님(?:께서|이|은)?\\s*(?:\\S+\\s*)?(?:사고|입원|병가|수술|출산|퇴사|휴직)',
  // 건강 정보 글 (자외선·질환 같은 반 전체 안내). "예방"은 수업 이야기에도 나와서 넣지 않는다
  '자외선', '질환', '증상', '유발', '노출되', '손상을',
].join('|'));
// 안내문 모양: 머리글 [ ], 항목 표시(- * ※ ▶ •), "항목 : 내용", 번호 1)
const NOTICE_SHAPE = /^\s*(?:\[[^\]]{2,30}\]|[-*※▶•◆■□○●]|\d+[).]\s|[가-힣()]{1,10}\s*[:：])|\*\*|<[^>]{2,20}>/;
// 안내문 말투: "~입니다/합니다/됩니다/습니다"
const FORMAL = /(?:입니다|합니다|됩니다|습니다|바랍니다)[.!~]*$/;
// 글 첫머리가 이러면 글 전체를 뺀다: 제목처럼 붙은 [○○ 안내], 부모 글에 단 답장("에고 그랬군요", "넵")
const NOTICE_HEAD = /^\s*\[[^\]]{2,60}(?:안내|알림|공지|소식|일정|모집|신청)[^\]]{0,10}\]/;
const REPLY_HEAD = /^\s*(?:에고|어머나?|아이고|넵|네넵|네네|아하|앗)[\s,~!.ㅜㅠ^]/;
// 선생님이 오늘 있었던 일을 들려주는 말투
const STORY = /(?:었|았|였|했|웠|렀|켰|줬)(?:어요|답니다|네요|습니다)/;
// 인사·맺음말 (짧은 문장만)
const GREETING = /^(?:안녕하세요|좋은\s*(?:아침|오후|저녁)|[가-힣]{0,4}\s*(?:어머님|아버님|부모님)[\s,~!.^]*$)|(?:행복|즐거운|편안한|따뜻한|좋은|건강한)\s*(?:한\s*)?(?:저녁|주말|하루|밤|시간|연휴)\s*(?:보내|되)/;
// 문장이 끝났는지 (마침표·느낌표나 "~요/~다" 같은 맺음)
const ENDED = /(?:[.!?~♡♥^ㅎㅋㅠㅜ)"'”’]|[요다죠네까음함임])$/;
// 기록할 만한 순간
const FIRST = /처음|첫\s?(?:걸음|등원|발|마디|말)|드디어|혼자서|혼자\s*(?:힘으로|서|걸|먹|신|입)|스스로/;

/** 문장 나누기: 줄바꿈, 이모지(문장 끝에 많이 붙는다), 문장 끝(. ! ? ~ ♡ ㅎㅎ ㅠㅠ 요 다음 공백) */
export function sentences(text = '') {
  return String(text)
    // 선생님이 자주 쓰는 ♡·♥ 는 글의 따뜻함이라 남기고, 그림 이모지만 문장 끝으로 본다
    .replace(/(?:(?![♡♥])\p{Extended_Pictographic}|\u{FE0F}|\u{200D})+/gu, '\n')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?~♡♥^ㅎㅋㅠㅜ]|요)\s+(?=\S)/))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.replace(/[^가-힣a-zA-Z0-9]/g, '').length >= 2);
}

export const norm = (s) => s.replace(/[^가-힣a-zA-Z0-9]/g, '');

/**
 * 알림장 목록 → 이야기 목록.
 * reports: [{id, date, content, images}] (최신순이든 아니든), opts.name: 아이 이름(성 뺀)
 * 여러 날에 똑같이 되풀이되는 문장(반 전체 인사 등)도 뺀다.
 */
export function buildStory(reports, { name = '' } = {}) {
  const all = reports.map((r) => ({ ...r, parts: sentences(r.content), lines: String(r.content || '').split('\n').filter((l) => l.trim()) }));
  // 같은 문장이 여러 날 나오면 틀에 박힌 문장으로 본다
  const seen = new Map();
  for (const r of all) for (const s of new Set(r.parts.map(norm))) seen.set(s, (seen.get(s) || 0) + 1);
  const repeated = (s) => {
    const n = seen.get(norm(s)) || 0;
    return n >= 3 && n >= all.length * 0.1;
  };
  const days = [];
  for (const r of all.sort((a, b) => a.date.localeCompare(b.date))) {
    const keep = r.parts.map((s) => !NOTICE.test(s) && !NOTICE_SHAPE.test(s) && !(s.length < 40 && GREETING.test(s)) && !repeated(s));
    // 줄바꿈으로 한 문장이 나뉜 경우("…활동했던⏎작품을 보내드립니다"): 뒷부분이 빠지면 끝맺지 않은 앞부분도 뺀다
    for (let i = keep.length - 2; i >= 0; i--) if (keep[i] && !keep[i + 1] && !ENDED.test(r.parts[i])) keep[i] = false;
    let kept = r.parts.filter((_, i) => keep[i]);
    // 글 전체가 안내문이면(반 전체 공지가 알림장으로 온 경우) 남은 문장도 모두 뺀다:
    // 안내문 모양 줄이 둘 이상, 문장 절반 이상이 이미 빠짐, 또는 아이 이름 없이 딱딱한 말투가 대부분
    const shapeLines = r.lines.filter((l) => NOTICE_SHAPE.test(l)).length;
    const formal = r.parts.filter((s) => FORMAL.test(s)).length;
    // 이름은 없어도 "~먹었어요"처럼 지난 일을 들려주는 문장이 남았으면 이야기 글로 본다
    const mentions = (name && r.parts.some((s) => s.includes(name))) || kept.some((s) => STORY.test(s));
    // 딱딱한 말투만으로는 빼지 않는다 (반 활동을 "~했습니다"로 쓰는 선생님도 있어서). 안내 문장이 하나라도 섞였을 때만
    // 답장은 "안녕하세요" 다음에 시작하기도 해서, 인사를 건너뛴 첫 문장으로 본다
    const head = r.parts.find((s) => !GREETING.test(s)) || '';
    if (NOTICE_HEAD.test(r.content || '') || REPLY_HEAD.test(head)) kept = [];
    else if (r.parts.length && (shapeLines >= 2 || (r.parts.length >= 2 && kept.length <= r.parts.length / 2 && !mentions)
      || (!mentions && kept.length < r.parts.length && formal >= r.parts.length * 0.6))) kept = [];
    const text = joinParts(kept);
    const photos = r.images || [];
    if (norm(text).length < 6 && !photos.length) continue;
    const first = kept.find((s) => FIRST.test(s)) || null;
    days.push({
      id: r.id, date: r.date, text, parts: kept, photos, first,
      aboutKid: name ? kept.some((s) => s.includes(name)) : true,
      dropped: r.parts.length - kept.length,
    });
  }
  return days;
}

/**
 * 한 달을 대표할 문장 고르기 (달 첫머리에 크게 싣는다). 고쳐 쓰지 않고 고르기만 한다.
 * 아이가 한 말(따옴표), "처음", 아이 이름이 든 문장, 너무 길지 않은 문장을 먼저.
 */
export function lineScore(s, name = '') {
  let n = 0;
  if (SAID.test(s)) n += 3;
  if (FIRST.test(s)) n += 3;
  if (name && s.includes(name)) n += 2;
  if (/웃|안아|사랑|좋아|박수|뿌듯|자랑|대견|씩씩|용기|고마/.test(s)) n += 1;
  if (s.length >= 18 && s.length <= 90) n += 2;
  else if (s.length > 140) n -= 2;
  return n;
}
export function bestLine(parts, name = '') {
  let best = null, score = 2; // 점수가 낮으면 고르지 않는다
  for (const s of parts) {
    const n = lineScore(s, name);
    if (n > score) { best = s; score = n; }
  }
  return best;
}
// 아이가 한 말: 따옴표 안의 짧은 말 ("몰라", "부드러워요")
export const SAID = /["“'‘][^"”'’]{1,30}["”'’]/;
/** 글을 [일반, 아이가 한 말, 일반, …] 조각으로 (화면에서 아이 말만 색을 달리한다) */
export function splitSaid(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/["“'‘][^"”'’]{1,30}["”'’]/g)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) });
    out.push({ t: m[0], said: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

/** 문장을 이어 붙인다. 이모지로 끝나던 문장은 마침표가 없어져서 채운다 */
export const joinParts = (parts) => parts.map((s) => (/[.!?~♡♥^ㅎㅋ)"']$/.test(s) ? s : `${s}.`)).join(' ');

/**
 * 부모(우리)가 기관에 보낸 알림장인지. 키즈노트는 양쪽 글이 같은 목록에 온다.
 * 작성자 칸 이름이 확인되지 않아, 흔한 칸 이름을 모두 살핀다: 작성자 id 가 내 id 이거나, 작성자 종류가 부모.
 */
const FAMILY = /(엄마|아빠|어머니|아버지|어머님|아버님|할머니|할아버지|할머님|할아버님|이모|고모|삼촌|외삼촌|맘|대디|파파|보호자|mom|dad|mother|father)$/i;
export function byParent(r, meId) {
  const who = [r.author, r.writer, r.user, r.created_by, r.owner].find((x) => x && typeof x === 'object') || {};
  const ids = [who.id, r.author_id, r.writer_id, r.user_id, typeof r.created_by === 'number' ? r.created_by : null].filter((x) => x != null);
  if (meId != null && ids.some((x) => String(x) === String(meId))) return true;
  const kind = [who.type, who.role, who.user_type, r.author_type, r.writer_type, r.role, r.type].filter((x) => typeof x === 'string').join(' ');
  if (/parent|guardian|family|부모|학부모|보호자/i.test(kind)) return true;
  // 가족 계정은 보통 "선우 엄마", "선우아빠", "선우 할머니" 같은 이름이다 (로그인한 사람이 아닌 다른 가족이 쓴 글)
  const names = [who.name, who.nickname, who.username, who.display_name, r.author_name, r.writer_name, r.user_name, r.author_nickname,
    typeof r.author === 'string' ? r.author : null, typeof r.writer === 'string' ? r.writer : null].filter((x) => typeof x === 'string');
  if (names.some((n) => FAMILY.test(n.trim()))) return true;
  return r.is_parent === true || r.from_parent === true || r.is_sent_by_parent === true;
}

/** 'YYYY-MM-DD' 생일과 날짜로 "만 1세 3개월" */
export function ageLabel(birth, date) {
  if (!birth) return '';
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  let months = (y - by) * 12 + (m - bm) - (d < bd ? 1 : 0);
  if (months < 0) return '';
  const yrs = Math.floor(months / 12);
  months %= 12;
  return yrs ? `만 ${yrs}세${months ? ` ${months}개월` : ''}` : `${months}개월`;
}

export const MONTH_TITLE = {
  1: '한겨울의 따뜻한 날들', 2: '봄을 기다리며', 3: '처음 만난 봄', 4: '꽃이 피는 날들',
  5: '초록이 짙어지는 계절', 6: '여름의 문턱에서', 7: '물놀이의 계절', 8: '한여름의 기억',
  9: '가을이 오는 길', 10: '알록달록 가을', 11: '늦가을의 오후', 12: '겨울의 시작',
};
