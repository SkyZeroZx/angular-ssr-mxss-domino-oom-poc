import { runProfile } from './e2e-lib.mjs';
import { capacityPayloadMeta } from './payload-lib.mjs';

const variant = process.env.VARIANT ?? 'hybrid';
const reconstructionCount = Number(process.env.R ?? 496);
const amplificationCount = Number(process.env.AMP ?? 5);
const tailAmplificationCount = Number(process.env.TAIL ?? 2);
const heapMb = Number(process.env.HEAP_MB ?? 256);
const trials = Number(process.env.TRIALS ?? 5);

if (!['conservative', 'fused', 'hybrid'].includes(variant)) throw new Error(`invalid VARIANT=${variant}`);
if (!Number.isInteger(reconstructionCount) || reconstructionCount < 1 || reconstructionCount > 5000) throw new Error(`invalid R=${process.env.R}`);
if (!Number.isInteger(amplificationCount) || amplificationCount < 0 || amplificationCount > 25) throw new Error(`invalid AMP=${process.env.AMP}`);
if (!Number.isInteger(tailAmplificationCount) || tailAmplificationCount < 0 || tailAmplificationCount > 8) throw new Error(`invalid TAIL=${process.env.TAIL}`);
if (!Number.isInteger(heapMb) || heapMb < 16) throw new Error(`invalid HEAP_MB=${process.env.HEAP_MB}`);
if (!Number.isInteger(trials) || trials < 1 || trials > 20) throw new Error(`invalid TRIALS=${process.env.TRIALS}`);

const candidate = capacityPayloadMeta('candidate', variant, reconstructionCount, amplificationCount, tailAmplificationCount);
const control = capacityPayloadMeta('control', variant, reconstructionCount, amplificationCount, tailAmplificationCount);
if (candidate.bytes !== control.bytes) throw new Error('candidate/control byte mismatch');
if (candidate.value.replaceAll(' id', ' xx') !== control.value) {
  throw new Error('control differs from candidate by more than id -> xx');
}

console.log(`runtime: node=${process.version} v8=${process.versions.v8}`);
console.log(`profile: heap=${heapMb} MiB shape=capacity variant=${variant} r=${reconstructionCount} amp=${amplificationCount} tail=${tailAmplificationCount}`);
console.log(`candidate: bytes=${candidate.bytes} sha256=${candidate.sha256}`);
console.log(`control:   bytes=${control.bytes} sha256=${control.sha256}`);
console.log(`trials=${trials}; exact POST body; every request uses a fresh worker`);

const results = [];
let port = variant === 'fused' ? 5700 : 5600;
for (const profile of ['control', 'candidate']) {
  for (let trial = 1; trial <= trials; trial++) {
    const result = await runProfile({
      profile,
      shape: 'capacity',
      capacityVariant: variant,
      capacityAmplificationCount: amplificationCount,
      capacityTailAmplificationCount: tailAmplificationCount,
      reconstructionCount,
      transport: 'body',
      port: port++,
      heapMb,
      quiet: true,
    });
    results.push(result);
    const verdict = result.oom
      ? 'V8 OOM / worker exit'
      : `HTTP ${result.responseStatus}; health ${result.healthAfter}; alive=${result.alive}`;
    console.log(`${profile} ${trial}/${trials}: ${verdict}; render_ms=${result.renderDurationMs}`);
  }
}

const controls = results.filter((result) => result.profile === 'control');
const candidates = results.filter((result) => result.profile === 'candidate');
const controlPasses = controls.filter((result) => result.responseStatus === 200 && result.alive && !result.fatal).length;
const candidatePasses = candidates.filter((result) => result.oom).length;
console.log(`\nsummary: control=${controlPasses}/${trials} healthy; candidate=${candidatePasses}/${trials} fatal V8 OOM`);
if (controlPasses !== trials || candidatePasses !== trials) process.exitCode = 2;
