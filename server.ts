import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine({
  allowedHosts: ['*'],
});

app.get('/healthz', (_req, res) => {
  res.status(200).type('text/plain').send('ok');
});

app.post(
  '/render',
  express.text({ type: ['text/plain', 'text/html'], limit: '16kb' }),
  (req, res, next) => {
    if (typeof req.body !== 'string') {
      res.status(400).type('text/plain').send('expected text body');
      return;
    }

    // Angular's public REQUEST_CONTEXT carries application data into SSR.
    // Render as GET internally because payload is already available in context.
    const renderRequest = new Request('http://127.0.0.1/');
    angularApp
      .handle(renderRequest, { payload: req.body })
      .then((response) =>
        response ? writeResponseToNodeResponse(response, res) : next(),
      )
      .catch(next);
  },
);

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const port = Number(process.env['PORT'] ?? 4000);
  app.listen(port, '127.0.0.1', () => {
    console.log(`SSR listening on http://127.0.0.1:${port}`);
  });
}

export default createNodeRequestHandler(app);
