// node_modules 의 라이브러리와 얼굴 모델을 extension/vendor 로 복사한다.
// 사용: npm install && npm run vendor
import { cpSync, mkdirSync } from 'node:fs';
const human = 'node_modules/@vladmandic/human';
mkdirSync('extension/vendor/models', { recursive: true });
cpSync(`${human}/dist/human.esm.js`, 'extension/vendor/human.esm.js');
cpSync('node_modules/jszip/dist/jszip.min.js', 'extension/vendor/jszip.min.js');
// InsightFace 모델(insightface-mobilenet-swish)은 npm 에 없어서 extension/vendor/models 에 직접 포함되어 있다
// (출처: https://github.com/vladmandic/insightface/tree/main/models)
for (const m of ['blazeface', 'facemesh']) {
  for (const ext of ['json', 'bin']) cpSync(`${human}/models/${m}.${ext}`, `extension/vendor/models/${m}.${ext}`);
}
console.log('vendor 복사 완료');
