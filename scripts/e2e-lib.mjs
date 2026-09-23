import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { capacityPayloadMeta, payloadMeta } from './payload-lib.mjs';

export const serverEntry = 'dist/awesome-investigation/server/server.mjs';
const fatalRe = /FATAL ERROR:.*(?:heap|Allocation failed)|JavaScript heap out of memory|Reached heap limit|Ineffective mark-compacts/is;

export function startWorker(port, heapMb = 256, quiet = false) {
  const child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, serverEntry], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (!quiet) process.stdout.write(`[worker] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (!quiet) process.stderr.write(`[worker] ${chunk}`);
  });

  return { child, logs: () => ({ stdout, stderr }) };
}

export async function waitHealthy(port, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`worker exited during startup: ${child.exitCode}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.status === 200 && (await r.text()) === 'ok') return;
    } catch {}
    await sleep(100);
  }
  throw new Error('worker did not become healthy');
}

export async function stop(child) {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2000),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

async function waitExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return { code: child.exitCode, signal: child.signalCode };
  return Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    sleep(timeoutMs).then(() => null),
  ]);
}

export async function runProfile({
  profile,
  k,
  formattingCount = k,
  reconstructionCount = k,
  encoding = 'base36',
  prefixText = false,
  shape = 'rectangular',
  capacityVariant = 'conservative',
  capacityAmplificationCount = 0,
  capacityTailAmplificationCount = 0,
  transport = 'generated',
  port,
  heapMb = 256,
  quiet = false,
  expect = 'observe',
}) {
  const meta = shape === 'capacity'
    ? capacityPayloadMeta(
        profile,
        capacityVariant,
        reconstructionCount,
        capacityAmplificationCount,
        capacityTailAmplificationCount,
      )
    : payloadMeta(formattingCount, profile, reconstructionCount, encoding, prefixText);
  if (shape !== 'rectangular' && shape !== 'capacity') {
    throw new Error(`invalid shape=${shape}`);
  }
  if (shape === 'capacity' && transport === 'generated') {
    throw new Error('capacity payload requires body, raw, or case transport');
  }
  const worker = startWorker(port, heapMb, quiet);
  let responseStatus = null;
  let requestError = null;
  let healthAfter = null;
  let exited = null;
  let responseBytes = null;
  let responseSha256 = null;
  let requestTargetBytes = null;
  let requestBodyBytes = 0;
  let renderDurationMs = null;
  const totalStartedAt = performance.now();

  try {
    await waitHealthy(port, worker.child);
    const url = new URL(`http://127.0.0.1:${port}/`);
    let requestInit = { signal: AbortSignal.timeout(30000) };
    if (transport === 'raw') {
      url.searchParams.set('p', meta.value);
    } else if (transport === 'body') {
      url.pathname = '/render';
      requestBodyBytes = meta.bytes;
      requestInit = {
        ...requestInit,
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: meta.value,
      };
    } else if (transport === 'generated') {
      url.searchParams.set('profile', profile);
      url.searchParams.set('a', String(formattingCount));
      url.searchParams.set('r', String(reconstructionCount));
      url.searchParams.set('encoding', encoding);
      if (prefixText) url.searchParams.set('prefix', 'text');
    } else if (transport === 'case') {
      url.searchParams.set('case', profile);
    } else {
      throw new Error(`invalid transport=${transport}`);
    }
    requestTargetBytes = Buffer.byteLength(`${url.pathname}${url.search}`, 'utf8');

    const renderStartedAt = performance.now();
    try {
      const response = await fetch(url, requestInit);
      responseStatus = response.status;
      const body = Buffer.from(await response.arrayBuffer());
      responseBytes = body.byteLength;
      responseSha256 = createHash('sha256').update(body).digest('hex');
    } catch (e) {
      requestError = e;
    }
    renderDurationMs = Math.round(performance.now() - renderStartedAt);

    // If the render completed with HTTP 200 there is no reason to wait 30 s
    // for a spontaneous crash. Check liveness immediately instead.
    if (responseStatus === 200 && !requestError) {
      try {
        const h = await fetch(`http://127.0.0.1:${port}/healthz`, {
          signal: AbortSignal.timeout(3000),
        });
        healthAfter = h.status;
      } catch {
        healthAfter = null;
      }
      exited = worker.child.exitCode === null
        ? null
        : { code: worker.child.exitCode, signal: worker.child.signalCode };
    } else {
      exited = await waitExit(worker.child, 5000);
    }

    const logs = worker.logs();
    const fatal = fatalRe.test(logs.stderr);
    const oom = Boolean(exited && fatal);
    const alive = worker.child.exitCode === null && healthAfter === 200;

    const result = {
      profile,
      shape,
      capacityVariant: shape === 'capacity' ? capacityVariant : null,
      capacityAmplificationCount: shape === 'capacity' ? capacityAmplificationCount : null,
      capacityTailAmplificationCount: shape === 'capacity' ? capacityTailAmplificationCount : null,
      formattingCount: shape === 'capacity' ? null : formattingCount,
      reconstructionCount,
      encoding: shape === 'capacity' ? null : encoding,
      prefixText: shape === 'capacity' ? null : prefixText,
      transport,
      bytes: meta.bytes,
      sha256: meta.sha256,
      requestTargetBytes,
      requestBodyBytes,
      responseStatus,
      responseBytes,
      responseSha256,
      renderDurationMs,
      totalDurationMs: Math.round(performance.now() - totalStartedAt),
      requestError: requestError?.message ?? null,
      healthAfter,
      exited,
      fatal,
      oom,
      alive,
      logs,
    };

    if (expect === 'survive' && !(responseStatus === 200 && alive && !fatal)) {
      throw new Error(`${profile} did not survive: ${JSON.stringify({ ...result, logs: undefined })}`);
    }
    if (expect === 'oom' && !oom) {
      throw new Error(`${profile} did not OOM: ${JSON.stringify({ ...result, logs: undefined })}`);
    }

    return result;
  } finally {
    await stop(worker.child);
  }
}
