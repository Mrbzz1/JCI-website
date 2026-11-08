/**
 * Vercel build step: writes public/js/runtime-config.js from the JCI_API_BASE_URL environment variable.
 *
 * The frontend must talk to the Railway API, never to Vercel's own /api. A missing value on a
 * production Vercel build used to silently produce a site that called https://<site>.vercel.app/api/*
 * (404). The build now FAILS in that case instead of shipping a broken site.
 */
const fs = require('fs');
const path = require('path');

const raw = String(process.env.JCI_API_BASE_URL || '').trim();
const isVercelProduction = process.env.VERCEL_ENV === 'production';
const outputPath = path.join(__dirname, '..', 'public', 'js', 'runtime-config.js');

function fail(message) {
  console.error(`\n[generate-client-config] ERREUR : ${message}\n`);
  process.exit(1);
}

let apiBaseUrl = '';
if (raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`JCI_API_BASE_URL n’est pas une URL valide : "${raw}"`);
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    fail('JCI_API_BASE_URL doit utiliser https:// (ex. https://xxxx.up.railway.app).');
  }
  if (url.hostname.endsWith('.vercel.app')) {
    fail('JCI_API_BASE_URL pointe vers Vercel. Elle doit pointer vers le backend Railway, pas vers /api de Vercel.');
  }
  apiBaseUrl = url.origin; // origin only: no path, no trailing slash
} else if (isVercelProduction) {
  fail('JCI_API_BASE_URL est absente. Ajoutez-la dans Vercel > Settings > Environment Variables (Production), ex. https://xxxx.up.railway.app, puis redéployez.');
} else {
  console.warn('[generate-client-config] JCI_API_BASE_URL absente : le site affichera une erreur de configuration (aucun appel API ne sera fait).');
}

fs.writeFileSync(outputPath, `window.JCI_CONFIG = { apiBaseUrl: ${JSON.stringify(apiBaseUrl)}, sameOrigin: false };\n`, 'utf8');
console.log(`[generate-client-config] apiBaseUrl = ${apiBaseUrl || '(vide)'}`);
