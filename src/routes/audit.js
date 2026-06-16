import { Router } from 'express';

import { db } from '../db/schema.js';
import { requireAuth, requireActive, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireActive);

const byEntity = db.prepare(`
  SELECT a.user_id, u.name AS user_name, a.action, a.at
  FROM audit_log a
  LEFT JOIN users u ON u.id = a.user_id
  WHERE a.entity = ? AND a.entity_id = ?
  ORDER BY a.at
`);

// History for one record (any active user). Ordered oldest→newest, so the
// first entry is the creation and the last is the most recent edit.
router.get('/', (req, res) => {
  const entity = typeof req.query.entity === 'string' ? req.query.entity : null;
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!entity || !id) {
    return res.status(400).json({ error: 'entity_and_id_required' });
  }
  const entries = byEntity.all(entity, id).map((r) => ({
    userId: r.user_id,
    userName: r.user_name,
    action: r.action,
    at: r.at,
  }));
  res.json({ entries });
});

const recent = db.prepare(`
  SELECT a.entity, a.entity_id, a.user_id, u.name AS user_name, a.action, a.at
  FROM audit_log a
  LEFT JOIN users u ON u.id = a.user_id
  ORDER BY a.at DESC
  LIMIT ?
`);

// Recent activity across everything — admin-only.
router.get('/recent', requireRole('admin'), (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const entries = recent.all(limit).map((r) => ({
    entity: r.entity,
    entityId: r.entity_id,
    userId: r.user_id,
    userName: r.user_name,
    action: r.action,
    at: r.at,
  }));
  res.json({ entries });
});

export default router;
