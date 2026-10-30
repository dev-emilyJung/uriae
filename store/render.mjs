// 스토어 이미지 만들기: store/shots.html 을 크롬(headless)으로 열어 PNG로 저장
// node store/render.mjs [크롬 경로]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const page = pathToFileURL(resolve('store/shots.html')).href;
const shots = [
  ['s1', 1280, 800, 'screenshot-1-prep.png'],
  ['s2', 1280, 800, 'screenshot-2-photos.png'],
  ['s3', 1280, 800, 'screenshot-3-viewer.png'],
  ['s4', 1280, 800, 'screenshot-4-faces.png'],
  ['s5', 1280, 800, 'screenshot-5-privacy.png'],
  ['t1', 440, 280, 'promo-small-440x280.png'],
  ['og', 1200, 630, '../site/og.png'], // 카톡·SNS 공유 미리보기
];
for (const [id, w, h, out] of shots) {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', '--virtual-time-budget=4000',
    `--window-size=${w},${h}`, `--screenshot=${resolve('store', out)}`, `${page}#${id}`,
  ], { stdio: 'ignore' });
  console.log(out);
}
