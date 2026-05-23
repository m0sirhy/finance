import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const categorySchema = z.object({
  id: z.string().min(1),
  nameAr: z.string(),
  nameEn: z.string(),
  icon: z.string(),
  color: z.number().int(),
  type: z.number().int().min(0).max(2),
  isDefault: z.boolean().default(false),
  deletedAt: z.string().nullable().optional(),
  updatedAt: z.string(),
});

const transactionSchema = z.object({
  id: z.string().min(1),
  type: z.number().int().min(0).max(1),
  amount: z.number(),
  currency: z.string().length(3),
  categoryId: z.string().min(1),
  counterparty: z.string().nullable().optional(),
  date: z.string(),
  paymentMethod: z.number().int(),
  referenceNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  receiptPath: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const pushSchema = z.object({
  categories: z.array(categorySchema).default([]),
  transactions: z.array(transactionSchema).default([]),
});

function rowToCategory(r) {
  return {
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    icon: r.icon,
    color: r.color,
    type: r.type,
    isDefault: !!r.is_default,
    userId: r.user_id,
    deletedAt: r.deleted_at,
    updatedAt: r.updated_at,
    serverUpdatedAt: r.server_updated_at,
  };
}

function rowToTransaction(r) {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    currency: r.currency,
    categoryId: r.category_id,
    counterparty: r.counterparty,
    date: r.date,
    paymentMethod: r.payment_method,
    referenceNumber: r.reference_number,
    notes: r.notes,
    receiptPath: r.receipt_path,
    userId: r.user_id,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    serverUpdatedAt: r.server_updated_at,
  };
}

const selectCategoriesSince = db.prepare(
  `SELECT * FROM categories WHERE server_updated_at > ? ORDER BY server_updated_at`,
);
const selectTransactionsSince = db.prepare(
  `SELECT * FROM transactions WHERE server_updated_at > ? ORDER BY server_updated_at`,
);

router.get('/pull', (req, res) => {
  const since = typeof req.query.since === 'string' ? req.query.since : '1970-01-01T00:00:00.000Z';
  res.json({
    serverNow: new Date().toISOString(),
    categories: selectCategoriesSince.all(since).map(rowToCategory),
    transactions: selectTransactionsSince.all(since).map(rowToTransaction),
  });
});

const selectCategoryById = db.prepare('SELECT updated_at FROM categories WHERE id = ?');
const upsertCategory = db.prepare(`
  INSERT INTO categories
    (id, name_ar, name_en, icon, color, type, is_default,
     user_id, deleted_at, updated_at, server_updated_at)
  VALUES
    (@id, @name_ar, @name_en, @icon, @color, @type, @is_default,
     @user_id, @deleted_at, @updated_at, @server_updated_at)
  ON CONFLICT(id) DO UPDATE SET
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    icon = excluded.icon,
    color = excluded.color,
    type = excluded.type,
    is_default = excluded.is_default,
    deleted_at = excluded.deleted_at,
    updated_at = excluded.updated_at,
    server_updated_at = excluded.server_updated_at
`);

const selectTxById = db.prepare('SELECT updated_at FROM transactions WHERE id = ?');
const upsertTransaction = db.prepare(`
  INSERT INTO transactions
    (id, type, amount, currency, category_id, counterparty, date, payment_method,
     reference_number, notes, receipt_path, user_id, deleted_at,
     created_at, updated_at, server_updated_at)
  VALUES
    (@id, @type, @amount, @currency, @category_id, @counterparty, @date, @payment_method,
     @reference_number, @notes, @receipt_path, @user_id, @deleted_at,
     @created_at, @updated_at, @server_updated_at)
  ON CONFLICT(id) DO UPDATE SET
    type = excluded.type,
    amount = excluded.amount,
    currency = excluded.currency,
    category_id = excluded.category_id,
    counterparty = excluded.counterparty,
    date = excluded.date,
    payment_method = excluded.payment_method,
    reference_number = excluded.reference_number,
    notes = excluded.notes,
    receipt_path = excluded.receipt_path,
    deleted_at = excluded.deleted_at,
    updated_at = excluded.updated_at,
    server_updated_at = excluded.server_updated_at
`);

const selectCategoryStamp = db.prepare(
  'SELECT server_updated_at FROM categories WHERE id = ?',
);
const selectTxStamp = db.prepare(
  'SELECT server_updated_at FROM transactions WHERE id = ?',
);

router.post('/push', (req, res) => {
  const parsed = pushSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const { categories, transactions } = parsed.data;
  const serverNow = new Date().toISOString();
  const userId = req.user.id;

  const applied = { categories: [], transactions: [] };

  const tx = db.transaction(() => {
    for (const c of categories) {
      const existing = selectCategoryById.get(c.id);
      if (existing && existing.updated_at >= c.updatedAt) {
        const stamp = selectCategoryStamp.get(c.id).server_updated_at;
        applied.categories.push({ id: c.id, status: 'skipped', serverUpdatedAt: stamp });
        continue;
      }
      upsertCategory.run({
        id: c.id,
        name_ar: c.nameAr,
        name_en: c.nameEn,
        icon: c.icon,
        color: c.color,
        type: c.type,
        is_default: c.isDefault ? 1 : 0,
        user_id: userId,
        deleted_at: c.deletedAt ?? null,
        updated_at: c.updatedAt,
        server_updated_at: serverNow,
      });
      applied.categories.push({ id: c.id, status: 'applied', serverUpdatedAt: serverNow });
    }

    for (const t of transactions) {
      const existing = selectTxById.get(t.id);
      if (existing && existing.updated_at >= t.updatedAt) {
        const stamp = selectTxStamp.get(t.id).server_updated_at;
        applied.transactions.push({ id: t.id, status: 'skipped', serverUpdatedAt: stamp });
        continue;
      }
      upsertTransaction.run({
        id: t.id,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        category_id: t.categoryId,
        counterparty: t.counterparty ?? null,
        date: t.date,
        payment_method: t.paymentMethod,
        reference_number: t.referenceNumber ?? null,
        notes: t.notes ?? null,
        receipt_path: t.receiptPath ?? null,
        user_id: userId,
        deleted_at: t.deletedAt ?? null,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        server_updated_at: serverNow,
      });
      applied.transactions.push({ id: t.id, status: 'applied', serverUpdatedAt: serverNow });
    }
  });
  tx();

  res.json({ serverNow, applied });
});

export default router;
