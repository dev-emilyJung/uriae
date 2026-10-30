// 실제 사진 Y/N 답으로 "우리 아이" 판정 기준 채점 (tests/private/face-log.json 이 있을 때만, 저장소에 안 올라감).
// face-log.json: 개발용 설치의 dev/eval.html "판정 숫자 내보내기". 사진·얼굴 정보 없이 사진별 판정 숫자와 Y/N 답만 있다.
// 답한 사진마다 1.0.1 판정(legacy)·보정 점수(z)·이웃 비교 비율(near)이 있어서, 지금 기준을 그대로 다시 적용해 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decide, NEAR } from '../extension/lib/match.js';

const FILE = new URL('./private/face-log.json', import.meta.url);

test('실제 사진 Y/N: 우리 아이로 찾은 사진은 거의 다 맞고, 우리 아이의 대부분을 바로 찾는다', { skip: !existsSync(FILE) && '판정 숫자 없음 (tests/private/face-log.json)' }, () => {
  const { log } = JSON.parse(readFileSync(FILE, 'utf8'));
  const samples = log.flatMap((r) => (r.samples || []).map((s) => ({ ...s, th: decide(r.strictness ?? 0.5) })));
  const usable = samples.filter((s) => s.near != null && s.legacy != null);
  // 지금 기준: 1.0.1 기준을 넘고, 보정 점수 여유가 있고, 이웃 비교 비율이 기준 이상
  const sure = usable.filter((s) => s.legacy === 3 && s.z >= s.th.sure + NEAR.zMargin && s.near >= NEAR.demote);
  const wrong = sure.filter((s) => !s.yes).length;
  const yes = usable.filter((s) => s.yes).length;
  const found = sure.filter((s) => s.yes).length;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(`\n[실제 사진] 답 ${usable.length}장 · 우리 아이로 찾음 ${sure.length}장 중 다른 아이 ${wrong}장(${pct(wrong / sure.length)}) · 우리 아이 ${yes}장 중 바로 찾음 ${pct(found / yes)}`);
  assert.ok(wrong / sure.length <= 0.02, '우리 아이로 찾은 사진 중 다른 아이는 2% 이하');
  assert.ok(found / yes >= 0.75, '우리 아이의 75% 이상은 바로 찾는다');
});
