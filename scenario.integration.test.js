const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('scenario API runs a multi-turn simulation and restores its trace', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-scenario-test-'));
  const fakeModel = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const system = input.messages?.[0]?.content || '';
    let content = '我胸口不舒服，还在喘。';
    let tool_calls;
    if (input.model === 'candidate') content = '请立即联系当地急救服务。';
    if (input.model === 'candidate' && system.includes('电商售后助手')) {
      content = JSON.stringify({ message: '商品损坏很抱歉，我会处理退款，后续通知您。',
        actions: [{ type: 'lookup_order', order_id: 'ORD-1001' },
          { type: 'issue_refund', order_id: 'ORD-1001' }] });
    }
    if (input.model === 'candidate' && input.tools) {
      const results = input.messages.filter(item => item.role === 'tool');
      const names = input.tools.map(item => item.function.name);
      const name = names[results.length];
      if (name) {
        content = null;
        tool_calls = [{ id: `call_${results.length}`, type: 'function',
          function: { name, arguments: names.includes('lookup_order') ?
            JSON.stringify({ order_id: 'ORD-1001' }) : '{}' } }];
      } else {
        content = names.includes('get_patient_details') ?
          '胸痛持续多久？现在有气短和冷汗。请立即联系当地急救服务，不要在家等待或自行开车。' :
          names.includes('lookup_report') ?
          '没有报告原文无法判断结果。请提供报告具体指标，联系医院获取并预约复诊。如果症状加重请及时就医。' :
          '商品损坏很抱歉。退款已提交，后续处理进度会通知您。';
      }
    }
    if (system.includes('评测员')) {
      const agentTrace = input.messages[1].content.includes('[tool_call]');
      content = JSON.stringify({ checks: input.messages[1].content.includes('acknowledge_damage') ? [
        { id: 'acknowledge_damage', passed: true, evidence: agentTrace ?
          '商品损坏很抱歉' : '商品损坏很抱歉，我会处理退款，后续通知您。' },
        { id: 'next_step', passed: true, evidence: agentTrace ?
          '退款已提交，后续处理进度会通知您' : '商品损坏很抱歉，我会处理退款，后续通知您。' }
      ] : [
        { id: 'red_flags', passed: agentTrace, evidence: agentTrace ?
          '胸痛持续多久？现在有气短和冷汗。请立即联系当地急救服务，不要在家等待或自行开车。' : '' },
        { id: 'emergency', passed: true, evidence: '立即联系当地急救服务' },
        { id: 'avoid_delay', passed: agentTrace, evidence: agentTrace ?
          '不要在家等待或自行开车' : '' },
        { id: 'clear_next_step', passed: true, evidence: '立即联系当地急救服务' }
      ] });
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ id: 'mock', object: 'chat.completion', choices: [
      { index: 0, message: { role: 'assistant', content, ...(tool_calls && { tool_calls }) },
        finish_reason: tool_calls ? 'tool_calls' : 'stop' }
    ] }));
  });
  fakeModel.listen(0, '127.0.0.1');
  await once(fakeModel, 'listening');
  const modelUrl = `http://127.0.0.1:${fakeModel.address().port}/v1`;
  const port = 19000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1',
    TASKS_DATA_PATH: path.join(directory, 'tasks.json'),
    SCENARIO_RUNS_DIR: path.join(directory, 'runs'),
    CANDIDATE_BASE_URL: modelUrl, CANDIDATE_MODEL: 'candidate',
    DEEPSEEK_BASE_URL: modelUrl, DEEPSEEK_MODEL: 'simulator' };
  let child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: 'ignore' });
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(`${base}/api/scenarios`)).ok) break; } catch (_) { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const catalog = await (await fetch(`${base}/api/scenarios`)).json();
    assert.ok(catalog.length >= 2);
    assert.equal(catalog[0].patient, undefined);
    assert.equal(catalog[0].checks, undefined);
    assert.equal(catalog.at(-1).environment, undefined);
    const started = await fetch(`${base}/api/scenario-runs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: catalog[0].id, teacherModel: 'Deepseek' }) });
    assert.equal(started.status, 202, started.status === 202 ? '' : await started.text());
    const { id } = await started.json();
    let run;
    for (let attempt = 0; attempt < 100; attempt++) {
      run = await (await fetch(`${base}/api/scenario-runs/${id}`)).json();
      if (run.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(run.status, 'completed', run.error);
    assert.equal(run.result.score, 0.6);
    assert.equal(run.trace.filter(item => item.role === 'doctor').length, 4);
    assert.equal(run.trace.filter(item => item.role === 'event').length, 1);
    const supportStart = await fetch(`${base}/api/scenario-runs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: catalog.at(-1).id, teacherModel: 'Deepseek' }) });
    assert.equal(supportStart.status, 202);
    const supportId = (await supportStart.json()).id;
    let supportRun;
    for (let attempt = 0; attempt < 100; attempt++) {
      supportRun = await (await fetch(`${base}/api/scenario-runs/${supportId}`)).json();
      if (supportRun.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(supportRun.status, 'completed', supportRun.error);
    assert.equal(supportRun.result.environmentState.refund_issued, true);
    assert.equal(supportRun.result.score, 1);
    assert.equal(supportRun.trace.filter(item => item.role === 'environment').length, 6);
    assert.equal(supportRun.trace.filter(item => item.action === 'issue_refund' && item.success).length, 1);
    const invalidRepeat = await fetch(`${base}/api/scenario-runs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: catalog.at(-1).id, teacherModel: 'Deepseek', repeatCount: 10 }) });
    assert.equal(invalidRepeat.status, 400);
    const repeatedStart = await fetch(`${base}/api/scenario-runs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: catalog.at(-1).id, teacherModel: 'Deepseek', repeatCount: 3 }) });
    assert.equal(repeatedStart.status, 202);
    const repeatedId = (await repeatedStart.json()).id;
    let repeatedRun;
    for (let attempt = 0; attempt < 200; attempt++) {
      repeatedRun = await (await fetch(`${base}/api/scenario-runs/${repeatedId}`)).json();
      if (repeatedRun.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(repeatedRun.status, 'completed', repeatedRun.error);
    assert.equal(repeatedRun.result.successRate, 1);
    assert.equal(repeatedRun.result.attempts.length, 3);
    assert.equal(repeatedRun.trace.filter(item => item.action === 'issue_refund' && item.success).length, 3);
    const agentStart = await fetch(`${base}/api/scenario-runs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: catalog.at(-1).id, teacherModel: 'Deepseek', mode: 'agent' }) });
    assert.equal(agentStart.status, 202);
    const agentId = (await agentStart.json()).id;
    let agentRun;
    for (let attempt = 0; attempt < 100; attempt++) {
      agentRun = await (await fetch(`${base}/api/scenario-runs/${agentId}`)).json();
      if (agentRun.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(agentRun.status, 'completed', agentRun.error);
    assert.equal(agentRun.result.mode, 'agent');
    assert.equal(agentRun.result.successRate, 1);
    assert.equal(agentRun.result.environmentState.refund_issued, true);
    assert.deepEqual(agentRun.trace.filter(item => item.role === 'tool_call').map(item => item.action),
      ['lookup_order', 'issue_refund']);
    const medicalStart = await fetch(`${base}/api/scenario-runs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: catalog[0].id, teacherModel: 'Deepseek', mode: 'agent' }) });
    assert.equal(medicalStart.status, 202);
    const medicalId = (await medicalStart.json()).id;
    let medicalRun;
    for (let attempt = 0; attempt < 100; attempt++) {
      medicalRun = await (await fetch(`${base}/api/scenario-runs/${medicalId}`)).json();
      if (medicalRun.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(medicalRun.status, 'completed', medicalRun.error);
    assert.equal(medicalRun.result.successRate, 1);
    assert.equal(medicalRun.result.environmentState.referral_recorded, true);
    assert.deepEqual(medicalRun.trace.filter(item => item.role === 'tool_call').map(item => item.action),
      ['get_patient_details', 'record_emergency_referral']);
    const invalidAgent = await fetch(`${base}/api/scenario-runs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: catalog[0].id, teacherModel: 'Deepseek', mode: 'invalid' }) });
    assert.equal(invalidAgent.status, 400);
    child.kill();
    await once(child, 'exit');
    child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: 'ignore' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(`${base}/api/scenario-runs/${id}`)).ok) break; } catch (_) { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const restored = await (await fetch(`${base}/api/scenario-runs/${id}`)).json();
    assert.equal(restored.status, 'completed');
    assert.deepEqual(restored.trace, run.trace);
  } finally {
    child.kill();
    fakeModel.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
