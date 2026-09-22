import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createDataStore, filterSchema } from './data.mjs';
import { defaultProgram, chartSchema } from '../shared/library.mjs';
import { generateDashboard, modelStatus } from './generation.mjs';
import { z } from 'zod/v4';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
process.env.OPENUI_TELEMETRY_DISABLED = '1';
const model = process.env.OLLAMA_MODEL || 'qwen3.5:4b';
const base = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const port = Number(process.env.PORT || 3000);
const data = await createDataStore(
  path.resolve(root, process.env.SALES_CSV || 'sales_snapshot.csv'),
);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
// Bind to loopback and reject cross-origin API requests to the local model.
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin))
    return res.status(403).json({ error: 'Cross-origin requests are disabled.' });
  res.set('Cache-Control', 'no-store');
  next();
});
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
app.get(
  '/api/metadata',
  route(async (_req, res) => res.json({ ...(await data.metadata()), defaultProgram })),
);
app.get(
  '/api/health',
  route(async (_req, res) => res.json(await modelStatus(base, model))),
);
app.post(
  '/api/summary',
  route(async (req, res) => res.json(await data.summary(filterSchema.parse(req.body)))),
);
app.post(
  '/api/chart',
  route(async (req, res) => {
    const input = z.object({ spec: chartSchema, filters: filterSchema }).parse(req.body);
    res.json(await data.chart(input.spec, input.filters));
  }),
);
let generating = false;
app.post(
  '/api/generate',
  route(async (req, res) => {
    const input = z
      .object({
        prompt: z.string().trim().min(1).max(2000),
        current: z.string().max(16000).optional(),
        filters: filterSchema,
      })
      .parse(req.body);
    if (generating)
      return res
        .status(429)
        .json({ error: 'A dashboard is already being generated. Please wait for it to finish.' });
    generating = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      res.json(await generateDashboard({ ...input, base, model, signal: controller.signal }));
    } catch (error) {
      const message = controller.signal.aborted
        ? 'Generation timed out or was cancelled. Try a smaller request.'
        : error.cause?.code === 'ECONNREFUSED'
          ? 'Ollama is offline. Start Ollama and try again.'
          : error.message;
      if (!res.destroyed) res.status(502).json({ error: message });
    } finally {
      clearTimeout(timer);
      generating = false;
    }
  }),
);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));
app.use((error, _req, res, _next) => {
  console.error(error.message);
  res.status(error instanceof z.ZodError || error.status === 400 ? 400 : 500).json({
    error:
      error instanceof z.ZodError
        ? 'Invalid request: ' + error.issues.map((i) => i.message).join('; ')
        : 'The request could not be completed. Check the server log.',
  });
});
let vite;
if (process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { middlewareMode: true, watch: { usePolling: true } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`Local: http://127.0.0.1:${port}/\nModel: ${model}`),
);
async function shutdown() {
  await vite?.close();
  server.close();
  data.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
