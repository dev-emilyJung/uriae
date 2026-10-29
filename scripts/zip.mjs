// 크롬 웹스토어 업로드용 zip 생성 (extension 폴더만)
import JSZip from 'jszip';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = 'extension';
const zip = new JSZip();
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  statSync(p).isDirectory() ? walk(p) : zip.file(relative(root, p).replaceAll('\\', '/'), readFileSync(p));
});
walk(root);
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
writeFileSync(`uriae-${version}.zip`, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`uriae-${version}.zip 생성`);
