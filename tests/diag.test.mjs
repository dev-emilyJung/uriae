import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, scrub } from '../extension/lib/diag.js';
import { isReadable, isReferenceDoc } from '../extension/lib/extract.js';

const base = {
  env: { extension: '1.0.2' }, settings: { kids: 1 }, diag: { runs: [{ ms: 1000 }] }, faceLog: [],
  ocr: { a: { at: '2026-11-01', doc: 1, text: '가을 소풍 안내\n준비물: 도시락' }, b: { at: '2026-11-01' } },
  isReadable, isReferenceDoc,
};
const prep = {
  posts: [{ id: 7, source: 'notice', date: '2026-11-01', title: '소풍', content: '선우 어머님, 도시락 챙겨 주세요', imgText: '' }],
  cards: [{ key: 'notice:7', source: 'notice', date: '2026-11-05', prep: ['도시락'], events: [], times: [], images: [], imgText: '' }],
};

test('진단 파일: 기본은 숫자만, 글 내용은 넣기를 골랐을 때만', () => {
  const r = buildReport({ ...base, prep, withText: false });
  const json = JSON.stringify(r);
  assert.ok(!json.includes('선우') && !json.includes('도시락'));
  assert.equal(r.ocr.images, 2);
  assert.equal(r.ocr.docs, 1);
  assert.deepEqual(r.prep.cards[0].prep, 1);
  const t = buildReport({ ...base, prep, withText: true });
  assert.deepEqual(t.prepText[0].found[0].prep, ['도시락']);
});

test('오류 문장에서 주소와 긴 id는 지운다', () => {
  assert.equal(scrub('failed https://kapi.kidsnote.com/v1/children/1234567/reports'), 'failed …');
  assert.equal(scrub('image 98765432 not found'), 'image # not found');
});
