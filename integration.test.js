const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const XLSX = require('xlsx');

function workbook(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), '评分数据');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

test('direct comparison aligns rows by id and exposes review cases', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-test-'));
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1',
    TASKS_DATA_PATH: path.join(directory, 'tasks.json') };
  let child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: 'ignore' });
  let task;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(`${url}/api/tasks`)).ok) break;
      } catch (_) { /* server is starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const common = { parent_class: 'medical', subclass: 'test', source: 'test' };
    const base = [
      { id: 1, instruction: 'first', reference: 'a', model_ans: 'a', score: 1, ...common },
      { id: 2, instruction: 'second', reference: 'b', model_ans: 'x', score: 0.2, ...common }
    ];
    const compare = [
      { id: 2, instruction: 'second', reference: 'b', model_ans: 'b', score: 0.9, ...common },
      { id: 1, instruction: 'first', reference: 'a', model_ans: 'a', score: 0.9, ...common }
    ];
    const form = new FormData();
    form.set('taskName', 'pairing test');
    form.set('submitter', 'test');
    form.set('baseType', 'upload');
    form.set('compareType', 'upload');
    form.set('baseFile', new Blob([workbook(base)]), 'base.xlsx');
    form.set('compareFile', new Blob([workbook(compare)]), 'compare.xlsx');
    const created = await fetch(`${url}/api/create-task`, { method: 'POST', body: form });
    const createdData = await created.json();
    assert.equal(created.status, 200, JSON.stringify(createdData));
    task = createdData.task;
    const compared = await fetch(`${url}/api/tasks/${task.id}/direct-comparison`, { method: 'POST' });
    const comparedData = await compared.json();
    assert.equal(compared.status, 200, JSON.stringify(comparedData));
    const queue = await (await fetch(`${url}/api/tasks/${task.id}/review-queue`)).json();
    assert.deepEqual(queue.rows.map(row => row.id), ['2']);
    const report = await fetch(`${url}/api/tasks/${task.id}/detailed-report`);
    assert.equal(report.status, 200, report.ok ? '' : await report.text());
    const book = XLSX.read(Buffer.from(await report.arrayBuffer()), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets['详细对比数据']);
    assert.deepEqual(rows.map(row => row.id), ['1', '2']);
    assert.equal(rows[1]['model_ans(对比模型)'], 'b');
    assert.equal(XLSX.utils.sheet_to_json(book.Sheets['待复核']).length, 1);
    assert.match(task.inputHashes.base, /^[a-f0-9]{64}$/);
    assert.ok(book.SheetNames.includes('运行信息'));
    child.kill();
    await once(child, 'exit');
    child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: 'ignore' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(`${url}/api/tasks/${task.id}`)).ok) break;
      } catch (_) { /* server is restarting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const restored = await (await fetch(`${url}/api/tasks/${task.id}`)).json();
    assert.equal(restored.task.status, '已完成');
    assert.equal(restored.task.inputHashes.base, task.inputHashes.base);
    assert.equal((await (await fetch(`${url}/api/tasks/${task.id}/review-queue`)).json()).total, 1);
  } finally {
    child.kill();
    for (const file of [task?.baseFile?.path, task?.compareFile?.path]) {
      if (file) fs.rmSync(file, { force: true });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
