const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

test('access token protects pages, API and live transport', async () => {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', APP_ACCESS_TOKEN: 'test-secret' },
    stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${base}/login.html`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.equal((await fetch(`${base}/api/tasks`)).status, 401);
    assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(`${base}/socket.io/?EIO=4&transport=polling`)).status, 403);
    const login = await fetch(`${base}/api/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'test-secret' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/tasks`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/tasks`, { headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status, 403);
    const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${base}/api/tasks`, { headers: { Cookie: cookie } })).status, 401);
  } finally {
    child.kill();
  }
});
