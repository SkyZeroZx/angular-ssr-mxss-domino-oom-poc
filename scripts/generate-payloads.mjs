import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { payloadMeta } from './payload-lib.mjs';

const k = Number(process.env.K ?? 350);
const formattingCount = Number(process.env.A ?? k);
const reconstructionCount = Number(process.env.R ?? k);
const encoding = process.env.ENCODING ?? 'base36';

const candidate = payloadMeta(formattingCount, 'candidate', reconstructionCount, encoding);
const control = payloadMeta(formattingCount, 'control', reconstructionCount, encoding);
const out = resolve('payloads');
await mkdir(out, { recursive: true });

const shape = formattingCount === reconstructionCount && encoding === 'base36'
  ? `k${formattingCount}`
  : `a${formattingCount}-r${reconstructionCount}-${encoding}`;
const candidateName = `candidate-${shape}-${candidate.bytes}b.html`;
const controlName = `control-${shape}-${control.bytes}b.html`;
await writeFile(resolve(out, candidateName), candidate.value, 'utf8');
await writeFile(resolve(out, controlName), control.value, 'utf8');
await writeFile(resolve(out, 'candidate-current.html'), candidate.value, 'utf8');
await writeFile(resolve(out, 'control-current.html'), control.value, 'utf8');

for (const meta of [candidate, control]) {
  console.log(`${meta.profile}: a=${formattingCount} r=${reconstructionCount} encoding=${encoding} bytes=${meta.bytes} sha256=${meta.sha256}`);
}
console.log(`wrote: payloads/${candidateName}`);
console.log(`wrote: payloads/${controlName}`);
