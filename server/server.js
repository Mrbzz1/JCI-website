const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`ERREUR DE CONFIGURATION : ${err.message}`);
  process.exit(1);
}

const { db, dbPath } = openDatabase(config.dataDir);
console.log(`SQLite database: ${dbPath} (volume persistant : ${config.persistentStorage ? 'oui' : 'NON'})`);
config.warnings.forEach((w) => console.warn(`[config] ${w}`));
console.log(`CORS origins: ${[...config.corsOrigins].join(', ')}`);

const app = createApp({ db, config });
const server = app.listen(config.port, () => {
  console.log(`JCI Oudhref API running on port ${config.port} — health: /api/health`);
});

// Railway sends SIGTERM on redeploy: finish in-flight requests, then close SQLite cleanly (flushes the WAL).
function shutdown(signal) {
  console.log(`${signal} received, shutting down…`);
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
