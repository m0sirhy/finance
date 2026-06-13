import jwt from 'jsonwebtoken';

import { db } from '../db/schema.js';

const selectUserAuth = db.prepare(
  'SELECT id, email, role, status FROM users WHERE id = ?',
);

// Verifies the JWT, then loads the CURRENT role/status from the DB (so an
// admin disabling or re-roling a user takes effect immediately, not when the
// 30-day token expires).
export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const u = selectUserAuth.get(payload.sub);
    if (!u) return res.status(401).json({ error: 'invalid_token' });
    req.user = { id: u.id, email: u.email, role: u.role, status: u.status };
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

// Gate: only fully-approved accounts proceed. Use after requireAuth.
export function requireActive(req, res, next) {
  if (req.user?.status !== 'active') {
    return res.status(403).json({ error: 'not_active' });
  }
  next();
}

// Gate: caller's role must be one of `roles`. Use after requireAuth.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
