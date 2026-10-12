const scenarioSelect = document.getElementById('scenarioSelect');
const modeSelect = document.getElementById('modeSelect');
const teacherSelect = document.getElementById('teacherSelect');
const repeatSelect = document.getElementById('repeatSelect');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
let scenarios = [];
let activeRunId = null;
let pollTimer = null;

function showScenario() {
  const scenario = scenarios.find(item => item.id === scenarioSelect.value);
  const agentAvailable = Boolean(scenario && scenario.agentEnabled);
  const agentOption = modeSelect.querySelector('option[value="agent"]');
  agentOption.disabled = !agentAvailable;
  if (!agentAvailable && modeSelect.value === 'agent') modeSelect.value = 'scenario';
  document.getElementById('scenarioDescription').textContent = scenario
    ? `${scenario.setting} 开场：${scenario.opening}` : '';
  document.getElementById('modeDescription').textContent = modeSelect.value === 'agent'
    ? '待测 Agent 自行选择并调用工具；最多 6 步，每步最多 2 次。医疗转介、复诊与退款均只写入独立沙盒。'
    : '待测助手、模拟用户进行多轮对话；客服场景可通过 JSON 申报沙盒动作。';
}

function renderRun(run) {
  document.getElementById('runSection').hidden = false;
  const labels = { running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止' };
  document.getElementById('runStatus').textContent = `${run.scenarioTitle} · ${labels[run.status] || run.status} · ${run.candidateModel || ''}`;
  const list = document.getElementById('traceList');
  list.replaceChildren();
  for (const item of run.trace || []) {
    const li = document.createElement('li');
    li.className = 'list-group-item';
    const role = { patient: run.counterpartyLabel || '患者', doctor: '待测助手',
      event: '场景事件', tool_call: 'Agent 工具请求', environment: '环境动作结果' }[item.role] || item.role;
    li.textContent = `${run.repeatCount > 1 ? `第 ${item.attempt} 次 · ` : ''}${role}（第 ${item.turn} 轮）：${item.text}`;
    list.appendChild(li);
  }
  stopButton.hidden = run.status !== 'running';
  document.getElementById('runError').textContent = run.error || '';
  const scoreSection = document.getElementById('scoreSection');
  scoreSection.hidden = !run.result;
  if (run.result) {
    const attempts = run.result.attempts || [run.result];
    document.getElementById('scoreSummary').textContent =
      `完整通过 ${Math.round(run.result.successRate * attempts.length)}/${attempts.length} 次；平均分 ${run.result.averageScore}。完整通过要求所有检查点通过。`;
    const checks = document.getElementById('checkList');
    checks.replaceChildren();
    for (const [index, attempt] of attempts.entries()) {
      const heading = document.createElement('div');
      heading.className = 'list-group-item fw-bold';
      heading.textContent = `第 ${index + 1} 次：${attempt.score} 分；关键检查点${attempt.critical_passed ? '通过' : '未通过'}${attempt.completed === false ? '；未在步数内完成' : ''}${attempt.needsHumanReview ? '；需人工复核' : ''}`;
      checks.appendChild(heading);
      for (const check of attempt.checks) {
        const div = document.createElement('div');
        div.className = 'list-group-item';
        div.textContent = `${check.passed ? '通过' : '未通过'} · ${check.label}（权重 ${check.weight}）${check.evidence ? ` · 证据：“${check.evidence}”` : ''}`;
        checks.appendChild(div);
      }
    }
  }
  startButton.disabled = run.status === 'running';
}

async function pollRun() {
  if (!activeRunId) return;
  try {
    const response = await fetch(`/api/scenario-runs/${activeRunId}`);
    const run = await response.json();
    if (!response.ok) throw new Error(run.error || '无法读取运行记录');
    renderRun(run);
    if (run.status !== 'running') {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    return run.status;
  } catch (error) {
    document.getElementById('runError').textContent = error.message;
    clearInterval(pollTimer);
    pollTimer = null;
    startButton.disabled = false;
  }
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  document.getElementById('runError').textContent = '';
  try {
    const response = await fetch('/api/scenario-runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: scenarioSelect.value, mode: modeSelect.value,
        teacherModel: teacherSelect.value,
        repeatCount: Number(repeatSelect.value) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '场景启动失败');
    activeRunId = data.id;
    localStorage.setItem('lastScenarioRunId', data.id);
    clearInterval(pollTimer);
    if (await pollRun() === 'running') pollTimer = setInterval(pollRun, 1500);
  } catch (error) {
    document.getElementById('runError').textContent = error.message;
    document.getElementById('runSection').hidden = false;
    startButton.disabled = false;
  }
});

stopButton.addEventListener('click', async () => {
  if (!activeRunId) return;
  await fetch(`/api/scenario-runs/${activeRunId}/stop`, { method: 'POST' });
  await pollRun();
});

scenarioSelect.addEventListener('change', showScenario);
modeSelect.addEventListener('change', showScenario);

(async () => {
  try {
    const response = await fetch('/api/scenarios');
    scenarios = await response.json();
    for (const scenario of scenarios) {
      const option = document.createElement('option');
      option.value = scenario.id;
      option.textContent = scenario.title;
      scenarioSelect.appendChild(option);
    }
    showScenario();
    activeRunId = localStorage.getItem('lastScenarioRunId');
    if (activeRunId) {
      if (await pollRun() === 'running') pollTimer = setInterval(pollRun, 1500);
    }
  } catch (error) {
    document.getElementById('runError').textContent = error.message;
    document.getElementById('runSection').hidden = false;
  }
})();
