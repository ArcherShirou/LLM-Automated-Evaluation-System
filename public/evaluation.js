function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

// 评测页面JavaScript逻辑
let socket;
let currentTask = null;

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    // 初始化Socket.IO连接
    socket = io();
    
    // 获取URL参数中的任务ID
    const urlParams = new URLSearchParams(window.location.search);
    const taskId = urlParams.get('taskId');
    
    if (taskId) {
        loadTaskDetails(taskId);
    } else {
        showError('未找到任务ID');
        return;
    }
    
    // 绑定事件监听器
    setupEventListeners();
    setupSocketListeners();
});

// 设置事件监听器
function setupEventListeners() {
    // 开始评测按钮
    const startBtn = document.getElementById('startEvaluationBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startEvaluation);
    }
    
    // 停止评测按钮
    const stopBtn = document.getElementById('stopEvaluationBtn');
    if (stopBtn) {
        stopBtn.addEventListener('click', stopEvaluation);
    }
    
    // 返回首页按钮
    const backBtn = document.getElementById('backToHomeBtn');
    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = '/';
        });
    } else {
        console.error('未找到返回按钮元素');
    }
}

// 设置Socket监听器
function setupSocketListeners() {
    socket.on('evaluationProgress', (data) => {
        if (data.taskId === currentTask?.id) {
            updateProgress(data);
        }
    });
    
    socket.on('evaluationComplete', (data) => {
        handleEvaluationComplete(data);
        // 更新任务状态显示
        if (currentTask && data.task) {
            currentTask.status = data.task.status;
            document.getElementById('taskStatus').textContent = currentTask.status || '已完成';
        }
    });
    
    socket.on('evaluationError', (data) => {
        handleEvaluationError(data);
        // 更新任务状态显示
        if (currentTask) {
            currentTask.status = '评测失败';
            document.getElementById('taskStatus').textContent = '评测失败';
        }
    });
    
    socket.on('evaluationLog', (data) => {
        if (data.taskId === currentTask?.id) {
            const logContainer = document.getElementById('evaluationLog');
            if (logContainer && data.message) {
                if (data.type === 'progress') {
                    // 处理进度条信息
                    addLogMessage(data.message, logContainer, 'progress');
                } else {
                    // 处理其他日志信息
                    addLogMessage(data.message, logContainer);
                }
            }
        }
    });
}

