import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanOcrText, extractFromPost, fixOcrLine, isReferenceDoc, isReadable } from '../extension/lib/extract.js';

// tesseract(kor, psm 4)가 실제로 읽어낸 결과: 반듯한 가정통신문, 휴대폰으로 찍은 듯 기울고 흐린 것, 두 단 꾸민 안내문
const RAW = JSON.parse(readFileSync(new URL('./ocr-raw.json', import.meta.url), 'utf8'));
const read = (raw) => extractFromPost({ id: 1, source: 'notice', date: '2026-10-28', content: cleanOcrText(raw) });

test('표로 된 가정통신문: 준비물·복장·날짜', () => {
  for (const raw of [RAW.notice, RAW.photo]) {
    const r = read(raw);
    assert.deepEqual(r.prep.slice(0, 5), ['도시락', '물통', '여벌옷', '모자', '편한 운동화와 활동복']);
    assert.equal(r.date, '2026-11-05');
  }
});

test('두 단 안내문: 오른쪽 상자의 준비물 목록', () => {
  const r = read(RAW.deco);
  assert.ok(r.prep.includes('할로윈 의상 또는 머리띠'));
  assert.ok(r.prep.includes('사탕 담을 바구니'));
  assert.equal(r.date, '2026-10-31');
});

test('글자 정리: 표 이름은 붙이고 문장 끝은 이름으로 보지 않고 기호 줄은 버린다', () => {
  assert.equal(cleanOcrText('준비물        도시락, 물통'), '준비물: 도시락, 물통');
  assert.equal(cleanOcrText('입고 와 주세요     준비물'), '입고 와 주세요\n준비물');
  assert.equal(cleanOcrText('」\n…~ㅡ~\n안내'), '안내');
});

test('그림 글자 바로잡기: 날짜·요일·자주 쓰는 낱말', () => {
  assert.equal(fixOcrLine('- 17월 5열 (목) : 공원 견학'), '- 11월 5일 (목) : 공원 견학');
  assert.equal(fixOcrLine('* 일정 ; 10될 29밀(복}'), '* 일정 ; 10월 29일(목)');
  assert.equal(fixOcrLine('* 복장 및 준비몰 : 원북, 운동화, 불통'), '* 복장 및 준비물 : 원복, 운동화, 물통');
  assert.equal(fixOcrLine('점실은 유치원에서 / 1. 11월 챔사일정 만내'), '점심은 유치원에서 / 1. 11월 행사일정 안내');
});

test('그림 글자 바로잡기: 멀쩡한 낱말은 건드리지 않는다', () => {
  const s = '우리 아이들이 모아 주세요. 상당히 복잡한 학원에서 인정을 받았어요 원본은 모두';
  assert.equal(fixOcrLine(s), s);
});

test('여러 행사를 안내하는 가정통신문: 준비물 바로 위 일정의 날짜, 챙기지 않아도 되는 것은 빼기', () => {
  const text = [
    '1. 학부모 상담 안내',
    '* 상담기간: 2026년 11월 16일 (월) ~ 11월 20일 (금)',
    '2. 현장학습 (견학) 안내',
    '* 일정 ; 10월 28일(수)',
    '* 장소 및 시간 : 과학관',
    '* 복장 및 준비물 ; 유치원 원복, 운동화, 물통 (도보 유아는 9시 20분까지 등원시켜 주세요.)',
    '* 점심은 유치원에서 제공되므로 도시락은 준비하지 않습니다.',
  ].join('\n');
  const r = extractFromPost({ id: 1, source: 'notice', date: '2026-10-23', content: text });
  assert.equal(r.date, '2026-10-28');
  assert.deepEqual(r.prep, ['유치원 원복', '운동화', '물통']);
});

test('식단표·교육계획안은 참고 자료, 대부분 깨진 글자는 읽을 수 없는 것으로', () => {
  assert.ok(isReferenceDoc('햇살유치원 2026년 11월 식단\n날짜: 2(월) 3(화)'));
  assert.ok(isReferenceDoc('주간교육계획안\n반 이름: 사랑반 시기 2026년 10월 19일'));
  assert.ok(!isReferenceDoc('2026 - 제33호\n가정통신문\n1. 11월 행사일정 안내'));
  assert.ok(!isReadable('룰랄으아 8639\n04148 .느43004\n76301: 5400'));
  assert.ok(isReadable('가을 현장학습 안내\n준비물: 도시락, 물통'));
});
