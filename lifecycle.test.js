const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

test('completed file cannot be deleted while a task references it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-lifecycle-'));
  const filePath = path.join(__dirname, 'uploads', `${randomUUID()}.xlsx`);
  const taskPath = path.join(directory, 'tasks.json');
  const completedPath = path.join(directory, 'completed.json');
  const port = 30000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fixture');
  fs.writeFileSync(taskPath, JSON.stringify([{ id: 'task-1', status: '待评测',
    compareFile: { path: filePath } }]));
  fs.writeFileSync(completedPath, JSON.stringify([{ id: 'file-1', filePath,
    name: 'saved.xlsx', taskId: 'task-1' }]));
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: 'ignore',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
      TASKS_DATA_PATH: taskPath, COMPLETED_FILES_DATA_PATH: completedPath } });
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${base}/api/tasks`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    const removeFile = () => fetch(`${base}/api/completed-files/batch-delete`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: ['file-1'] }) });
    assert.equal((await removeFile()).status, 409);
    assert.equal(fs.existsSync(filePath), true);
    assert.equal((await fetch(`${base}/api/tasks/task-1`, { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(filePath), true);
    assert.equal((await removeFile()).status, 200);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    child.kill();
    fs.rmSync(filePath, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
