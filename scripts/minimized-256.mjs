import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runProfile } from './e2e-lib.mjs';
import { capacityPayloadMeta } from './payload-lib.mjs';

const reconstructionCount = Number(process.env.R ?? 496);
const amplificationCount = Number(process.env.AMP ?? 5);
const tailAmplificationCount = Number(process.env.TAIL ?? 2);
const heapMb = Number(process.env.HEAP_MB ?? 256);
const trials = Number(process.env.TRIALS ?? 5);
const transport = process.env.TRANSPORT ?? 'body';
const evidenceDir = process.env.EVIDENCE_DIR
  ? resolve(process.env.EVIDENCE_DIR)
  : null;

if (!Number.isInteger(heapMb) || heapMb < 16) throw new Error(`invalid HEAP_MB=${process.env.HEAP_MB}`);
if (!Number.isInteger(trials) || trials < 1 || trials > 20) throw new Error(`invalid TRIALS=${process.env.TRIALS}`);
if (!Number.isInteger(reconstructionCount) || reconstructionCount < 1 || reconstructionCount > 5000) throw new Error(`invalid R=${process.env.R}`);
if (!Number.isInteger(amplificationCount) || amplificationCount < 0 || amplificationCount > 25) throw new Error(`invalid AMP=${process.env.AMP}`);
if (!Number.isInteger(tailAmplificationCount) || tailAmplificationCount < 0 || tailAmplificationCount > 8) throw new Error(`invalid TAIL=${process.env.TAIL}`);
if (!['body', 'case'].includes(transport)) throw new Error(`invalid TRANSPORT=${transport}`);
const candidateMeta = capacityPayloadMeta(
  'candidate',
  'hybrid',
  reconstructionCount,
  amplificationCount,
  tailAmplificationCount,
);
const controlMeta = capacityPayloadMeta(
  'control',
  'hybrid',
  reconstructionCount,
  amplificationCount,
  tailAmplificationCount,
);
console.log(`runtime: node=${process.version} v8=${process.versions.v8}`);
console.log(`profile: heap=${heapMb} MiB capacity r=${reconstructionCount} amp=${amplificationCount} tail=${tailAmplificationCount}`);
console.log(`transport=${transport} attacker_html_bytes=${candidateMeta.bytes}`);
console.log(`candidate_sha256=${candidateMeta.sha256}`);
console.log(`control_sha256=${controlMeta.sha256}`);
console.log(`trials=${trials}; every request uses a fresh worker`);

if (evidenceDir) await mkdir(evidenceDir, { recursive: true });

const results = [];
let port = 5400;
for (const profile of ['control', 'candidate']) {
  for (let trial = 1; trial <= trials; trial++) {
    const result = await runProfile({
      profile,
      shape: 'capacity',
      capacityVariant: 'hybrid',
      capacityAmplificationCount: amplificationCount,
      capacityTailAmplificationCount: tailAmplificationCount,
      reconstructionCount,
      transport,
      port: port++,
      heapMb,
      quiet: true,
      expect: 'observe',
    });
    results.push({ trial, ...result });
    const verdict = result.oom
      ? 'V8 OOM / worker exit'
      : `HTTP ${result.responseStatus}; health ${result.healthAfter}; alive=${result.alive}`;
    console.log(`${profile} ${trial}/${trials}: ${verdict}; render_ms=${result.renderDurationMs}`);

    if (evidenceDir) {
      const prefix = `${profile}-trial-${trial}`;
      await writeFile(resolve(evidenceDir, `${prefix}.stdout.log`), result.logs.stdout, 'utf8');
      await writeFile(resolve(evidenceDir, `${prefix}.stderr.log`), result.logs.stderr, 'utf8');
    }
  }
}

const compactResults = results.map(({ logs, requestError, ...result }) => ({
  ...result,
  requestError,
  fatalMarker: logs.stderr.match(/FATAL ERROR:.*|JavaScript heap out of memory|Reached heap limit/i)?.[0] ?? null,
}));
const controls = compactResults.filter((r) => r.profile === 'control');
const candidates = compactResults.filter((r) => r.profile === 'candidate');
const controlPasses = controls.filter((r) => r.responseStatus === 200 && r.alive && !r.fatal).length;
const candidatePasses = candidates.filter((r) => r.oom).length;

const summary = {
  runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
  profile: {
    heapMb,
    shape: 'capacity',
    variant: 'hybrid',
    reconstructionCount,
    amplificationCount,
    tailAmplificationCount,
    transport,
    trials,
  },
  payload: {
    bytes: candidateMeta.bytes,
    candidateSha256: candidateMeta.sha256,
    controlSha256: controlMeta.sha256,
  },
  result: { controlPasses, candidatePasses },
  trials: compactResults,
};
if (evidenceDir) await writeFile(resolve(evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(`\nsummary: control=${controlPasses}/${trials} healthy; candidate=${candidatePasses}/${trials} fatal V8 OOM`);
if (controlPasses !== trials || candidatePasses !== trials) {
  console.error('NOT REPRODUCED deterministically under this runtime/heap profile.');
  process.exit(2);
}
console.log(transport === 'case'
  ? 'PASS: hardcoded URL candidate terminates every worker; hardcoded control survives.'
  : 'PASS: exact HTTP payload terminates every candidate worker; equal-byte control survives.');
