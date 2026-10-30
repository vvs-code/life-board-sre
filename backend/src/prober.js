// Пробер: синтетический пользователь. Снаружи приложения, через тот же nginx, что и браузер,
// проходит сценарий создания таски и сообщает, получилось ли.
import http from 'node:http';
import client from 'prom-client';
import { log } from './log.js';

const TARGET = process.env.PROBE_TARGET ?? 'http://frontend';
const INTERVAL_MS = Number(process.env.PROBE_INTERVAL_MS ?? 15000);
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 5000);
const PORT = Number(process.env.PORT ?? 9100);

const registry = new client.Registry();
const success = new client.Gauge({
  name: 'lifeboard_probe_success',
  help: '1, если последний прогон сценария успешен, иначе 0',
  registers: [registry],
});
const runs = new client.Counter({
  name: 'lifeboard_probe_runs_total',
  help: 'Прогоны сценария по результату',
  labelNames: ['result'],
  registers: [registry],
});
const duration = new client.Histogram({
  name: 'lifeboard_probe_duration_seconds',
  help: 'Время прохождения сценария',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

async function call(step, path, options = {}) {
  const res = await fetch(TARGET + path, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...options,
  });
  if (!res.ok) throw new Error(`${step}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function scenario() {
  const space = await call('create space', '/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'Проба' }) });
  try {
    const task = await call('create task', '/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ space_id: space.id, title: 'Проба', priority: 'zero' }),
    });
    await call('read task', `/api/tasks/${task.id}`);
  } finally {
    // Раздел удаляем и после неудачи, иначе проба копила бы мусор в базе.
    await call('delete space', `/api/spaces/${space.id}`, { method: 'DELETE' });
  }
}

async function probe() {
  const stop = duration.startTimer();
  try {
    await scenario();
    success.set(1);
    runs.inc({ result: 'success' });
    log('info', 'probe ok', { duration_ms: Math.round(stop() * 1000) });
  } catch (err) {
    stop();
    success.set(0);
    runs.inc({ result: 'failure' });
    log('error', 'probe failed', { error: err.message });
  }
}

http.createServer(async (req, res) => {
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}).listen(PORT, () => log('info', 'prober started', { target: TARGET, interval_ms: INTERVAL_MS }));

probe();
setInterval(probe, INTERVAL_MS);
