import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import express from 'express';

import { requireAuth } from '../middleware/auth.js';

const router = Router();

const uploadDir = resolve('./data/receipts');
mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/jpeg|image\/png|image\/webp|image\/heic|application\/pdf)$/.test(
      file.mimetype,
    );
    cb(ok ? null : new Error('unsupported_mime'), ok);
  },
});

router.post('/', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  res.status(201).json({
    filename: req.file.filename,
    url: `/receipts/${req.file.filename}`,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

router.use('/', requireAuth, express.static(uploadDir, { fallthrough: false }));

router.use((err, _req, res, _next) => {
  if (err && err.message === 'unsupported_mime') {
    return res.status(415).json({ error: 'unsupported_mime' });
  }
  res.status(500).json({ error: 'upload_failed' });
});

export default router;
