// node_modules 의 라이브러리와 얼굴 모델을 extension/vendor 로 복사한다.
// 사용: npm install && npm run vendor
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const human = 'node_modules/@vladmandic/human';
mkdirSync('extension/vendor/models', { recursive: true });
cpSync(`${human}/dist/human.esm.js`, 'extension/vendor/human.esm.js');
cpSync('node_modules/jszip/dist/jszip.min.js', 'extension/vendor/jszip.min.js');
// InsightFace 모델(insightface-mobilenet-swish)은 npm 에 없어서 extension/vendor/models 에 직접 포함되어 있다
// (출처: https://github.com/vladmandic/insightface/tree/main/models)
for (const m of ['blazeface', 'facemesh']) {
  for (const ext of ['json', 'bin']) cpSync(`${human}/models/${m}.${ext}`, `extension/vendor/models/${m}.${ext}`);
}

// 그림 안내문 글자 읽기(tesseract.js): 엔진·한국어 데이터를 모두 확장 안에 넣는다.
// 라이브러리 기본값인 CDN 주소는 지워서 외부에서 코드를 받아올 여지를 없앤다 (lib/ocr.js 가 경로를 직접 지정)
mkdirSync('extension/vendor/ocr', { recursive: true });
const noCdn = (src, dst) => writeFileSync(dst, readFileSync(src, 'utf8').replaceAll('https://cdn.jsdelivr.net/npm/', './'));
noCdn('node_modules/tesseract.js/dist/tesseract.esm.min.js', 'extension/vendor/ocr/tesseract.esm.min.js');
noCdn('node_modules/tesseract.js/dist/worker.min.js', 'extension/vendor/ocr/worker.min.js');
cpSync('node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'extension/vendor/ocr/tesseract-core-simd-lstm.wasm.js');
cpSync('node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz', 'extension/vendor/ocr/kor.traineddata.gz');


// 성장 기록 글꼴(Gowun Batang, IBM Plex Sans KR, 둘 다 OFL): 구글 글꼴 서버 대신 확장 안의 파일을 쓴다.
// 글자 범위(unicode-range)별로 나뉜 woff2 라서 책에 나온 글자의 조각만 읽는다
mkdirSync('extension/vendor/fonts', { recursive: true });
const FONTS = { 'gowun-batang': [400, 700], 'ibm-plex-sans-kr': [400, 500, 600] };
let fontCss = '';
for (const [name, weights] of Object.entries(FONTS)) {
  for (const w of weights) {
    const css = readFileSync(`node_modules/@fontsource/${name}/${w}.css`, 'utf8')
      .replace(/, url\([^)]+\.woff\) format\('woff'\)/g, '')
      .replaceAll('./files/', './');
    for (const [, f] of css.matchAll(/url\(\.\/([^)]+\.woff2)\)/g)) cpSync(`node_modules/@fontsource/${name}/files/${f}`, `extension/vendor/fonts/${f}`);
    fontCss += css;
  }
}
writeFileSync('extension/vendor/fonts/fonts.css', fontCss);
console.log('vendor 복사 완료');
