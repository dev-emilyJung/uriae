// 크롬 웹스토어 업로드용 zip 생성 (extension 폴더만, 개발용 dev 폴더 제외)
import JSZip from 'jszip';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = 'extension';
const zip = new JSZip();
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  if (p === join(root, 'dev')) return;
  statSync(p).isDirectory() ? walk(p) : zip.file(relative(root, p).replaceAll('\\', '/'), readFileSync(p));
});
// 성장 기록 배경 음악은 저장소에 없다 (Pixabay 음원, 따로 배포 금지). PC마다 porch 에서 복사해 둬야 zip 에 들어간다
const MUSIC = ['calm-piano.mp3', 'peaceful-piano.mp3', 'romantic-piano.mp3'];
const missing = MUSIC.filter((f) => { try { return !statSync(join(root, 'story/audio', f)).isFile(); } catch { return true; } });
if (missing.length) {
  console.error(`성장 기록 음악이 없어요: extension/story/audio/${missing.join(', ')}\nporch 의 public/audio/night/*.mp3 를 복사한 뒤 다시 실행해 주세요.`);
  process.exit(1);
}
walk(root);
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
writeFileSync(`uriae-${version}.zip`, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`uriae-${version}.zip 생성`);
