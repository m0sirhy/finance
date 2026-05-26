// Sync API smoke test. Assumes server is running at http://localhost:3001
// and the database is freshly wiped (delete data/finance.db before running).
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3001';
let failures = 0;

function ok(name, cond, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${status}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function call(path, { method = 'GET', body, token, isForm = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  // 1. Register two users
  const aReg = await call('/auth/register', {
    method: 'POST',
    body: { email: `a-${Date.now()}@x.com`, password: 'hunter2hunter', name: 'A' },
  });
  ok('register A', aReg.status === 201 && aReg.data.token, `status=${aReg.status}`);
  const aTok = aReg.data.token;
  const aId = aReg.data.user.id;

  const bReg = await call('/auth/register', {
    method: 'POST',
    body: { email: `b-${Date.now()}@x.com`, password: 'hunter2hunter', name: 'B' },
  });
  ok('register B', bReg.status === 201, `status=${bReg.status}`);
  const bTok = bReg.data.token;

  // 2. As A, push 1 category + 1 counterparty + 1 transaction linked to the counterparty
  const catId = randomUUID();
  const cpId = randomUUID();
  const txId = randomUUID();
  const t0 = new Date().toISOString();
  const push1 = await call('/sync/push', {
    method: 'POST',
    token: aTok,
    body: {
      categories: [{
        id: catId, nameAr: 'طعام', nameEn: 'Food', icon: '🍔',
        color: 0xFFFF5733, type: 1, isDefault: true, updatedAt: t0,
      }],
      counterparties: [{
        id: cpId, name: 'سوبر ماركت الفجر', phone: '0599-111-222', type: 0,
        updatedAt: t0,
      }],
      transactions: [{
        id: txId, type: 1, amount: 25.5, currency: 'ILS', categoryId: catId,
        counterpartyId: cpId,
        date: t0, paymentMethod: 0, createdAt: t0, updatedAt: t0,
      }],
    },
  });
  ok('A push cat+counterparty+tx', push1.status === 200
    && push1.data.applied.categories[0]?.status === 'applied'
    && push1.data.applied.counterparties[0]?.status === 'applied'
    && push1.data.applied.transactions[0]?.status === 'applied',
    `status=${push1.status}`);

  // 2b. Invoice round-trip — A creates an issued invoice, links a payment to it
  const invId = randomUUID();
  const payTxId = randomUUID();
  const pushInv = await call('/sync/push', {
    method: 'POST',
    token: aTok,
    body: {
      invoices: [{
        id: invId, counterpartyId: cpId, direction: 0,
        number: 'INV-001', date: t0, total: 500, currency: 'ILS',
        updatedAt: t0,
      }],
      transactions: [{
        id: payTxId, type: 0, amount: 200, currency: 'ILS', categoryId: catId,
        counterpartyId: cpId, invoiceId: invId,
        date: t0, paymentMethod: 0, createdAt: t0, updatedAt: t0,
      }],
    },
  });
  ok('A push invoice + linked payment',
    pushInv.data.applied.invoices[0]?.status === 'applied'
    && pushInv.data.applied.transactions[0]?.status === 'applied',
    `status=${pushInv.status}`);

  const pullInv = await call('/sync/pull', { token: bTok });
  const pulledInv = pullInv.data.invoices.find(i => i.id === invId);
  ok('B pull sees invoice', pulledInv != null
    && pulledInv.total === 500 && pulledInv.direction === 0);
  const pulledPay = pullInv.data.transactions.find(t => t.id === payTxId);
  ok('B sees invoiceId linkage on payment', pulledPay?.invoiceId === invId);

  // 3. As B, pull from epoch — should see everything A pushed
  const pullB = await call('/sync/pull', { token: bTok });
  ok('B pull sees A\'s category', pullB.data.categories.some(c => c.id === catId));
  ok('B pull sees A\'s counterparty', pullB.data.counterparties.some(c => c.id === cpId));
  ok('B pull sees A\'s transaction', pullB.data.transactions.some(t => t.id === txId));
  ok('B sees counterpartyId on tx',
    pullB.data.transactions.find(t => t.id === txId)?.counterpartyId === cpId);
  ok('userId stamped from JWT', pullB.data.transactions[0]?.userId === aId);

  // 4. As B, push an update to the transaction with NEWER updatedAt
  const t1 = new Date(Date.now() + 1000).toISOString();
  const push2 = await call('/sync/push', {
    method: 'POST',
    token: bTok,
    body: {
      categories: [],
      transactions: [{
        id: txId, type: 1, amount: 99.99, currency: 'ILS', categoryId: catId,
        date: t0, paymentMethod: 0, createdAt: t0, updatedAt: t1,
      }],
    },
  });
  ok('B update applied (newer)', push2.data.applied.transactions[0]?.status === 'applied');

  // 5. Verify userId stayed as A (creator), not overwritten by B
  const pullA = await call('/sync/pull', { token: aTok });
  const updatedTx = pullA.data.transactions.find(t => t.id === txId);
  ok('amount updated to 99.99', updatedTx?.amount === 99.99);
  ok('userId NOT overwritten by B', updatedTx?.userId === aId,
    `got ${updatedTx?.userId}, expected ${aId}`);

  // 6. As A, push older updatedAt — should be skipped (LWW)
  const push3 = await call('/sync/push', {
    method: 'POST',
    token: aTok,
    body: {
      categories: [],
      transactions: [{
        id: txId, type: 1, amount: 1, currency: 'ILS', categoryId: catId,
        date: t0, paymentMethod: 0, createdAt: t0, updatedAt: t0,
      }],
    },
  });
  ok('A older push skipped', push3.data.applied.transactions[0]?.status === 'skipped');

  const pullAfterSkip = await call('/sync/pull', { token: aTok });
  ok('amount still 99.99 after skipped push',
    pullAfterSkip.data.transactions.find(t => t.id === txId)?.amount === 99.99);

  // 7. Incremental pull with since= recent
  const sinceFuture = new Date(Date.now() + 60000).toISOString();
  const pullEmpty = await call(`/sync/pull?since=${encodeURIComponent(sinceFuture)}`, { token: aTok });
  ok('pull since=future returns empty',
    pullEmpty.data.categories.length === 0 && pullEmpty.data.transactions.length === 0);

  // 8. Soft delete via deletedAt
  const t2 = new Date(Date.now() + 2000).toISOString();
  await call('/sync/push', {
    method: 'POST',
    token: aTok,
    body: {
      categories: [],
      transactions: [{
        id: txId, type: 1, amount: 99.99, currency: 'ILS', categoryId: catId,
        date: t0, paymentMethod: 0, createdAt: t0, updatedAt: t2, deletedAt: t2,
      }],
    },
  });
  const pullDeleted = await call('/sync/pull', { token: aTok });
  const deletedTx = pullDeleted.data.transactions.find(t => t.id === txId);
  ok('deletedAt propagates on pull', deletedTx?.deletedAt === t2);

  // 9. Receipt upload
  mkdirSync('test', { recursive: true });
  writeFileSync('test/tiny.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const form = new FormData();
  form.append('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'tiny.jpg');
  const upRes = await fetch(BASE + '/receipts', {
    method: 'POST', headers: { Authorization: `Bearer ${aTok}` }, body: form,
  });
  const upData = await upRes.json();
  ok('receipt upload returns url', upRes.status === 201 && upData.url?.startsWith('/receipts/'));

  // 10. Receipt download (auth required)
  const noAuth = await fetch(BASE + upData.url);
  ok('receipt download requires auth', noAuth.status === 401);

  const withAuth = await fetch(BASE + upData.url, {
    headers: { Authorization: `Bearer ${aTok}` },
  });
  ok('receipt download works with auth', withAuth.status === 200);

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAIL'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
