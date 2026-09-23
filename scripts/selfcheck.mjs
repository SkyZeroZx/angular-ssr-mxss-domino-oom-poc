import { readFile } from 'node:fs/promises';
import { capacityPayloadMeta, makePayload, payloadMeta } from './payload-lib.mjs';

const candidate = await readFile('payloads/candidate-4517.html', 'utf8');
const control = await readFile('payloads/control-4517.html', 'utf8');
const minimizedCandidate = await readFile('payloads/candidate-capacity-r496-a5-t2-3988b.html', 'utf8');
const minimizedControl = await readFile('payloads/control-capacity-r496-a5-t2-3988b.html', 'utf8');
const hardcodedSource = await readFile('src/app/payload.ts', 'utf8');

const bytes = (s) => Buffer.byteLength(s, 'utf8');
if (bytes(candidate) !== 4517) throw new Error(`baseline candidate is ${bytes(candidate)} bytes, expected 4517`);
if (bytes(control) !== 4517) throw new Error(`baseline control is ${bytes(control)} bytes, expected 4517`);
if (candidate.replaceAll(' id=', ' xx=') !== control) {
  throw new Error('baseline control differs from candidate by more than id= -> xx=');
}
if (candidate !== makePayload(350, 'candidate')) throw new Error('baseline candidate does not match generator k=350');
if (control !== makePayload(350, 'control')) throw new Error('baseline control does not match generator k=350');

const candidateTags = candidate.match(/<b /g)?.length ?? 0;
const controlTags = control.match(/<b /g)?.length ?? 0;
if (candidateTags !== 350 || controlTags !== 350) {
  throw new Error(`unexpected <b> counts: candidate=${candidateTags}, control=${controlTags}`);
}

const meta = payloadMeta(350, 'candidate');
const minimizedMeta = capacityPayloadMeta('candidate', 'hybrid', 496, 5, 2);
const minimizedControlMeta = capacityPayloadMeta('control', 'hybrid', 496, 5, 2);
if (bytes(minimizedCandidate) !== 3988 || bytes(minimizedControl) !== 3988) {
  throw new Error('minimized payload pair must be exactly 3,988 bytes each');
}
if (minimizedCandidate.replaceAll(' id', ' xx') !== minimizedControl) {
  throw new Error('minimized control differs from candidate by more than id -> xx');
}
if (minimizedCandidate !== minimizedMeta.value) {
  throw new Error('minimized candidate does not match capacity r=496 amp=5 tail=2 generator');
}
if (minimizedControl !== minimizedControlMeta.value) {
  throw new Error('minimized control does not match capacity r=496 amp=5 tail=2 generator');
}
if (minimizedMeta.sha256 !== '0eeebc181d417999a6b9dea349e85e4c231676527ebddda42300f7c22e08596a') {
  throw new Error(`unexpected minimized candidate hash=${minimizedMeta.sha256}`);
}
if (minimizedControlMeta.sha256 !== 'd47f7a124102ea708ef2ffc1056f0af935565db4a15866284056fabb3d6d0a3d') {
  throw new Error(`unexpected minimized control hash=${minimizedControlMeta.sha256}`);
}
if ((minimizedCandidate.match(/ id(?:=|>)/g)?.length ?? 0) !== 247) {
  throw new Error('minimized candidate must contain 247 active-formatting declarations');
}
if ((minimizedCandidate.match(/<p>x/g)?.length ?? 0) !== 496) {
  throw new Error('minimized candidate must contain 496 reconstruction tokens');
}
const hardcodedMatch = hardcodedSource.match(
  /candidate: (.+),\r?\n  control: (.+),\r?\n};/,
);
if (!hardcodedMatch) throw new Error('could not read hardcoded URL payload literals');
const hardcodedCandidate = JSON.parse(hardcodedMatch[1]);
const hardcodedControl = JSON.parse(hardcodedMatch[2]);
const hardcodedCandidateMeta = capacityPayloadMeta('candidate', 'hybrid', 496, 5, 4);
const hardcodedControlMeta = capacityPayloadMeta('control', 'hybrid', 496, 5, 4);
if (hardcodedCandidate !== hardcodedCandidateMeta.value || hardcodedControl !== hardcodedControlMeta.value) {
  throw new Error('hardcoded URL payloads do not match capacity r=496 amp=5 tail=4');
}
console.log('PASS');
console.log(`baseline: k=350 bytes=${meta.bytes}`);
console.log('difference: attribute name id -> xx only');
console.log('<b> tags: 350 each');
console.log(`node=${process.version} v8=${process.versions.v8}`);
console.log(`minimized: capacity r=496 amp=5 tail=2 bytes=${minimizedMeta.bytes}`);
console.log(`hardcoded URL: capacity r=496 amp=5 tail=4 bytes=${hardcodedCandidateMeta.bytes}`);
