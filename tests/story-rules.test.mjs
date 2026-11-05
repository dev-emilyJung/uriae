// 성장 기록 규칙: 선생님 이야기는 남기고, 안내·비용·결석·답장·부모 글은 뺀다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStory, byParent, ageLabel, sentences, bestLine, splitSaid } from '../extension/story/story-rules.js';

test('달을 대표할 문장: 아이가 한 말·처음이 든 문장을 고르고, 밋밋하면 고르지 않는다', () => {
  const said = '구름을 만져보면 어떤 느낌일지 물어보자 처음에는 "몰라"하다가 "부드러워요" 하며 웃었어요.';
  assert.equal(bestLine(['낮잠을 잤어요.', said, '선우가 밥을 먹었어요.'], '선우'), said);
  assert.equal(bestLine(['밥을 먹었어요.'], '선우'), null);
  assert.deepEqual(splitSaid('처음엔 "몰라" 했어요').map((x) => !!x.said), [false, true, false]);
});

const story = (contents) => buildStory(contents.map((content, i) => ({ id: i, date: `2026-10-${String(i + 1).padStart(2, '0')}`, content })), { name: '선우' });

test('선생님 이야기는 원문 그대로 남는다', () => {
  const [d] = story(['오늘 선우는 김밥 만들기를 했어요. 김 위에 밥을 꾹꾹 눌러 펴고 "선생님 이거 봐요!" 하고 자랑했답니다.']);
  assert.equal(d.text, '오늘 선우는 김밥 만들기를 했어요. 김 위에 밥을 꾹꾹 눌러 펴고 "선생님 이거 봐요!" 하고 자랑했답니다.');
});

test('"처음"이 든 문장은 처음의 순간이 된다', () => {
  const [d] = story(['오늘 선우는 처음으로 혼자 숟가락을 들고 밥을 먹었어요😊 반은 흘렸지만 정말 대견했답니다!']);
  assert.equal(d.first, '오늘 선우는 처음으로 혼자 숟가락을 들고 밥을 먹었어요');
  assert.match(d.text, /먹었어요\. 반은/); // 이모지 자리에 마침표
});

test('안내·비용·결석·답장 글은 통째로 빠진다', () => {
  const days = story([
    '특성화비 : [월] 36,000. 특별활동비 : [월] 90,000-면제. 연간행사비 : [월] 7,000원. 입학금 : 40,000원. 총 = 83,000원.',
    '유선상 말씀주신대로 월기타경비 올라온건 입금 안보내도되는거지요? 오늘 선우 10시~11시 30분 정도만 보내겠습니다.',
    '선우가 아파서 등원 못해요. 오늘은 쉬겠습니다.',
    '에고 그러셨군요... 네 알겠습니다!!',
    '선우가 방금 등원해서 목, 금요일 할머니 댁 가서 유치원 못 온다고 이야기해주더라구요~!',
    '[발표회 관련 안내]\n내일은 발표회 날입니다~ 청소년 극장으로 바로 등원합니다.\n등원 복장 안내\n남아) 흰색 긴팔티셔츠, 청바지\n** 공통사항',
    '내일 목요일(22일)은 <월드컵공원> 샘물반의 견학날입니다.\n* 원복\n9시 40분 정각에 출발할 예정이므로 도보등원 유아는 9시 30분까지',
    '- 은행 : 국민은행\n- 예금주 : 홍길동\n반드시 반명과 아이의 이름',
    '안녕하세요 어머님~\n내일은 여벌옷 챙겨주세요. 즐거운 저녁 보내세요~',
  ]);
  assert.deepEqual(days.map((d) => d.text), []);
});

test('안내 문장만 빼고 이야기 문장은 남긴다', () => {
  const [d] = story(['안녕하세요 선우 어머님~\n오늘 선우가 블록을 높이 쌓고 박수를 쳤어요♡\n내일은 여벌옷 챙겨주세요.']);
  assert.equal(d.text, '오늘 선우가 블록을 높이 쌓고 박수를 쳤어요♡');
});

test('"~했습니다" 말투의 반 활동 기록은 남긴다', () => {
  const [d] = story(['오늘은 친구들과 가을 낙엽을 밟으며 산책을 했습니다. 바스락 소리에 모두 즐거워했습니다.']);
  assert.ok(d && d.text.includes('낙엽'));
});

test('여러 날 되풀이되는 틀에 박힌 문장은 뺀다', () => {
  const days = story(['오늘 하루도 즐겁게 보냈어요. 블록 놀이를 했어요.', '오늘 하루도 즐겁게 보냈어요. 낮잠도 푹 잤어요.', '오늘 하루도 즐겁게 보냈어요. 산책을 했어요.']);
  assert.ok(days.every((d) => !d.text.includes('즐겁게 보냈어요')));
});

test('제목처럼 [○○ 안내]로 시작하는 글, 부모 글에 단 답장, 쪽지 말투는 뺀다', () => {
  const days = story([
    "['가을 운동회' 좌석 배치 안내]. 안녕하십니까? 좌석표는 금일 가정으로 배부됩니다. 아이들의 멋진 모습을 기대합니다.",
    '에고 그랬군요. 다행히 선우가 아프지는 않아서 유치원에서도 연고 발라 줄게요 :)',
    '안녕하세요 어머님~ 에고ㅜㅜ.. 선우가 아직 컨디션이 안 좋나 봐요. 푹 쉬고 건강하게 만나요!',
    '이건데 선우 이름으로 넣어서 그럴 수도 있을 것 같네요^^;',
    '오늘 선우가 처음으로 혼자 신발을 신었어요. 스스로 해냈다며 활짝 웃었답니다.',
  ]);
  assert.equal(days.length, 1);
  assert.match(days[0].text, /혼자 신발/);
});

test('부모가 보낸 알림장 알아보기', () => {
  assert.equal(byParent({ author: { id: 7 } }, 7), true);
  assert.equal(byParent({ author: { id: 3, type: 'parent' } }, 7), true);
  assert.equal(byParent({ author: { id: 3, type: 'teacher' } }, 7), false);
  assert.equal(byParent({}, null), false);
  // 로그인한 사람이 아닌 다른 가족 계정: 이름으로
  for (const name of ['박선우 엄마', '선우아빠', '선우 할머니', '선우 외할아버지', '선우맘']) {
    assert.equal(byParent({ author: { id: 3, name } }, 7), true, name);
  }
  assert.equal(byParent({ author_name: '선우 어머님' }, 7), true);
  for (const name of ['김은지 선생님', '햇살반', '원장', '햇살반 담임']) {
    assert.equal(byParent({ author: { id: 3, name } }, 7), false, name);
  }
});

test('만 나이', () => {
  assert.equal(ageLabel('2024-01-15', '2026-03-01'), '만 2세 1개월');
  assert.equal(ageLabel('2025-09-01', '2026-03-01'), '6개월');
  assert.equal(ageLabel(null, '2026-03-01'), '');
});

test('문장 나누기: 이모지·줄바꿈·물결', () => {
  assert.deepEqual(sentences('안녕하세요~ 오늘 웃었어요😊 내일 봐요'), ['안녕하세요~', '오늘 웃었어요', '내일 봐요']);
});
