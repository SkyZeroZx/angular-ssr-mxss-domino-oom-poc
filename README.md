# Angular SSR OOM during HTML sanitization

Small PoC for a V8 heap crash in Angular 22.1.7 SSR. A 3,988-byte HTML body reaches an ordinary `[innerHTML]` binding through `POST /render`. Angular sanitizes it; the worker can still run out of memory while parsing it.

The candidate uses `id` attributes. The equal-size control changes only `id` to `xx`.

## Run

Use Node.js 24.16.0 and a disposable local environment. The candidate can terminate the SSR worker.

```bash
npm ci
npm run payloads:minimized
npm run selfcheck
npm run build:aot
npm run poc:minimized:256
```

The harness starts a fresh worker for every request with `--max-old-space-size=256`. It reports a crash only when V8 prints a fatal heap error and the worker exits. A healthy result needs HTTP 200 from `/render` and `/healthz`. Exit code `2` means the exact original 5/5 split did not repeat; check the printed trials.

## What happened

Fatal OOMs / fresh workers, with Node.js 24.16.0 and a 256 MiB old-space limit:

| Installed fixes | Body | `id` candidate | `xx` control |
| --- | ---: | ---: | ---: |
| None, original run | 3,988 B | 5/5 | 0/5 |
| None, repeat | 3,988 B | 5/5 | 1/5 |
| Lazy Domino ID index | 3,988 B | 1/10 | 0/10 |
| Early Angular mXSS cleanup | 3,988 B | 0/5 | 0/5 |

The small input expands to about 123,000 elements. Angular's mXSS stabilization can hold an old inert tree while parsing the next one. Domino also builds an ID index in temporary documents that nobody looks up by ID. Both add to peak memory.

- ~~The ID index alone causes the OOM.~~ It amplifies an already costly parse. The `xx` control also OOMed near the limit.
- ~~Fixing both makes this payload family safe.~~ Larger inputs still OOM, including ones without `id`.

These are observations for this payload shape and runtime, not a universal input-size limit. The fixes were tested in isolated installed-package copies; `npm ci` here restores unmodified Angular. See [Angular issue #70873](https://github.com/angular/angular/issues/70873).

## Routes

- `POST /render` accepts the HTML body as `text/plain`.
- `GET /healthz` checks whether the worker survived.
- `GET /?case=control` and `/?case=candidate` use prebuilt local values; compare them with `npm run poc:url:256`.
