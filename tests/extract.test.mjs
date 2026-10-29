import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromPost, resolveDate } from '../extension/lib/extract.js';

test('견학 준비물 불릿 목록과 날짜', () => {
  const r = extractFromPost({ id: 1, source: 'report', date: '2026-10-21', content:
    '내일 목요일(22일)은 <공원> 견학날입니다. 준비물을 확인하시고 꼭! 챙겨주시기 바랍니다.\n* 원복 * 물통 * 운동화\n도보등원 유아는 9시 30분까지 등원해 주세요.' });
  assert.deepEqual(r.prep, ['원복', '물통', '운동화']);
  assert.equal(r.date, '2026-10-22');
  assert.equal(r.events.length, 1);
  assert.equal(r.times.length, 1);
});

test('한 줄 준비물 나열과 복장 안내', () => {
  const r = extractFromPost({ id: 2, source: 'notice', date: '2026-11-10', content:
    '등원 복장 안내\n남아) 흰색 긴팔티셔츠, 청바지\n준비물: 물병, 손수건, 여벌옷\n11월 14일 금요일 발표회가 있습니다.' });
  assert.ok(r.prep.includes('물병') && r.prep.includes('여벌옷'));
  assert.ok(r.prep.some((p) => p.includes('청바지')));
  assert.equal(r.date, '2026-11-14');
});

test('날짜 표현 해석', () => {
  assert.equal(resolveDate('내일', '2026-10-29'), '2026-10-30');
  assert.equal(resolveDate('금요일', '2026-10-29'), '2026-10-30');
  assert.equal(resolveDate('다음 주 화요일', '2026-10-29'), '2026-11-03');
  assert.equal(resolveDate('12/3', '2026-11-28'), '2026-12-03');
  assert.equal(resolveDate('1월 5일', '2026-12-20'), '2027-01-05');
  assert.equal(resolveDate('(3일)', '2026-10-29'), '2026-11-03');
});

test('준비물이 없는 글은 빈 결과', () => {
  const r = extractFromPost({ id: 3, source: 'report', date: '2026-10-29', content: '오늘 친구들과 즐겁게 놀았어요.' });
  assert.equal(r.prep.length, 0);
});
