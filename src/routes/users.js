import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/schema.js';
import { requireAuth, requireActive, requireRole } from '../middleware/auth.js';

const router = Router();
// Admin-only. Must be authenticated, active, and an admin.
router.use(requireAuth, requireActive, requireRole('admin'));

function toUser(r) {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
  };
}

const listUsers = db.prepare(
  'SELECT id, email, name, role, status, created_at FROM users ORDER BY created_at',
);
const selectUser = db.prepare(
  'SELECT id, email, name, role, status, created_at FROM users WHERE id = ?',
);
const countActiveAdmins = db.prepare(
  "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'",
);

router.get('/', (_req, res) => {
  res.json({ users: listUsers.all().map(toUser) });
});

// Approve / re-role / (de)activate a user. Approving a pending account is just
// `{ role: 'editor'|'viewer', status: 'active' }`.
const patchSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

router.patch('/:id', (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const { role, status } = parsed.data;
  if (role === undefined && status === undefined) {
    return res.status(400).json({ error: 'nothing_to_update' });
  }

  const target = selectUser.get(req.params.id);
  if (!target) return res.status(404).json({ error: 'user_not_found' });

  // Don't let the last active admin be demoted or disabled — including by
  // self-demotion — or the system becomes unmanageable.
  const demoting = role !== undefined && role !== 'admin';
  const disabling = status === 'disabled';
  if (target.role === 'admin' && target.status === 'active' && (demoting || disabling)) {
    if (countActiveAdmins.get().c <= 1) {
      return res.status(409).json({ error: 'last_admin' });
    }
  }

  if (role !== undefined) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  }
  if (status !== undefined) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
  }
  res.json({ user: toUser(selectUser.get(req.params.id)) });
});

export default router;
