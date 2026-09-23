import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capacityPayloadMeta } from './payload-lib.mjs';

const reconstructionCount = 496;
const amplificationCount = 5;
const tailAmplificationCount = 2;
const out = resolve('payloads');
await mkdir(out, { recursive: true });

for (const profile of ['candidate', 'control']) {
  const meta = capacityPayloadMeta(
    profile,
    'hybrid',
    reconstructionCount,
    amplificationCount,
    tailAmplificationCount,
  );
  const path = resolve(
    out,
    `${profile}-capacity-r${reconstructionCount}-a${amplificationCount}-t${tailAmplificationCount}-${meta.bytes}b.html`,
  );
  await writeFile(path, meta.value, 'utf8');
  console.log(`${profile}: bytes=${meta.bytes} sha256=${meta.sha256}`);
  console.log(`wrote: ${path}`);
}
