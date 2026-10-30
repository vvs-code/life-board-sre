import pg from 'pg';
import { config } from './config.js';
import { log } from './log.js';

// Фактор IV: Postgres — подключаемый ресурс, адрес только из DATABASE_URL.
export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Без обработчика ошибка простаивающего соединения роняет весь процесс: при рестарте базы падали все поды.
pool.on('error', (err) => log('error', err.message, { code: err.code }));
