// 실제 알림장 정답으로 준비물·날짜 추출 채점 (정답 파일이 있을 때만).
// 정답 파일: extension/dev/prep-eval.html 에서 만들어 tests/private/prep-cases.json 에 둔다 (저장소에 안 올라감).
// 기준 점수: tests/private/prep-baseline.json. UPDATE_BASELINE=1 로 실행하면 지금 점수를 기준으로 저장한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { score } from './prep-score.mjs';

const CASES = new URL('./private/prep-cases.json', import.meta.url);
const BASELINE = new URL('./private/prep-baseline.json', import.meta.url);
test('실제 알림장 정답 채점', { skip: !existsSync(CASES) && '정답 파일 없음 (tests/private/prep-cases.json)' }, () => {
  const { cases } = JSON.parse(readFileSync(CASES, 'utf8'));
  const s = score(cases);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(`\n[알림장 채점] 글 ${s.cases}개 · 맞게 뽑은 비율 ${pct(s.precision)} · 빠짐없이 뽑은 비율 ${pct(s.recall)} · 날짜 ${pct(s.date)}`);
  for (const f of s.fails.slice(0, 40)) {
    console.log(`  ${f.key}${f.wrong.length ? ` | 잘못 뽑음: ${f.wrong.join(' / ')}` : ''}${f.missed.length ? ` | 놓침: ${f.missed.join(' / ')}` : ''}${f.date ? ` | 날짜 ${f.date}` : ''}`);
  }
  if (process.env.UPDATE_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify({ precision: s.precision, recall: s.recall, date: s.date, cases: s.cases }, null, 1));
    return;
  }
  if (existsSync(BASELINE)) {
    const b = JSON.parse(readFileSync(BASELINE, 'utf8'));
    // 규칙을 고치다가 예전에 맞던 것이 틀리지 않게: 기준 점수보다 떨어지면 실패
    assert.ok(s.precision >= b.precision - 1e-9, `맞게 뽑은 비율이 떨어졌어요 ${pct(b.precision)} → ${pct(s.precision)}`);
    assert.ok(s.recall >= b.recall - 1e-9, `빠짐없이 뽑은 비율이 떨어졌어요 ${pct(b.recall)} → ${pct(s.recall)}`);
    assert.ok(s.date >= b.date - 1e-9, `날짜 정확도가 떨어졌어요 ${pct(b.date)} → ${pct(s.date)}`);
  }
});
