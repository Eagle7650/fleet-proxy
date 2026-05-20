// ============================================================
// Fleet Proxy v2.0 — Anthropic API + Super Admin auth
// Hosted on Render at https://fleet-proxy.onrender.com
// ============================================================
// Endpoints:
//   GET  /                  → status check (existing)
//   POST /api/claude        → forwards to Anthropic API (existing)
//   POST /api/super-login   → checks Super Admin credentials against env vars (NEW)
//   GET  /api/verify-super  → verifies a Super Admin token is still valid (NEW)
//   GET  /health            → uptime monitoring (NEW)
//
// Required Render environment variables:
//   ANTHROPIC_API_KEY   - your Anthropic API key (existing)
//   SUPER_USERNAME      - hidden super-admin username (NEW)
//   SUPER_PASSWORD      - hidden super-admin password (NEW)
//   SUPER_TOKEN_SECRET  - any random long string used to sign tokens (NEW)
//   ALLOWED_ORIGIN      - your Cloudflare Pages domain (optional)
// ============================================================

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Allow your domain (or all if not set)
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));

// ============================================================
// Status check (existing behavior preserved)
// ============================================================
app.get('/', (req, res) => {
  res.json({ status: 'Fleet Tracker Proxy running' });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ============================================================
// Anthropic API proxy (existing — DO NOT change)
// ============================================================
app.post('/api/claude', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Super Admin authentication (NEW)
// ============================================================

function signToken(username, ttlMs = 30 * 24 * 3600 * 1000) {
  const secret = process.env.SUPER_TOKEN_SECRET;
  if (!secret) throw new Error('SUPER_TOKEN_SECRET not configured');
  const payload = { u: username, exp: Date.now() + ttlMs };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  try {
    const secret = process.env.SUPER_TOKEN_SECRET;
    if (!secret || !token) return null;
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const max = 5;
  const arr = (loginAttempts.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  loginAttempts.set(ip, arr);
  return true;
}

app.post('/api/super-login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Wait 15 minutes.' });
  }

  const { username, password } = req.body || {};
  const expectedUser = process.env.SUPER_USERNAME;
  const expectedPass = process.env.SUPER_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  const userOK = safeEqual(username || '', expectedUser);
  const passOK = safeEqual(password || '', expectedPass);

  if (!userOK || !passOK) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  try {
    const token = signToken(username);
    return res.json({ ok: true, token, username });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/verify-super', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false });
  return res.json({ ok: true, username: payload.u, expiresAt: payload.exp });
});

// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Fleet proxy listening on ${PORT}`));
