import client from 'prom-client';

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

export function createMetrics(pool) {
  const registry = new client.Registry();
  // Рантайм Node.js: память, CPU, event loop, сборка мусора.
  client.collectDefaultMetrics({ register: registry });

  const httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'HTTP-запросы по маршруту и статусу',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Время обработки HTTP-запроса',
    labelNames: ['method', 'route'],
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });

  // Бизнес-метрики.
  const spacesCreated = new client.Counter({
    name: 'lifeboard_spaces_created_total',
    help: 'Созданные разделы',
    registers: [registry],
  });
  const tasksCreated = new client.Counter({
    name: 'lifeboard_tasks_created_total',
    help: 'Созданные таски по приоритету',
    labelNames: ['priority'],
    registers: [registry],
  });
  const tasksCompleted = new client.Counter({
    name: 'lifeboard_tasks_completed_total',
    help: 'Таски, переведённые в статус done',
    registers: [registry],
  });
  const tasksDeleted = new client.Counter({
    name: 'lifeboard_tasks_deleted_total',
    help: 'Удалённые таски',
    registers: [registry],
  });
  new client.Gauge({
    name: 'lifeboard_tasks',
    help: 'Таски в базе по статусу',
    labelNames: ['status'],
    registers: [registry],
    async collect() {
      this.reset();
      try {
        const { rows } = await pool.query('SELECT status, count(*)::int AS count FROM tasks GROUP BY status');
        for (const row of rows) this.set({ status: row.status }, row.count);
      } catch {
        // Сбор метрик не должен падать вместе с базой: остальные метрики нужны как раз во время сбоя.
      }
    },
  });

  return { registry, httpRequests, httpDuration, spacesCreated, tasksCreated, tasksCompleted, tasksDeleted };
}
