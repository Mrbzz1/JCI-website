const path = require('path');

const PRODUCTION_FRONTEND_ORIGIN = 'https://jci-oudhref.vercel.app';
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

/**
 * Build the server configuration from environment variables.
 * Pure function (takes `env`) so it can be tested without touching process.env.
 */
function loadConfig(env = process.env) {
  const warnings = [];
  const isProduction = env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME);

  const adminPassword = String(env.ADMIN_TOKEN || env.ADMIN_PASSWORD || '');
  if (!adminPassword) {
    throw new Error('ADMIN_TOKEN (mot de passe admin) doit être défini avant de démarrer le serveur.');
  }

  let jwtSecret = String(env.JWT_SECRET || '');
  if (!jwtSecret) {
    jwtSecret = adminPassword;
    warnings.push('JWT_SECRET n’est pas défini : ADMIN_TOKEN sert aussi de secret JWT. Définissez JWT_SECRET (aléatoire, long).');
  }

  // Database directory: explicit DB_DIR, else Railway's auto-injected volume mount, else local default.
  const explicitDir = env.DB_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || '';
  const dataDir = explicitDir ? path.resolve(explicitDir) : path.join(__dirname, 'data');
  const persistentStorage = Boolean(explicitDir);
  if (isProduction && !persistentStorage) {
    warnings.push('Aucun volume détecté (DB_DIR / RAILWAY_VOLUME_MOUNT_PATH absents) : la base SQLite sera perdue à chaque redéploiement. Attachez un volume Railway.');
  }

  const origins = new Set();
  origins.add(PRODUCTION_FRONTEND_ORIGIN);
  if (!isProduction) DEV_ORIGINS.forEach((o) => origins.add(o));
  String(env.CORS_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean)
    .forEach((origin) => {
      if (origin === '*') {
        warnings.push('CORS_ORIGINS contient "*" : ignoré. Listez des origines exactes.');
        return;
      }
      origins.add(origin);
    });

  return {
    isProduction,
    port: Number(env.PORT) || 3000,
    adminPassword,
    jwtSecret,
    jwtExpiresIn: '8h',
    dataDir,
    persistentStorage,
    corsOrigins: origins,
    maxImageBytes: 8 * 1024 * 1024,
    warnings
  };
}

module.exports = { loadConfig, normalizeOrigin, PRODUCTION_FRONTEND_ORIGIN };
