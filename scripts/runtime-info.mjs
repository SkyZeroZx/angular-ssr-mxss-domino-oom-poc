import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

async function pkgVersion(path) {
  try {
    const p = JSON.parse(await readFile(path, 'utf8'));
    return p.version ?? 'unknown';
  } catch {
    return 'not-installed';
  }
}

console.log(`node=${process.version}`);
console.log(`v8=${process.versions.v8}`);
console.log(`platform=${process.platform} ${process.arch}`);
console.log(`angular-core=${await pkgVersion('node_modules/@angular/core/package.json')}`);
console.log(`angular-platform-server=${await pkgVersion('node_modules/@angular/platform-server/package.json')}`);
console.log(`angular-ssr=${await pkgVersion('node_modules/@angular/ssr/package.json')}`);
console.log(`domino=${await pkgVersion('node_modules/domino/package.json')}`);
try {
  await access('node_modules/@angular/platform-server/third_party/domino/bundled-domino.mjs');
  console.log('domino-source=@angular/platform-server/third_party/domino/bundled-domino.mjs');
} catch {
  console.log('domino-source=not-found');
}
