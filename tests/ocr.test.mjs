import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanOcrText, extractFromPost } from '../extension/lib/extract.js';

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
