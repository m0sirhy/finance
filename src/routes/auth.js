import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { db } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).trim(),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1).max(200),
});

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  });
}

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const { email, password, name } = parsed.data;

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'email_taken' });

  const id = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  const createdAt = new Date().toISOString();

  db.prepare(
    'INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, email, passwordHash, name, createdAt);

  const user = { id, email, name, createdAt };
  res.status(201).json({ user, token: signToken(user) });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const { email, password } = parsed.data;

  const row = db
    .prepare('SELECT id, email, password_hash, name, created_at FROM users WHERE email = ?')
    .get(email);
  if (!row) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const user = { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
  res.json({ user, token: signToken(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const row = db
    .prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!row) return res.status(404).json({ error: 'user_not_found' });
  res.json({ user: { id: row.id, email: row.email, name: row.name, createdAt: row.created_at } });
});

export default router;
