import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';

// Фейковый пул: запоминает запросы и отвечает тем, что положил тест.
const pool = {
  calls: [],
  respond: async () => ({ rows: [], rowCount: 0 }),
  async query(sql, params) {
    this.calls.push({ sql, params });
    return this.respond(sql, params);
  },
};
const state = { shuttingDown: false };

let server;
let base;

before(async () => {
  server = createApp({ pool, state }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  pool.calls = [];
  pool.respond = async () => ({ rows: [], rowCount: 0 });
  state.shuttingDown = false;
});

const req = (path, opts = {}) =>
  fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...opts });

describe('probes', () => {
  it('livez отвечает 200 и не ходит в базу', async () => {
    pool.respond = async () => { throw new Error('db down'); };
    const res = await req('/livez');
    assert.equal(res.status, 200);
    assert.equal(pool.calls.length, 0);
  });

  it('readyz отвечает 200, когда миграции применены', async () => {
    const res = await req('/readyz');
    assert.equal(res.status, 200);
    assert.match(pool.calls[0].sql, /schema_migrations/);
  });

  it('readyz отвечает 503, когда база недоступна', async () => {
    pool.respond = async () => { throw new Error('connection refused'); };
    assert.equal((await req('/readyz')).status, 503);
  });

  it('readyz отвечает 503 во время остановки, не трогая базу', async () => {
    state.shuttingDown = true;
    assert.equal((await req('/readyz')).status, 503);
    assert.equal(pool.calls.length, 0);
  });
});

describe('spaces', () => {
  it('POST без name — 400, в базу не ходит', async () => {
    const res = await req('/api/spaces', { method: 'POST', body: JSON.stringify({ color: '#fff' }) });
    assert.equal(res.status, 400);
    assert.equal(pool.calls.length, 0);
  });

  it('POST передаёт значения параметрами, а не строкой SQL', async () => {
    const name = "Работа'); DROP TABLE spaces; --";
    pool.respond = async () => ({ rows: [{ id: 1, name }], rowCount: 1 });
    const res = await req('/api/spaces', { method: 'POST', body: JSON.stringify({ name }) });
    assert.equal(res.status, 201);
    assert.deepEqual(pool.calls[0].params, [name, null]);
    assert.ok(!pool.calls[0].sql.includes(name));
  });

  it('PATCH несуществующего раздела — 404', async () => {
    const res = await req('/api/spaces/42', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) });
    assert.equal(res.status, 404);
  });

  it('DELETE существующего раздела — 204', async () => {
    pool.respond = async () => ({ rows: [], rowCount: 1 });
    assert.equal((await req('/api/spaces/1', { method: 'DELETE' })).status, 204);
  });
});

