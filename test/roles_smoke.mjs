// Functional smoke test for roles & approval gating. Assumes the server is
// running on BASE with a FRESH database. Run via roles_smoke.sh helper.
const BASE = process.env.BASE ?? 'http://localhost:3996';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const main = async () => {
  // 1. First registrant becomes admin + active.
  const a = await api('/auth/register', {
    method: 'POST',
    body: { email: 'admin@x.com', password: 'password1', name: 'Admin' },
  });
  check('first user is admin/active', a.data?.user?.role === 'admin' && a.data?.user?.status === 'active');
  const adminTok = a.data.token;

  // 2. Second registrant is pending with no role.
  const b = await api('/auth/register', {
    method: 'POST',
    body: { email: 'bob@x.com', password: 'password1', name: 'Bob' },
  });
  check('second user is pending/no-role', b.data?.user?.status === 'pending' && !b.data?.user?.role);
  const bobTok = b.data.token;
  const bobId = b.data.user.id;

  // 3. Pending user cannot pull or push.
  const pendPull = await api('/sync/pull', { token: bobTok });
  check('pending pull blocked (403 not_active)', pendPull.status === 403 && pendPull.data?.error === 'not_active');
  const pendPush = await api('/sync/push', { method: 'POST', token: bobTok, body: {} });
  check('pending push blocked (403 not_active)', pendPush.status === 403 && pendPush.data?.error === 'not_active');

  // 4. Pending user cannot list users.
  const bobUsers = await api('/users', { token: bobTok });
  check('pending cannot list users (403)', bobUsers.status === 403);

  // 5. Admin lists users.
  const list = await api('/users', { token: adminTok });
  check('admin lists 2 users', list.status === 200 && list.data?.users?.length === 2);

  // 6. Admin approves Bob as viewer.
  const approve = await api(`/users/${bobId}`, {
    method: 'PATCH', token: adminTok, body: { role: 'viewer', status: 'active' },
  });
  check('approve bob as viewer', approve.status === 200 && approve.data?.user?.role === 'viewer' && approve.data?.user?.status === 'active');

  // 7. Viewer can pull, cannot push.
  const viewPull = await api('/sync/pull', { token: bobTok });
  check('viewer can pull (200)', viewPull.status === 200);
  const viewPush = await api('/sync/push', { method: 'POST', token: bobTok, body: {} });
  check('viewer push blocked (403 forbidden)', viewPush.status === 403 && viewPush.data?.error === 'forbidden');

  // 8. Promote Bob to editor → can push.
  await api(`/users/${bobId}`, { method: 'PATCH', token: adminTok, body: { role: 'editor' } });
  const edPush = await api('/sync/push', { method: 'POST', token: bobTok, body: {} });
  check('editor can push (200)', edPush.status === 200);

  // 9. Last-admin guard: admin cannot self-demote when sole admin.
  const adminId = a.data.user.id;
  const demote = await api(`/users/${adminId}`, { method: 'PATCH', token: adminTok, body: { role: 'editor' } });
  check('last admin cannot be demoted (409 last_admin)', demote.status === 409 && demote.data?.error === 'last_admin');

  // 10. Data-entry role: may create new records but not modify existing ones.
  await api(`/users/${bobId}`, { method: 'PATCH', token: adminTok, body: { role: 'entry' } });
  const cat = {
    id: 'cat_entry_1', nameAr: 'ت', nameEn: 'T', icon: 'x', color: 1, type: 1,
    updatedAt: new Date().toISOString(),
  };
  const create = await api('/sync/push', {
    method: 'POST', token: bobTok, body: { categories: [cat] },
  });
  check('entry can create a new record',
      create.data?.applied?.categories?.[0]?.status === 'applied');

  const modify = await api('/sync/push', {
    method: 'POST', token: bobTok,
    body: { categories: [{ ...cat, nameEn: 'T2', updatedAt: new Date(Date.now() + 5000).toISOString() }] },
  });
  check('entry cannot modify an existing record (forbidden)',
      modify.data?.applied?.categories?.[0]?.status === 'forbidden');

  // Editor can still modify that record.
  await api(`/users/${bobId}`, { method: 'PATCH', token: adminTok, body: { role: 'editor' } });
  const edFix = await api('/sync/push', {
    method: 'POST', token: bobTok,
    body: { categories: [{ ...cat, nameEn: 'T3', updatedAt: new Date(Date.now() + 9000).toISOString() }] },
  });
  check('editor can modify an existing record',
      edFix.data?.applied?.categories?.[0]?.status === 'applied');

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
