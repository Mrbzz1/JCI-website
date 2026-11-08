const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const MAX_FAILED = 10;
const WINDOW_MS = 15 * 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function createAuth(config) {
  const failures = new Map(); // ip -> { count, resetAt }

  function isLocked(ip) {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
      failures.delete(ip);
      return false;
    }
    return entry.count >= MAX_FAILED;
  }

  function recordFailure(ip) {
    const now = Date.now();
    const entry = failures.get(ip);
    if (!entry || now > entry.resetAt) failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    else entry.count += 1;
  }

  function login(req, res) {
    const ip = req.ip || 'unknown';
    if (isLocked(ip)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    const password = String(req.body?.password || '');
    // Constant-time comparison (hash first so lengths always match).
    const ok = password.length > 0 && crypto.timingSafeEqual(sha256(password), sha256(config.adminPassword));
    if (!ok) {
      recordFailure(ip);
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }
    failures.delete(ip);
    const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({ token, expiresIn: config.jwtExpiresIn });
  }

  function requireAdmin(req, res, next) {
    const header = req.headers.authorization || '';
    const token = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
    try {
      req.admin = jwt.verify(token, config.jwtSecret);
      next();
    } catch {
      res.status(401).json({ error: 'Non autorisé' });
    }
  }

  return { login, requireAdmin };
}

module.exports = { createAuth };
