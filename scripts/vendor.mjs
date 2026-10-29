// node_modules 의 라이브러리와 얼굴 모델을 extension/vendor 로 복사한다.
// 사용: npm install && npm run vendor
import { cpSync, mkdirSync } from 'node:fs';
const human = 'node_modules/@vladmandic/human';
mkdirSync('extension/vendor/models', { recursive: true });
cpSync(`${human}/dist/human.esm.js`, 'extension/vendor/human.esm.js');
cpSync('node_modules/jszip/dist/jszip.min.js', 'extension/vendor/jszip.min.js');
for (const m of ['blazeface', 'facemesh', 'faceres']) {
  for (const ext of ['json', 'bin']) cpSync(`${human}/models/${m}.${ext}`, `extension/vendor/models/${m}.${ext}`);
}
console.log('vendor 복사 완료');
