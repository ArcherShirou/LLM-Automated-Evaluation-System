const scenarioSelect = document.getElementById('scenarioSelect');
const teacherSelect = document.getElementById('teacherSelect');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
let scenarios = [];
let activeRunId = null;
let pollTimer = null;

function showScenario() {
  const scenario = scenarios.find(item => item.id === scenarioSelect.value);
  document.getElementById('scenarioDescription').textContent = scenario
    ? `${scenario.setting} 开场：${scenario.opening}` : '';
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
      event: '场景事件', environment: '环境动作结果' }[item.role] || item.role;
    li.textContent = `${role}（第 ${item.turn} 轮）：${item.text}`;
    list.appendChild(li);
  }
  stopButton.hidden = run.status !== 'running';
  document.getElementById('runError').textContent = run.error || '';
  const scoreSection = document.getElementById('scoreSection');
  scoreSection.hidden = !run.result;
  if (run.result) {
    document.getElementById('scoreSummary').textContent =
      `暂定分数 ${run.result.score}；关键检查点${run.result.critical_passed ? '通过' : '未通过'}。${run.result.environmentState ? `退款${run.result.environmentState.refund_issued ? '已提交' : '未提交'}。` : ''}${run.result.needsHumanReview ? ' 评分器与证据规则有分歧，请人工复核。' : ''}`;
    const checks = document.getElementById('checkList');
    checks.replaceChildren();
    for (const check of run.result.checks) {
      const div = document.createElement('div');
      div.className = 'list-group-item';
      div.textContent = `${check.passed ? '通过' : '未通过'} · ${check.label}（权重 ${check.weight}）${check.evidence ? ` · 证据：“${check.evidence}”` : ''}`;
      checks.appendChild(div);
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
      body: JSON.stringify({ scenarioId: scenarioSelect.value, teacherModel: teacherSelect.value })
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
