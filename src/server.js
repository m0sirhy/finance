import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import './db/schema.js';
import authRouter from './routes/auth.js';
import syncRouter from './routes/sync.js';
import receiptsRouter from './routes/receipts.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is required (copy .env.example to .env and fill it in)');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'finance-api', version: '0.1.0' });
});

app.use('/auth', authRouter);
app.use('/sync', syncRouter);
app.use('/receipts', receiptsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`finance-api listening on http://localhost:${port}`);
});