describe('tasks', () => {
  it('некорректный id — 400', async () => {
    assert.equal((await req('/api/tasks/abc')).status, 400);
    assert.equal(pool.calls.length, 0);
  });

  it('GET несуществующей таски — 404', async () => {
    assert.equal((await req('/api/tasks/5')).status, 404);
  });

  it('фильтр по разделу уходит параметром', async () => {
    await req('/api/tasks?space_id=3');
    assert.deepEqual(pool.calls[0].params, [3]);
  });

  it('POST без title — 400', async () => {
    const res = await req('/api/tasks', { method: 'POST', body: JSON.stringify({ space_id: 1 }) });
    assert.equal(res.status, 400);
  });

  it('PATCH меняет только переданные поля', async () => {
    pool.respond = async () => ({ rows: [{ id: 7, status: 'done' }], rowCount: 1 });
    const res = await req('/api/tasks/7', { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    assert.equal(res.status, 200);
    assert.deepEqual(pool.calls[0].params, [null, null, null, null, null, 'done', 7]);
  });
});

describe('errors', () => {
  it('нарушение CHECK в базе — 400', async () => {
    pool.respond = async () => { throw Object.assign(new Error('check'), { code: '23514' }); };
    const res = await req('/api/tasks', { method: 'POST', body: JSON.stringify({ space_id: 1, title: 't', priority: 'urgent' }) });
    assert.equal(res.status, 400);
  });

  it('неожиданная ошибка — 500 без деталей наружу', async () => {
    pool.respond = async () => { throw new Error('secret internals'); };
    const res = await req('/api/spaces');
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'internal error');
  });

  it('битый JSON — 400', async () => {
    const res = await req('/api/spaces', { method: 'POST', body: '{oops' });
    assert.equal(res.status, 400);
  });
});

describe('metrics', () => {
  const scrape = async () => (await req('/metrics')).text();

  it('отдаёт метрики рантайма в формате Prometheus', async () => {
    const res = await req('/metrics');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /nodejs_eventloop_lag_seconds/);
  });

  it('считает созданные таски по приоритету', async () => {
    pool.respond = async () => ({ rows: [{ id: 1, priority: 'high' }], rowCount: 1 });
    await req('/api/tasks', { method: 'POST', body: JSON.stringify({ space_id: 1, title: 'x', priority: 'high' }) });
    assert.match(await scrape(), /lifeboard_tasks_created_total\{priority="high"\} 1/);
  });

  it('считает завершённые таски только при переходе в done', async () => {
    const before = Number((await scrape()).match(/lifeboard_tasks_completed_total (\d+)/)[1]);
    pool.respond = async () => ({ rows: [{ id: 1 }], rowCount: 1 });
    await req('/api/tasks/1', { method: 'PATCH', body: JSON.stringify({ status: 'in_progress' }) });
    await req('/api/tasks/1', { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    const after = Number((await scrape()).match(/lifeboard_tasks_completed_total (\d+)/)[1]);
    assert.equal(after, before + 1);
  });

  it('в метке route шаблон маршрута, а не конкретный id', async () => {
    await req('/api/tasks/42');
    const text = await scrape();
    assert.match(text, /route="\/api\/tasks\/:id",status="404"/);
    assert.doesNotMatch(text, /route="\/api\/tasks\/42"/);
  });

  it('метка route полная и для запросов с ошибкой', async () => {
    await req('/api/spaces', { method: 'POST', body: JSON.stringify({ name: '' }) });
    assert.match(await scrape(), /method="POST",route="\/api\/spaces",status="400"/);
  });

  it('неизвестные пути не плодят временные ряды', async () => {
    await req('/wp-admin/login.php');
    const text = await scrape();
    assert.match(text, /route="unmatched",status="404"/);
    assert.doesNotMatch(text, /wp-admin/);
  });

  it('gauge показывает таски из базы и не ломает сбор, когда база недоступна', async () => {
    pool.respond = async () => ({ rows: [{ status: 'todo', count: 3 }], rowCount: 1 });
    assert.match(await scrape(), /lifeboard_tasks\{status="todo"\} 3/);
    pool.respond = async () => { throw new Error('db down'); };
    const res = await req('/metrics');
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), /lifeboard_tasks\{status=/);
  });
});

describe('fault injection', () => {
  const run = async (fault, path) => {
    const instance = createApp({ pool, state, fault }).listen(0);
    await new Promise((resolve) => instance.once('listening', resolve));
    try {
      const started = Date.now();
      const res = await fetch(`http://127.0.0.1:${instance.address().port}${path}`);
      return { status: res.status, ms: Date.now() - started };
    } finally {
      instance.close();
    }
  };

  it('по умолчанию выключен', async () => {
    assert.equal((await run({}, '/api/spaces')).status, 200);
  });

  it('errorRate=1 отвечает 500 на запросы к API', async () => {
    assert.equal((await run({ errorRate: 1 }, '/api/spaces')).status, 500);
  });

  it('не трогает пробы: иначе Kubernetes перезапускал бы поды', async () => {
    assert.equal((await run({ errorRate: 1 }, '/livez')).status, 200);
  });

  it('delayMs замедляет ответ', async () => {
    assert.ok((await run({ delayMs: 60 }, '/api/spaces')).ms >= 55);
  });

  it('blockMs занимает event loop на время запроса', async () => {
    assert.ok((await run({ blockMs: 60 }, '/api/spaces')).ms >= 55);
  });
});
