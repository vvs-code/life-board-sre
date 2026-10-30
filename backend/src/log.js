// Фактор XI: логи — поток событий в stdout, без файлов и ротации.
// Поля из чек-листа: timestamp (ISO 8601), level, message, service.name.
const service = process.env.SERVICE_NAME ?? 'backend';

export function log(level, message, extra = {}) {
  process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), level, message, 'service.name': service, ...extra }) + '\n');
}
