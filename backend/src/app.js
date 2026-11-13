import express from 'express';
import { log } from './log.js';
import { createMetrics } from './metrics.js';

// Ошибки Postgres, которые означают некорректный запрос клиента, а не сбой сервера.
const CLIENT_PG_ERRORS = new Set([
  '22P02', // invalid_text_representation
  '22007', // invalid_datetime_format
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id must be a positive integer');
  return id;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${field} is required`);
  return value.trim();
}

const orNull = (v) => (v === undefined ? null : v);

// Шаблон маршрута для метрик: каждый id иначе давал бы отдельный временной ряд.
// Считаем из пути: при ошибке Express уже вышел из роутера, и req.route с req.baseUrl неполные.
function routeLabel(path) {
  const match = path.match(/^\/api\/(spaces|tasks)(\/[^/]+)?\/?$/);
  if (!match) return 'unmatched';
  return `/api/${match[1]}${match[2] ? '/:id' : ''}`;
}

function spacesRouter(pool, metrics) {
  const r = express.Router();

  r.get('/', h(async (req, res) => {
    res.json((await pool.query('SELECT id, name, color, created_at FROM spaces ORDER BY id')).rows);
  }));

  r.get('/:id', h(async (req, res) => {
    const { rows } = await pool.query('SELECT id, name, color, created_at FROM spaces WHERE id = $1', [parseId(req.params.id)]);
    if (!rows[0]) throw new HttpError(404, 'space not found');
    res.json(rows[0]);
  }));

  r.post('/', h(async (req, res) => {
    const name = requireString(req.body.name, 'name');
    const { rows } = await pool.query(
      "INSERT INTO spaces (name, color) VALUES ($1, COALESCE($2, '#2F9E6B')) RETURNING id, name, color, created_at",
      [name, orNull(req.body.color)],
    );
    metrics.spacesCreated.inc();
    res.status(201).json(rows[0]);
  }));

  r.patch('/:id', h(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE spaces SET name = COALESCE($1, name), color = COALESCE($2, color)
       WHERE id = $3 RETURNING id, name, color, created_at`,
      [orNull(req.body.name), orNull(req.body.color), parseId(req.params.id)],
    );
    if (!rows[0]) throw new HttpError(404, 'space not found');
    res.json(rows[0]);
  }));

  r.delete('/:id', h(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM spaces WHERE id = $1', [parseId(req.params.id)]);
    if (!rowCount) throw new HttpError(404, 'space not found');
    res.status(204).end();
  }));

  return r;
}

const TASK_COLUMNS = 'id, space_id, title, description, deadline, priority, status, created_at';

function tasksRouter(pool, metrics) {
  const r = express.Router();

  r.get('/', h(async (req, res) => {
    const spaceId = req.query.space_id === undefined ? null : parseId(req.query.space_id);
    const { rows } = await pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE ($1::int IS NULL OR space_id = $1) ORDER BY id`,
      [spaceId],
    );
    res.json(rows);
  }));

  r.get('/:id', h(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1`, [parseId(req.params.id)]);
    if (!rows[0]) throw new HttpError(404, 'task not found');
    res.json(rows[0]);
  }));

  r.post('/', h(async (req, res) => {
    const b = req.body;
    const { rows } = await pool.query(
      `INSERT INTO tasks (space_id, title, description, deadline, priority, status)
       VALUES ($1, $2, COALESCE($3, ''), $4, COALESCE($5, 'mid'), COALESCE($6, 'todo'))
       RETURNING ${TASK_COLUMNS}`,
      [parseId(b.space_id), requireString(b.title, 'title'), orNull(b.description), orNull(b.deadline), orNull(b.priority), orNull(b.status)],
    );
    metrics.tasksCreated.inc({ priority: rows[0].priority });
    res.status(201).json(rows[0]);
  }));

  r.patch('/:id', h(async (req, res) => {
    const b = req.body;
    const { rows } = await pool.query(
      `UPDATE tasks SET
         space_id    = COALESCE($1, space_id),
         title       = COALESCE($2, title),
         description = COALESCE($3, description),
         deadline    = COALESCE($4, deadline),
         priority    = COALESCE($5, priority),
         status      = COALESCE($6, status)
       WHERE id = $7 RETURNING ${TASK_COLUMNS}`,
      [
        b.space_id === undefined ? null : parseId(b.space_id),
        orNull(b.title), orNull(b.description), orNull(b.deadline), orNull(b.priority), orNull(b.status),
        parseId(req.params.id),
      ],
    );
    if (!rows[0]) throw new HttpError(404, 'task not found');
    if (b.status === 'done') metrics.tasksCompleted.inc();
    res.json(rows[0]);
  }));

  r.delete('/:id', h(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [parseId(req.params.id)]);
    if (!rowCount) throw new HttpError(404, 'task not found');
    metrics.tasksDeleted.inc();
    res.status(204).end();
  }));

  return r;
}

/**
 * @param {{ pool: { query: Function }, state?: { shuttingDown: boolean }, fault?: { errorRate?: number, delayMs?: number, blockMs?: number } }} deps
 */
export function createApp({ pool, state = { shuttingDown: false }, fault = {} }) {
  const app = express();
  const metrics = createMetrics(pool);
  app.use(express.json());

  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    // Путь фиксируем до роутинга: смонтированный роутер обрезает req.url, и к 'finish' он уже испорчен.
    const path = req.path;
    res.on('finish', () => {
      if (path === '/livez' || path === '/readyz' || path === '/metrics') return;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const route = routeLabel(path);
      metrics.httpRequests.inc({ method: req.method, route, status: res.statusCode });
      metrics.httpDuration.observe({ method: req.method, route }, seconds);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log(level, 'request', { method: req.method, path, status: res.statusCode, duration_ms: Math.round(seconds * 1000) });
    });
    next();
  });

  // Liveness: процесс жив и отвечает. В базу не ходит — её недоступность не повод перезапускать под.
  app.get('/livez', (req, res) => res.json({ status: 'ok' }));

  // Readiness: можно ли слать трафик. Нет — если идёт остановка, база недоступна или миграции не применены.
  app.get('/readyz', h(async (req, res) => {
    if (state.shuttingDown) return res.status(503).json({ status: 'shutting down' });
    try {
      await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not ready', reason: err.message });
    }
  }));

  // Метрики доступны только внутри кластера: nginx проксирует наружу лишь /api/.
  app.get('/metrics', h(async (req, res) => {
    res.set('Content-Type', metrics.registry.contentType).end(await metrics.registry.metrics());
  }));

  // Управляемый сбой для демонстрации SLO и алертов: задержка, блокировка event loop и доля ответов 500. По умолчанию выключен.
  app.use('/api', h(async (req, res, next) => {
    if (fault.delayMs) await new Promise((resolve) => setTimeout(resolve, fault.delayMs));
    if (fault.blockMs) {
      // Синхронная работа занимает event loop: так растёт nodejs_eventloop_lag.
      const until = Date.now() + fault.blockMs;
      while (Date.now() < until);
    }
    if (fault.errorRate && Math.random() < fault.errorRate) throw new HttpError(500, 'injected fault');
    next();
  }));

  app.use('/api/spaces', spacesRouter(pool, metrics));
  app.use('/api/tasks', tasksRouter(pool, metrics));

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    if (CLIENT_PG_ERRORS.has(err.code)) return res.status(400).json({ error: err.detail ?? err.message });
    log('error', err.message, { path: req.path, code: err.code });
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