// 加载任务详情
async function loadTaskDetails(taskId) {
    try {
        const response = await fetch(`/api/tasks/${taskId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            currentTask = data.task;
            displayTaskInfo(currentTask);
            setupFileConfiguration(currentTask);
            
            // 如果任务已完成，恢复评测结果和进度条
            if (currentTask.status === '已完成' && currentTask.results) {
                
                // 显示进度容器
                const progressContainer = document.getElementById('progressContainer');
                if (progressContainer) {
                    progressContainer.style.display = 'block';
                }
                
                // 恢复评测日志
                const logContainer = document.getElementById('evaluationLog');
                if (logContainer && currentTask.evaluationLog) {
                    logContainer.textContent = currentTask.evaluationLog;
                } else if (logContainer) {
                    logContainer.innerHTML = '';
                    addLogMessage('🚀 评测已完成', logContainer);
                    addLogMessage('📊 正在加载历史结果...', logContainer);
                    
                    // 模拟进度条
                    if (currentTask.results) {
                        currentTask.results.forEach(result => {
                            const progressEntry = document.createElement('div');
                            progressEntry.className = 'progress-bar-entry completed';
                            progressEntry.style.opacity = '0.7';
                            progressEntry.textContent = `${result.fileName}: 100% 完成 (${result.totalQuestions || 0} 题)`;
                            logContainer.appendChild(progressEntry);
                        });
                    }
                }
                
                // 显示评测结果
                displayResults(currentTask.results, currentTask.statistics);
                
                // 更新按钮状态
                const startBtn = document.getElementById('startEvaluationBtn');
                const stopBtn = document.getElementById('stopEvaluationBtn');
                if (startBtn) {
                    startBtn.disabled = false;
                    startBtn.textContent = '重新评测';
                }
                if (stopBtn) {
                    stopBtn.style.display = 'none';
                }
            }
            // 如果任务正在评测中，恢复进度状态
            else if (currentTask.status === '评测中') {
                
                // 显示进度容器
                const progressContainer = document.getElementById('progressContainer');
                if (progressContainer) {
                    progressContainer.style.display = 'block';
                }
                
                // 恢复评测日志
                const logContainer = document.getElementById('evaluationLog');
                if (logContainer && currentTask.evaluationLog) {
                    logContainer.textContent = currentTask.evaluationLog;
                } else if (logContainer) {
                    logContainer.innerHTML = '';
                    addLogMessage('🚀 评测正在进行中...', logContainer);
                    addLogMessage('📊 正在恢复进度状态...', logContainer);
                }
                
                // 恢复进度条状态
                if (currentTask.file1Progress !== undefined) {
                    updateProgressBar('file1Progress', currentTask.file1Progress, logContainer, null, null);
                }
                if (currentTask.file2Progress !== undefined) {
                    updateProgressBar('file2Progress', currentTask.file2Progress, logContainer, null, null);
                }
                
                // 恢复总体进度
                const totalFiles = (currentTask.fileConfigs && currentTask.fileConfigs.baseFile && currentTask.fileConfigs.baseFile.evaluate ? 1 : 0) +
                                  (currentTask.fileConfigs && currentTask.fileConfigs.compareFile && currentTask.fileConfigs.compareFile.evaluate ? 1 : 0);
                if (totalFiles > 0) {
                    const file1Progress = currentTask.file1Progress || 0;
                    const file2Progress = currentTask.file2Progress || 0;
                    const overallProgress = (file1Progress + file2Progress) / totalFiles;
                    updateOverallProgressBar(overallProgress, logContainer, 0, 0);
                }
                
                // 如果有模型输出记录，恢复到日志中
                if (currentTask.modelOutputs && currentTask.modelOutputs.length > 0) {
                    currentTask.modelOutputs.forEach(output => {
                        const timestamp = new Date(output.timestamp).toLocaleTimeString();
                        addLogMessage(`[${timestamp}] ${output.file}: ${output.output}`, logContainer);
                    });
                }
                
                // 更新按钮状态
                const startBtn = document.getElementById('startEvaluationBtn');
                const stopBtn = document.getElementById('stopEvaluationBtn');
                if (startBtn) {
                    startBtn.disabled = true;
                    startBtn.textContent = '评测中...';
                }
                if (stopBtn) {
                    stopBtn.style.display = 'inline-block';
                }
                
                // 如果有部分结果，显示它们
                if (currentTask.results && currentTask.results.length > 0) {
                    displayResults(currentTask.results, currentTask.statistics);
                }
            }
        } else {
            console.error('API返回错误:', data.error);
            showError(data.error || '加载任务失败');
        }
    } catch (error) {
        console.error('加载任务详情失败:', error);
        showError('加载任务详情失败: ' + error.message);
    }
}

// 显示任务信息
function displayTaskInfo(task) {
    
    document.getElementById('taskTitle').textContent = task.name || '未知任务';
    const submitter = document.getElementById('submitter');
    submitter.hidden = !task.submitter || task.submitter === '未填写';
    if (!submitter.hidden) submitter.textContent = `提交人：${task.submitter}`;
    const createTime = task.submitTime || task.createdAt;
    document.getElementById('createTime').textContent = createTime ? `创建：${new Date(createTime).toLocaleString()}` : '';
    document.getElementById('taskStatus').textContent = task.status || '未知状态';
}

// 设置文件配置
async function setupFileConfiguration(task) {
    const container = document.getElementById('fileConfigContainer');
    container.replaceChildren();
    async function hasScore(fileType) {
        const response = await fetch(`/api/tasks/${task.id}/check-score-column`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileType })
        });
        if (!response.ok) throw new Error('读取文件评分信息失败');
        return (await response.json()).hasScore;
    }
    try {
        const [base, compare] = await Promise.all([
            task.baseFile ? hasScore('base') : false,
            hasScore('compare')
        ]);
        task.baseHasScore = base;
        task.compareHasScore = compare;
        if (task.baseFile) container.appendChild(createFileConfigCard(task.baseFile, 'base', 'Base 文件', base, true));
        container.appendChild(createFileConfigCard(task.compareFile, 'compare', '对比文件', compare, !!task.baseFile));
        const startButton = document.getElementById('startEvaluationBtn');
        const updateLabel = () => {
            const reuseBoth = base && compare &&
                !document.getElementById('baseEvaluate').checked &&
                !document.getElementById('compareEvaluate').checked;
            document.getElementById('scoringOptions').style.display = reuseBoth ? 'none' : '';
            startButton.textContent = reuseBoth ? '查看现有评分' : '开始评测';
        };
        container.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener('change', updateLabel));
        updateLabel();
    } catch (error) {
        showError(error.message);
    }
}

function createFileConfigCard(file, type, title, hasScore, allowReuse) {
    const card = document.createElement('div');
    card.className = 'card mb-2';
    card.innerHTML = `<div class="card-body d-flex justify-content-between align-items-center gap-3">
        <div><strong>${title}</strong><div class="text-muted">${escapeHtml(file.name)}</div></div>
        ${hasScore && allowReuse ? `<label class="form-check-label"><input class="form-check-input" type="checkbox" id="${type}Evaluate"> 重新评分</label>` : `<span class="text-muted">${hasScore ? '将重新评分' : '待评分'}</span>`}
    </div>`;
    return card;
}

// 辅助函数：创建分数差异显示
function createScoreDifference(baseScore, compareScore) {
    // 确保分数是有效数字，如果不是则设为0
    const validBaseScore = (typeof baseScore === 'number' && !isNaN(baseScore)) ? baseScore : 0;
    const validCompareScore = (typeof compareScore === 'number' && !isNaN(compareScore)) ? compareScore : 0;
    
    const diff = validCompareScore - validBaseScore;
    const diffClass = diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted';
    const diffIcon = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
    return `<span class="${diffClass}"><strong>${diffIcon} ${diff > 0 ? '+' : ''}${diff.toFixed(3)}</strong></span>`;
}

// 辅助函数：创建父类汇总
function createParentClassSummary(baseStats, compareStats) {
    if (!baseStats.by_parent_class || !compareStats.by_parent_class) {
        return '<p class="text-muted">暂无父类数据</p>';
    }
    
    const allParentClasses = new Set([
        ...Object.keys(baseStats.by_parent_class),
        ...Object.keys(compareStats.by_parent_class)
    ]);
    
    let betterCount = 0;
    let worseCount = 0;
    let equalCount = 0;
    
    Array.from(allParentClasses).forEach(parentClass => {
        const baseAvg = baseStats.by_parent_class[parentClass]?.average_score || 0;
        const compareAvg = compareStats.by_parent_class[parentClass]?.average_score || 0;
        const diff = compareAvg - baseAvg;
        
        if (diff > 0.001) betterCount++;
        else if (diff < -0.001) worseCount++;
        else equalCount++;
    });
    
    return `
        <div class="summary-stats">
            <div class="stat-item text-success">
                <span class="stat-number">${betterCount}</span>
                <span class="stat-label">优于Base</span>
            </div>
            <div class="stat-item text-danger">
                <span class="stat-number">${worseCount}</span>
                <span class="stat-label">劣于Base</span>
            </div>
            <div class="stat-item text-muted">
                <span class="stat-number">${equalCount}</span>
                <span class="stat-label">持平</span>
            </div>
        </div>
    `;
}

// 辅助函数：创建子类汇总
function createSubClassSummary(baseStats, compareStats) {
    if (!baseStats.by_sub_class || !compareStats.by_sub_class) {
        return '<p class="text-muted">暂无子类数据</p>';
    }
    
    const allSubClasses = new Set([
        ...Object.keys(baseStats.by_sub_class),
        ...Object.keys(compareStats.by_sub_class)
    ]);
    
    let betterCount = 0;
    let worseCount = 0;
    let equalCount = 0;
    
    Array.from(allSubClasses).forEach(subClass => {
        const baseAvg = baseStats.by_sub_class[subClass]?.average_score || 0;
        const compareAvg = compareStats.by_sub_class[subClass]?.average_score || 0;
        const diff = compareAvg - baseAvg;
        
        if (diff > 0.001) betterCount++;
        else if (diff < -0.001) worseCount++;
        else equalCount++;
    });
    
    return `
        <div class="summary-stats">
            <div class="stat-item text-success">
                <span class="stat-number">${betterCount}</span>
                <span class="stat-label">优于Base</span>
            </div>
            <div class="stat-item text-danger">
                <span class="stat-number">${worseCount}</span>
                <span class="stat-label">劣于Base</span>
            </div>
            <div class="stat-item text-muted">
                <span class="stat-number">${equalCount}</span>
                <span class="stat-label">持平</span>
            </div>
        </div>
    `;
}

// 显示详细排名
function showDetailedRanking(type) {
    const rankingArea = document.getElementById('detailedRankingArea');
    const rankingTitle = document.getElementById('rankingTitle');
    const rankingContent = document.getElementById('rankingContent');
    
    if (!currentTask || !currentTask.statistics || currentTask.statistics.length !== 2) {
        rankingContent.innerHTML = '<p class="text-muted">暂无数据</p>';
        return;
    }
    
    const baseStats = currentTask.statistics[0];
    const compareStats = currentTask.statistics[1];
    
    let content = '';
    let title = '';
    
    if (type === 'overall') {
        title = '整体平均分排名';
        content = createOverallRanking(baseStats, compareStats);
    } else if (type === 'parent') {
        title = '父类平均分排名';
        content = createParentClassRanking(baseStats, compareStats);
    } else if (type === 'subclass') {
        title = '子类平均分排名';
        content = createSubClassRanking(baseStats, compareStats);
    }
    
    rankingTitle.textContent = title;
    rankingContent.innerHTML = content;
    rankingArea.style.display = 'block';
    
    // 滚动到排名区域
    rankingArea.scrollIntoView({ behavior: 'smooth' });
}

function modelDisplayName(type, result) {
    const configured = currentTask?.fileConfigs?.[`${type}File`]?.name?.trim();
    if (configured) return configured;
    const file = result || currentTask?.results?.find(item => item.type === type);
    const name = file?.fileName || file?.name || currentTask?.[`${type}File`]?.name;
    return name ? name.replace(/\.xlsx$/i, '') : (type === 'base' ? 'Base模型' : '对比模型');
}

// 创建整体排名
function createOverallRanking(baseStats, compareStats) {
    const baseScore = baseStats.overall?.average_score || 0;
    const compareScore = compareStats.overall?.average_score || 0;
    
    const baseModelName = modelDisplayName('base');
    const compareModelName = modelDisplayName('compare');

    const models = [
        { name: baseModelName, score: baseScore, type: 'base' },
        { name: compareModelName, score: compareScore, type: 'compare' }
    ].sort((a, b) => b.score - a.score);
    
    return `
        <div class="ranking-table">
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>排名</th>
                        <th>模型</th>
                        <th>平均分</th>
                        <th>与第一名差距</th>
                    </tr>
                </thead>
                <tbody>
                    ${models.map((model, index) => {
                        const diff = models[0].score - model.score;
                        const rankClass = model.type === 'base' ? 'table-info' : 'table-warning';
                        return `
                            <tr class="${rankClass}">
                                <td><strong>${index + 1}</strong></td>
                                <td>${escapeHtml(model.name)}</td>
                                <td><strong>${model.score.toFixed(3)}</strong></td>
                                <td>${diff === 0 ? '-' : '-' + diff.toFixed(3)}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// 创建父类排名
function createParentClassRanking(baseStats, compareStats) {
    if (!baseStats.by_parent_class || !compareStats.by_parent_class) {
        return '<p class="text-muted">暂无父类数据</p>';
    }
    
    const baseModelName = modelDisplayName('base');
    const compareModelName = modelDisplayName('compare');

    const allParentClasses = new Set([
        ...Object.keys(baseStats.by_parent_class),
        ...Object.keys(compareStats.by_parent_class)
    ]);
    
    const rankings = [];
    
    Array.from(allParentClasses).forEach(parentClass => {
        const baseAvg = baseStats.by_parent_class[parentClass]?.average_score || 0;
        const compareAvg = compareStats.by_parent_class[parentClass]?.average_score || 0;
        
        rankings.push({
            category: parentClass,
            baseScore: baseAvg,
            compareScore: compareAvg,
            diff: compareAvg - baseAvg
        });
    });
    
    // 按差异排序（对比模型优势最大的在前）
    rankings.sort((a, b) => b.diff - a.diff);
    
    return `
        <div class="ranking-table">
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>排名</th>
                        <th>父类</th>
                        <th>${escapeHtml(baseModelName)}</th>
                        <th>${escapeHtml(compareModelName)}</th>
                        <th>差异</th>
                    </tr>
                </thead>
                <tbody>
                    ${rankings.map((item, index) => {
                        const diffClass = item.diff > 0 ? 'text-success' : item.diff < 0 ? 'text-danger' : 'text-muted';
                        return `
                            <tr>
                                <td><strong>${index + 1}</strong></td>
                                <td>${escapeHtml(item.category)}</td>
                                <td>${item.baseScore.toFixed(3)}</td>
                                <td>${item.compareScore.toFixed(3)}</td>
                                <td class="${diffClass}"><strong>${item.diff > 0 ? '+' : ''}${item.diff.toFixed(3)}</strong></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// 创建子类排名
function createSubClassRanking(baseStats, compareStats) {
    if (!baseStats.by_sub_class || !compareStats.by_sub_class) {
        return '<p class="text-muted">暂无子类数据</p>';
    }
    
    const allSubClasses = new Set([
        ...Object.keys(baseStats.by_sub_class),
        ...Object.keys(compareStats.by_sub_class)
    ]);
    
    const rankings = [];
    
    Array.from(allSubClasses).forEach(subClass => {
        const baseAvg = baseStats.by_sub_class[subClass]?.average_score || 0;
        const compareAvg = compareStats.by_sub_class[subClass]?.average_score || 0;
        
        rankings.push({
            category: subClass,
            baseScore: baseAvg,
            compareScore: compareAvg,
            diff: compareAvg - baseAvg
        });
    });
    
    // 按差异排序（对比模型优势最大的在前）
    rankings.sort((a, b) => b.diff - a.diff);
    
    return `
        <div class="ranking-table">
            <table class="table table-striped table-sm">
                <thead>
                    <tr>
                        <th>排名</th>
                        <th>子类</th>
                        <th>${escapeHtml(modelDisplayName('base'))}</th>
                        <th>${escapeHtml(modelDisplayName('compare'))}</th>
                        <th>差异</th>
                    </tr>
                </thead>
                <tbody>
                    ${rankings.map((item, index) => {
                        const diffClass = item.diff > 0 ? 'text-success' : item.diff < 0 ? 'text-danger' : 'text-muted';
                        return `
                            <tr>
                                <td><strong>${index + 1}</strong></td>
                                <td>${escapeHtml(item.category)}</td>
                                <td>${item.baseScore.toFixed(3)}</td>
                                <td>${item.compareScore.toFixed(3)}</td>
                                <td class="${diffClass}"><strong>${item.diff > 0 ? '+' : ''}${item.diff.toFixed(3)}</strong></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function exportDetailedReport() {
    if (!currentTask) {
        showError('当前没有可用的任务数据');
        return;
    }
    
    try {
        const response = await fetch(`/api/tasks/${currentTask.id}/detailed-report`, {
            method: 'GET'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // 获取文件名
        const contentDisposition = response.headers.get('Content-Disposition');
        let fileName = 'detailed_comparison_report.xlsx';
        if (contentDisposition) {
            const fileNameMatch = contentDisposition.match(/filename="(.+)"/i);
            if (fileNameMatch) {
                fileName = fileNameMatch[1];
            }
        }
        
        // 下载文件
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        showSuccess('详细报告导出成功');
    } catch (error) {
        console.error('导出详细报告失败:', error);
        showError('导出详细报告失败: ' + error.message);
    }
}

// 开始评测
// 处理直接对比功能
async function handleDirectComparison() {
    try {
        // 显示加载状态
        const startBtn = document.getElementById('startEvaluationBtn');
        startBtn.disabled = true;
        startBtn.textContent = '正在加载对比数据...';
        
        // 隐藏进度区域，显示结果区域
        document.getElementById('progressContainer').style.display = 'none';
        const resultsContainer = document.getElementById('resultsContainer');
        resultsContainer.style.display = 'block';
        
        // 调用后端API获取直接对比结果
        const response = await fetch(`/api/tasks/${currentTask.id}/direct-comparison`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '获取对比数据失败');
        }
        
        // 显示对比结果
        displayResults(data.results, data.statistics);
        
        // 更新任务状态
        currentTask.status = '已完成';
        currentTask.results = data.results;
        currentTask.statistics = data.statistics;
        document.getElementById('taskStatus').textContent = '已完成';
        
        showSuccess('对比数据加载完成！');
        
    } catch (error) {
        console.error('直接对比失败:', error);
        showError(error.message || '直接对比失败');
    } finally {
        // 恢复按钮状态
        const startBtn = document.getElementById('startEvaluationBtn');
        startBtn.disabled = false;
        startBtn.textContent = '查看现有评分';
    }
}

async function startEvaluation() {
    if (!currentTask) {
        showError('任务信息不存在');
        return;
    }
    
    // 获取选择的教师模型
    const teacherModelSelect = document.getElementById('teacherModelSelect');
    const teacherModel = teacherModelSelect ? teacherModelSelect.value : 'Deepseek';
    const agentReview = document.getElementById('agentReview')?.checked === true;
    
    // Files with existing scores can be reused; unscored files are always evaluated.
    const fileConfigs = {};
    if (currentTask.baseFile) fileConfigs.baseFile = {
        evaluate: document.getElementById('baseEvaluate')?.checked ?? true,
        name: currentTask.baseFile.name
    };
    fileConfigs.compareFile = {
        evaluate: document.getElementById('compareEvaluate')?.checked ?? true,
        name: currentTask.compareFile.name
    };
    if (currentTask.baseHasScore && currentTask.compareHasScore &&
        !fileConfigs.baseFile.evaluate && !fileConfigs.compareFile.evaluate) {
        await handleDirectComparison();
        return;
    }

    try {
        // 清除之前的评测记录
        const logContainer = document.getElementById('evaluationLog');
        if (logContainer) {
            logContainer.innerHTML = '';
            // 添加评测开始消息
            addLogMessage('🚀 开始评测...', logContainer);
            addLogMessage('📊 正在初始化进度监控...', logContainer);
        }
        
        // 隐藏结果区域
        const resultsContainer = document.getElementById('resultsContainer');
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
        
        // 禁用开始按钮，显示停止按钮
        const startBtn = document.getElementById('startEvaluationBtn');
        const stopBtn = document.getElementById('stopEvaluationBtn');
        startBtn.disabled = true;
        startBtn.textContent = '评测中...';
        if (stopBtn) {
            stopBtn.style.display = 'inline-block';
        }
        
        // 显示进度区域
        document.getElementById('progressContainer').style.display = 'block';
        
        // 添加开始评测的日志
        if (logContainer) {
            const startLogEntry = document.createElement('div');
            startLogEntry.className = 'log-entry text-info';
            startLogEntry.textContent = `[${new Date().toLocaleTimeString()}] 开始评测...`;
            logContainer.appendChild(startLogEntry);
        }
        
        // 发送评测请求
        const response = await fetch(`/api/tasks/${currentTask.id}/evaluate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fileConfigs, teacherModel, agentReview })
        });
        
        const data = await response.json();
        
        // 立即更新任务状态显示
        if (response.ok) {
            currentTask.status = '评测中';
            document.getElementById('taskStatus').textContent = '评测中';
        }
        
        if (!data.message) {
            throw new Error(data.error || '启动评测失败');
        }
        
        showSuccess('评测已启动');
        
    } catch (error) {
        console.error('启动评测失败:', error);
        showError(error.message || '启动评测失败');
        
        // 重新启用开始按钮，隐藏停止按钮
        const startBtn = document.getElementById('startEvaluationBtn');
        const stopBtn = document.getElementById('stopEvaluationBtn');
        startBtn.disabled = false;
        startBtn.textContent = '开始评测';
        if (stopBtn) {
            stopBtn.style.display = 'none';
        }
    }
}

// 停止评测
async function stopEvaluation() {
    if (!currentTask) {
        showError('任务信息不存在');
        return;
    }
    
    try {
        const response = await fetch(`/api/tasks/${currentTask.id}/stop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showSuccess('评测已停止');
            
            // 重新启用开始按钮，隐藏停止按钮
            const startBtn = document.getElementById('startEvaluationBtn');
            const stopBtn = document.getElementById('stopEvaluationBtn');
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.textContent = '开始评测';
            }
            if (stopBtn) {
                stopBtn.style.display = 'none';
            }
            
            // 添加停止日志
            const logContainer = document.getElementById('evaluationLog');
            if (logContainer) {
                addLogMessage('⏹️ 评测已被用户停止', logContainer, 'warning');
            }
        } else {
            throw new Error(data.error || '停止评测失败');
        }
        
    } catch (error) {
        console.error('停止评测失败:', error);
        showError(error.message || '停止评测失败');
    }
}

// 更新进度
function updateProgress(data) {
    const logContainer = document.getElementById('evaluationLog');
    
    if (!logContainer) {
        console.error('日志容器未找到');
        return;
    }
    
    // 优先显示Overall Progress（如果有的话）
    if (data.overallProgress !== undefined || (data.overallCurrent !== undefined && data.overallTotal !== undefined)) {
        const overallProgress = data.overallProgress || (data.overallTotal > 0 ? (data.overallCurrent / data.overallTotal) * 100 : 0);
        updateOverallProgressBar(overallProgress, logContainer, data.overallCurrent, data.overallTotal, data.overallSpeed);
    }
    
    // 显示tqdm风格的进度条在日志中
    if (data.file1Progress !== undefined || data.file2Progress !== undefined) {
        const file1Progress = data.file1Progress || 0;
        const file2Progress = data.file2Progress || 0;
        
        // 创建或更新file1进度条
        if (data.file1Progress !== undefined) {
            updateProgressBar('file1', file1Progress, logContainer, data.currentQuestion, data.totalQuestions);
        }
        
        // 创建或更新file2进度条
        if (data.file2Progress !== undefined) {
            updateProgressBar('file2', file2Progress, logContainer, data.currentQuestion, data.totalQuestions);
        }
    }
    
    // 处理文件完成事件
    if (data.fileCompleted && data.totalTime) {
        addLogMessage(`✅ ${data.fileCompleted} 评测完成！总耗时: ${data.totalTime.toFixed(2)}秒`, logContainer);
    }
    
    // 添加进度日志消息
    if (data.currentFile && data.currentQuestion && data.totalQuestions) {
        let message = `${data.currentFile}: 正在处理第 ${data.currentQuestion}/${data.totalQuestions} 个问题`;
        if (data.elapsedTime) {
            message += ` (已用时: ${data.elapsedTime.toFixed(1)}秒)`;
        }
        addLogMessage(message, logContainer);
    }
    
    // 处理其他消息
    if (data.message && !data.fileCompleted) {
        addLogMessage(data.message, logContainer);
    }
}

// 添加日志消息
function addLogMessage(message, logContainer, type = 'normal') {
    const logEntry = document.createElement('div');
    
    if (type === 'progress') {
        // 进度条消息使用特殊样式
        logEntry.className = 'log-entry progress-bar-entry';
        logEntry.textContent = message; // 不添加时间戳，保持原始进度条格式
    } else {
        logEntry.className = 'log-entry';
        
        // 检查是否是完成消息，添加特殊样式
        if (message.includes('✅') || message.includes('评测完成')) {
            logEntry.className += ' completion-message';
        }
        
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    }
    
    logContainer.appendChild(logEntry);
    
    // 滚动到底部
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // 保存日志到当前任务对象中
    if (currentTask) {
        currentTask.evaluationLog = logContainer.innerText;
        
        // 异步保存到服务器
        fetch(`/api/tasks/${currentTask.id}/save-log`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                evaluationLog: currentTask.evaluationLog
            })
        }).catch(error => {
            console.warn('保存日志失败:', error);
        });
    }
}

// 更新tqdm风格的进度条
// 专门处理Overall Progress的函数
function updateOverallProgressBar(progress, logContainer, currentQuestion = null, totalQuestions = null, speed = null) {
    const progressId = 'progress-overall';
    let progressElement = document.getElementById(progressId);
    
    if (!progressElement) {
        progressElement = document.createElement('div');
        progressElement.id = progressId;
        progressElement.className = 'log-entry progress-bar-entry';
        logContainer.appendChild(progressElement);
        
        // 初始化进度跟踪数据
        progressElement.startTime = Date.now();
        progressElement.lastUpdate = Date.now();
        progressElement.lastProgress = 0;
    }
    
    const currentTime = Date.now();
    const elapsed = (currentTime - progressElement.startTime) / 1000; // 秒
    
    // 计算实际进度
    let actualProgress, actualCurrent, actualTotal;
    if (currentQuestion !== null && totalQuestions !== null) {
        actualCurrent = currentQuestion;
        actualTotal = totalQuestions;
        actualProgress = totalQuestions > 0 ? (currentQuestion / totalQuestions) * 100 : 0;
    } else {
        actualProgress = progress;
        actualCurrent = Math.round((progress / 100) * (totalQuestions || 24));
        actualTotal = totalQuestions || 24;
    }
    
    // 创建tqdm风格的进度条 - 使用Unicode字符模拟终端显示
    const percentage = Math.round(actualProgress);
    const barLength = 20;
    const filledLength = Math.round((actualProgress / 100) * barLength);
    const bar = '█'.repeat(filledLength) + ' '.repeat(barLength - filledLength);
    
    // 计算处理速度 (questions/second)
    let calculatedSpeed = speed;
    if (!calculatedSpeed && elapsed > 0 && actualCurrent > 0) {
        calculatedSpeed = actualCurrent / elapsed;
    }
    
    // 估算剩余时间
    let eta = '?';
    if (calculatedSpeed && calculatedSpeed > 0 && actualTotal > actualCurrent) {
        const remaining = actualTotal - actualCurrent;
        const etaSeconds = remaining / calculatedSpeed;
        if (etaSeconds < 60) {
            eta = `${Math.round(etaSeconds).toString().padStart(2, '0')}`;
        } else {
            const minutes = Math.floor(etaSeconds / 60);
            const seconds = Math.round(etaSeconds % 60);
            eta = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    
    // 格式化速度显示
    const speedText = calculatedSpeed ? `${calculatedSpeed.toFixed(2)}s/question` : '?.??s/question';
    
    // 构建类似终端的Overall Progress显示
    const progressText = `Overall Progress: ${percentage.toString().padStart(3)}%|${bar}| ${actualCurrent}/${actualTotal} [${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toFixed(0).padStart(2, '0')}<${eta}, ${speedText}]`;
    
    progressElement.textContent = progressText;
    progressElement.lastUpdate = currentTime;
    progressElement.lastProgress = actualProgress;
    
    // 滚动到底部
    logContainer.scrollTop = logContainer.scrollHeight;
}

function updateProgressBar(fileName, progress, logContainer, currentQuestion = null, totalQuestions = null) {
    const progressId = `progress-${fileName}`;
    let progressElement = document.getElementById(progressId);
    
    if (!progressElement) {
        progressElement = document.createElement('div');
        progressElement.id = progressId;
        progressElement.className = 'log-entry progress-bar-entry';
        logContainer.appendChild(progressElement);
        
        // 初始化进度跟踪数据
        progressElement.startTime = Date.now();
        progressElement.lastUpdate = Date.now();
        progressElement.lastProgress = 0;
    }
    
    const currentTime = Date.now();
    const elapsed = (currentTime - progressElement.startTime) / 1000; // 秒
    
    // 计算实际进度
    let actualProgress, actualCurrent, actualTotal;
    if (currentQuestion !== null && totalQuestions !== null) {
        actualCurrent = currentQuestion;
        actualTotal = totalQuestions;
        actualProgress = totalQuestions > 0 ? (currentQuestion / totalQuestions) * 100 : 0;
    } else {
        actualProgress = progress;
        actualCurrent = Math.round((progress / 100) * (totalQuestions || 100));
        actualTotal = totalQuestions || 100;
    }
    
    // 创建tqdm风格的进度条
    const percentage = Math.round(actualProgress);
    const barLength = 20;
    const filledLength = Math.round((actualProgress / 100) * barLength);
    const bar = '█'.repeat(filledLength) + ' '.repeat(barLength - filledLength);
    
    // 计算处理速度 (questions/second)
    let speed = 0;
    if (elapsed > 0 && actualCurrent > 0) {
        speed = actualCurrent / elapsed;
    }
    
    // 估算剩余时间
    let eta = '?';
    if (speed > 0 && actualTotal > actualCurrent) {
        const remaining = actualTotal - actualCurrent;
        const etaSeconds = remaining / speed;
        if (etaSeconds < 60) {
            eta = `${Math.round(etaSeconds).toString().padStart(2, '0')}`;
        } else {
            const minutes = Math.floor(etaSeconds / 60);
            const seconds = Math.round(etaSeconds % 60);
            eta = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    
    // 格式化速度显示
    const speedText = speed > 0 ? `${speed.toFixed(2)}s/question` : '?.??s/question';
    
    // 构建tqdm风格的进度条文本
    const progressText = `${percentage.toString().padStart(3)}%|${bar}| ${actualCurrent}/${actualTotal} [${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toFixed(0).padStart(2, '0')}<${eta}, ${speedText}]`;
    
    progressElement.textContent = `${fileName}: ${progressText}`;
    progressElement.lastUpdate = currentTime;
    progressElement.lastProgress = actualProgress;
    
    // 滚动到底部
    logContainer.scrollTop = logContainer.scrollHeight;
}

// 处理评测完成
function handleEvaluationComplete(data) {
    if (data.taskId !== currentTask?.id) return;
    if (data.task) currentTask = data.task;
    
    const startBtn = document.getElementById('startEvaluationBtn');
    const stopBtn = document.getElementById('stopEvaluationBtn');
    startBtn.disabled = false;
    startBtn.textContent = '重新评测';
    if (stopBtn) {
        stopBtn.style.display = 'none';
    }
    
    // 显示完成消息
    const logContainer = document.getElementById('evaluationLog');
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry text-success';
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] 评测完成！`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // 确保进度容器保持显示
    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
        progressContainer.style.display = 'block';
    }
    
    // 显示结果区域
    if (data.results) {
        displayResults(data.results, data.statistics);
    } else {
        console.warn('⚠️ 没有接收到results数据');
    }
    
    showSuccess('评测完成！');
    
    // 保留进度条显示，添加完成标记
    const progressElements = document.querySelectorAll('.progress-bar-entry');
    progressElements.forEach(element => {
        // 为进度条添加完成状态样式
        element.classList.add('completed');
        element.style.opacity = '0.7';
    });
    
}

// 处理评测错误
function handleEvaluationError(data) {
    // 重新启用开始按钮，隐藏停止按钮
    const startBtn = document.getElementById('startEvaluationBtn');
    const stopBtn = document.getElementById('stopEvaluationBtn');
    startBtn.disabled = false;
    startBtn.textContent = '开始评测';
    if (stopBtn) {
        stopBtn.style.display = 'none';
    }
    
    const logContainer = document.getElementById('evaluationLog');
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry text-danger';
    // 修复undefined显示问题
    const errorMessage = data && data.message ? data.message : '未知错误';
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] 错误: ${errorMessage}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    showError(errorMessage);
}

// 显示评测结果
function displayResults(results, statistics) {
    const container = document.getElementById('resultsContent');
    document.getElementById('resultsContainer').style.display = 'block';
    container.replaceChildren();
    const base = results.find(result => result.type === 'base');
    const compare = results.find(result => result.type === 'compare');
    if (base && compare && statistics?.length === 2) {
        currentTask.statistics = statistics;
        container.appendChild(createNewComparisonLayout(base, compare, statistics));
    } else {
        for (const result of results) container.appendChild(createResultCard(result));
    }
    loadReviewQueue(results);
    loadAgentReviewQueue();
}

async function loadAgentReviewQueue() {
    const container = document.getElementById('agentReviewContainer');
    container.style.display = 'none';
    if (!currentTask?.run?.agentReview) return;
    try {
        const response = await fetch(`/api/tasks/${currentTask.id}/agent-review`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '无法读取 Agent 复核清单');
        document.getElementById('agentReviewSummary').textContent = `共 ${data.total} 题待人工复核；完整记录在详细 Excel 报告中。`;
        const tbody = document.getElementById('agentReviewRows');
        tbody.replaceChildren();
        for (const row of data.rows.slice(0, 50)) {
            const tr = document.createElement('tr');
            for (const value of [row.fileName, row.id, row.instruction, row.score,
                row.reviewScore ?? '—', row.reviewStatus, row.reviewReason]) {
                const td = document.createElement('td');
                td.textContent = value ?? '';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        container.style.display = 'block';
    } catch (error) {
        console.error('加载 Agent 复核清单失败:', error);
    }
}

async function loadReviewQueue(results) {
    const container = document.getElementById('reviewContainer');
    container.style.display = 'none';
    if (!currentTask || !results.some(result => result.type === 'base') ||
        !results.some(result => result.type === 'compare')) return;
    try {
        const response = await fetch(`/api/tasks/${currentTask.id}/review-queue`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '无法读取复核清单');
        document.getElementById('reviewSummary').textContent = `共 ${data.total} 题需要复核；完整理由可在详细 Excel 报告中查看。`;
        const tbody = document.getElementById('reviewRows');
        tbody.replaceChildren();
        for (const row of data.rows.slice(0, 50)) {
            const tr = document.createElement('tr');
            for (const value of [row.id, row.instruction, row.baseScore, row.compareScore,
                row.delta.toFixed(2), row.reviewReason]) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        container.style.display = 'block';
    } catch (error) {
        console.error('加载复核清单失败:', error);
    }
}

// 创建结果卡片
function createResultCard(result) {
    const card = document.createElement('div');
    card.className = 'card mb-3';
    
    const stats = result.statistics || {};
    const overall = stats.overall || {};
    
    const displayName = modelDisplayName(result.type, result);

    card.innerHTML = `
        <div class="card-header">
            <h6 class="mb-0">${escapeHtml(displayName)} (${result.type === 'base' ? 'Base模型' : '对比模型'})</h6>
        </div>
        <div class="card-body">
            <div class="row">
                <div class="col-md-3">
                    <div class="text-center">
                        <h4 class="text-primary">${overall.average_score?.toFixed(2) || '0.00'}</h4>
                        <small class="text-muted">平均分</small>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="text-center">
                        <h4 class="text-info">${overall.total_questions || 0}</h4>
                        <small class="text-muted">总题数</small>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="text-center">
                        <h4 class="text-success">${overall.max_score?.toFixed(2) || '0.00'}</h4>
                        <small class="text-muted">最高分</small>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="text-center">
                        <h4 class="text-warning">${overall.min_score?.toFixed(2) || '0.00'}</h4>
                        <small class="text-muted">最低分</small>
                    </div>
                </div>
            </div>
            <div class="mt-3">
                <button class="btn btn-outline-success btn-sm" onclick="exportDetailedReport()">
                    <i class="fas fa-file-excel"></i> 导出报告
                </button>
            </div>
        </div>
    `;
    
    return card;
}

// 创建新的三栏对比布局
function createNewComparisonLayout(baseResult, compareResult, statistics) {
    const container = document.createElement('div');
    container.className = 'comparison-layout';
    
    const baseStats = statistics[0];
    const compareStats = statistics[1];
    
    const baseModelName = modelDisplayName('base', baseResult);
    const compareModelName = modelDisplayName('compare', compareResult);

    container.innerHTML = `
        <div class="card mb-4 shadow-sm">
            <div class="card-header bg-gradient-primary text-white d-flex justify-content-between align-items-center">
                <h5 class="mb-0"><i class="fas fa-chart-line me-2"></i>模型对比分析</h5>
                <button class="btn btn-light btn-sm" onclick="exportDetailedReport()">
                    <i class="fas fa-file-excel"></i> 导出报告
                </button>
            </div>
            <div class="card-body p-4">
                <div class="row g-4">
                    <!-- 平均分栏 -->
                    <div class="col-md-4">
                        <div class="comparison-column overall-column" data-type="overall">
                            <div class="column-header">
                                <i class="fas fa-trophy text-warning"></i>
                                <h6 class="mb-0">平均分对比</h6>
                            </div>
                            <div class="score-comparison">
                                <div class="model-score base-model">
                                    <div class="model-badge base-badge">
                                        <i class="fas fa-robot"></i> ${escapeHtml(baseModelName)}
                                    </div>
                                    <div class="score-value base-score">${(baseStats.overall?.average_score || 0).toFixed(3)}</div>
                                    <div class="score-label">平均分</div>
                                </div>
                                <div class="vs-divider">
                                    <div class="vs-circle">
                                        <span>VS</span>
                                    </div>
                                </div>
                                <div class="model-score compare-model">
                                    <div class="model-badge compare-badge">
                                        <i class="fas fa-robot"></i> ${escapeHtml(compareModelName)}
                                    </div>
                                    <div class="score-value compare-score">${(compareStats.overall?.average_score || 0).toFixed(3)}</div>
                                    <div class="score-label">平均分</div>
                                </div>
                            </div>
                            <div class="score-difference text-center mt-3">
                                ${createScoreDifference(baseStats.overall?.average_score || 0, compareStats.overall?.average_score || 0)}
                            </div>
                            <button class="btn btn-outline-primary btn-sm w-100 mt-3 detail-btn" onclick="showDetailedRanking('overall')">
                                <i class="fas fa-list-ol"></i> 查看详细排名
                            </button>
                        </div>
                    </div>
                    
                    <!-- 父类栏 -->
                    <div class="col-md-4">
                        <div class="comparison-column parent-column" data-type="parent">
                            <div class="column-header">
                                <i class="fas fa-layer-group text-info"></i>
                                <h6 class="mb-0">父类对比</h6>
                            </div>
                            <div class="category-summary">
                                ${createParentClassSummary(baseStats, compareStats)}
                            </div>
                            <button class="btn btn-outline-info btn-sm w-100 mt-3 detail-btn" onclick="showDetailedRanking('parent')">
                                <i class="fas fa-list-ol"></i> 查看详细排名
                            </button>
                        </div>
                    </div>
                    
                    <!-- 子类栏 -->
                    <div class="col-md-4">
                        <div class="comparison-column subclass-column" data-type="subclass">
                            <div class="column-header">
                                <i class="fas fa-sitemap text-success"></i>
                                <h6 class="mb-0">子类对比</h6>
                            </div>
                            <div class="category-summary">
                                ${createSubClassSummary(baseStats, compareStats)}
                            </div>
                            <button class="btn btn-outline-success btn-sm w-100 mt-3 detail-btn" onclick="showDetailedRanking('subclass')">
                                <i class="fas fa-list-ol"></i> 查看详细排名
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- 详细排名展示区域 -->
                <div id="detailedRankingArea" class="mt-4" style="display: none;">
                    <div class="card border-0 shadow-sm">
                        <div class="card-header bg-light">
                            <h6 class="mb-0" id="rankingTitle"><i class="fas fa-chart-bar me-2"></i>详细排名</h6>
                        </div>
                        <div class="card-body" id="rankingContent">
                            <!-- 动态内容 -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    return container;
}

// 显示成功消息
function showSuccess(message) {
    showAlert(message, 'success');
}

// 显示错误消息
function showError(message) {
    showAlert(message, 'danger');
}

// 显示警告消息
function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) {
        return;
    }
    
    const alertId = 'alert-' + Date.now();
    const alertHtml = `
        <div id="${alertId}" class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
    
    alertContainer.insertAdjacentHTML('beforeend', alertHtml);
    
    // 3秒后自动关闭
    setTimeout(() => {
        const alertElement = document.getElementById(alertId);
        if (alertElement) {
            alertElement.remove();
        }
    }, 3000);
}
