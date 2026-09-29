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
    console.log('返回按钮元素:', backBtn);
    if (backBtn) {
        console.log('绑定返回按钮事件监听器');
        backBtn.addEventListener('click', (e) => {
            console.log('返回按钮被点击');
            e.preventDefault();
            window.location.href = '/';
        });
    } else {
        console.error('未找到返回按钮元素');
    }
}

// 设置Socket监听器
function setupSocketListeners() {
    console.log('设置Socket监听器');
    
    socket.on('connect', () => {
        console.log('Socket.IO连接成功');
    });
    
    socket.on('disconnect', () => {
        console.log('Socket.IO连接断开');
    });
    
    socket.on('evaluationProgress', (data) => {
        console.log('收到评测进度更新:', data);
        if (data.taskId === currentTask?.id) {
            updateProgress(data);
        }
    });
    
    socket.on('evaluationComplete', (data) => {
        console.log('收到评测完成事件:', data);
        handleEvaluationComplete(data);
        // 更新任务状态显示
        if (currentTask && data.task) {
            currentTask.status = data.task.status;
            document.getElementById('taskStatus').textContent = currentTask.status || '已完成';
        }
    });
    
    socket.on('evaluationError', (data) => {
        console.log('收到评测错误事件:', data);
        handleEvaluationError(data);
        // 更新任务状态显示
        if (currentTask) {
            currentTask.status = '评测失败';
            document.getElementById('taskStatus').textContent = '评测失败';
        }
    });
    
    socket.on('evaluationLog', (data) => {
        console.log('收到评测日志事件:', data);
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
        console.log('正在加载任务详情，taskId:', taskId);
        const response = await fetch(`/api/tasks/${taskId}`);
        console.log('API响应状态:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('API响应数据:', data);
        
        if (data.success) {
            currentTask = data.task;
            console.log('当前任务数据:', currentTask);
            displayTaskInfo(currentTask);
            setupFileConfiguration(currentTask);
            
            // 如果任务已完成，恢复评测结果和进度条
            if (currentTask.status === '已完成' && currentTask.results) {
                console.log('✅ 任务已完成，恢复评测结果');
                
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
                console.log('⏳ 任务正在评测中，恢复进度状态');
                
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
    console.log('显示任务信息:', task);
    console.log('submitter值:', task.submitter);
    
    document.getElementById('taskName').textContent = task.name || '未知任务';
    document.getElementById('submitter').textContent = task.submitter || '未知提交人';
    // 修复字段名不匹配问题，使用submitTime而不是createdAt
    const createTime = task.submitTime || task.createdAt;
    document.getElementById('createTime').textContent = createTime ? new Date(createTime).toLocaleString() : '未知时间';
    document.getElementById('taskStatus').textContent = task.status || '未知状态';
}

// 设置文件配置
async function setupFileConfiguration(task) {
    const fileConfigContainer = document.getElementById('fileConfigContainer');
    fileConfigContainer.innerHTML = '';
    
    // 检查两个文件是否都包含score列
    let baseHasScore = false;
    let compareHasScore = false;
    
    if (task.baseFile && task.compareFile) {
        try {
            // 检查base文件是否包含score列
            const baseCheckResponse = await fetch(`/api/tasks/${task.id}/check-score-column`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fileType: 'base' })
            });
            const baseCheckData = await baseCheckResponse.json();
            baseHasScore = baseCheckData.hasScore;
            
            // 检查compare文件是否包含score列
            const compareCheckResponse = await fetch(`/api/tasks/${task.id}/check-score-column`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fileType: 'compare' })
            });
            const compareCheckData = await compareCheckResponse.json();
            compareHasScore = compareCheckData.hasScore;
        } catch (error) {
            console.error('检查score列失败:', error);
        }
    }
    
    // 将score状态保存到currentTask中
    if (currentTask) {
        currentTask.baseHasScore = baseHasScore;
        currentTask.compareHasScore = compareHasScore;
    }
    
    // 如果两个文件都包含score列，显示直接对比选项
    if (baseHasScore && compareHasScore) {
        const directCompareCard = document.createElement('div');
        directCompareCard.className = 'card mb-3 border-success';
        directCompareCard.innerHTML = `
            <div class="card-header bg-success text-white">
                <h6 class="mb-0">🎉 检测到两个文件都包含评分数据</h6>
            </div>
            <div class="card-body">
                <div class="alert alert-success mb-3">
                    <strong>好消息！</strong> 两个文件都已包含评分数据，您可以选择：
                    <ul class="mb-0 mt-2">
                        <li>直接查看对比结果（推荐）</li>
                        <li>重新评测后再对比</li>
                    </ul>
                </div>
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="directCompare" checked>
                    <label class="form-check-label" for="directCompare">
                        <strong>直接对比现有评分数据</strong>
                    </label>
                    <small class="text-muted d-block">勾选此项将跳过评测过程，直接使用现有的评分数据进行对比分析</small>
                </div>
            </div>
        `;
        fileConfigContainer.appendChild(directCompareCard);
        
        // 添加直接对比选项的事件监听器
        const directCompareCheckbox = document.getElementById('directCompare');
        directCompareCheckbox.addEventListener('change', function() {
            const baseEvaluate = document.getElementById('baseEvaluate');
            const compareEvaluate = document.getElementById('compareEvaluate');
            
            if (this.checked) {
                // 直接对比模式：取消评测选项
                if (baseEvaluate) baseEvaluate.checked = false;
                if (compareEvaluate) compareEvaluate.checked = false;
                
                // 禁用评测选项
                if (baseEvaluate) baseEvaluate.disabled = true;
                if (compareEvaluate) compareEvaluate.disabled = true;
            } else {
                // 重新评测模式：启用评测选项
                if (baseEvaluate) {
                    baseEvaluate.disabled = false;
                    baseEvaluate.checked = true;
                }
                if (compareEvaluate) {
                    compareEvaluate.disabled = false;
                    compareEvaluate.checked = true;
                }
            }
        });
    }
    
    // Base文件配置
    if (task.baseFile) {
        const baseFileConfig = createFileConfigCard(task.baseFile, 'base', 'Base模型文件', baseHasScore);
        fileConfigContainer.appendChild(baseFileConfig);
    }
    
    // 对比文件配置
    if (task.compareFile) {
        const compareFileConfig = createFileConfigCard(task.compareFile, 'compare', '对比模型文件', compareHasScore);
        fileConfigContainer.appendChild(compareFileConfig);
    }
    
    // 如果两个文件都有score列且选择了直接对比，初始化禁用评测选项
    if (baseHasScore && compareHasScore) {
        const directCompareCheckbox = document.getElementById('directCompare');
        if (directCompareCheckbox && directCompareCheckbox.checked) {
            const baseEvaluate = document.getElementById('baseEvaluate');
            const compareEvaluate = document.getElementById('compareEvaluate');
            if (baseEvaluate) {
                baseEvaluate.checked = false;
                baseEvaluate.disabled = true;
            }
            if (compareEvaluate) {
                compareEvaluate.checked = false;
                compareEvaluate.disabled = true;
            }
        }
    }
}

// 创建文件配置卡片
function createFileConfigCard(file, type, title, hasScore = false) {
    const card = document.createElement('div');
    card.className = hasScore ? 'card mb-3 border-info' : 'card mb-3';
    
    const scoreIndicator = hasScore ? 
        '<span class="badge bg-success ms-2">✓ 包含评分数据</span>' : 
        '<span class="badge bg-secondary ms-2">无评分数据</span>';
    
    card.innerHTML = `
        <div class="card-header ${hasScore ? 'bg-light' : ''}">
            <h6 class="mb-0">${title}${scoreIndicator}</h6>
        </div>
        <div class="card-body">
            <div class="row">
                <div class="col-md-6">
                    <label class="form-label">原文件名</label>
                    <input type="text" class="form-control" value="${file.name}" readonly>
                </div>
                <div class="col-md-6">
                    <label class="form-label">模型名</label>
                    <input type="text" class="form-control" id="${type}FileName" value="${file.name}" placeholder="输入模型名称">
                </div>
            </div>
            <div class="row mt-3">
                <div class="col-md-12">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="${type}Evaluate" checked>
                        <label class="form-check-label" for="${type}Evaluate">
                            评测此文件
                        </label>
                    </div>
                    <small class="text-muted">${hasScore ? '文件已包含评分数据，重新评测将覆盖原分数' : '文件无评分数据，需要进行评测'}</small>
                </div>
            </div>
        </div>
    `;
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

// 创建整体排名
function createOverallRanking(baseStats, compareStats) {
    const baseScore = baseStats.overall?.average_score || 0;
    const compareScore = compareStats.overall?.average_score || 0;
    
    // 获取用户配置的模型名称
    let baseModelName = 'Base模型';
    let compareModelName = '对比模型';
    
    if (currentTask.fileConfigs && currentTask.fileConfigs.baseFile && currentTask.fileConfigs.baseFile.name && currentTask.fileConfigs.baseFile.name.trim()) {
        baseModelName = currentTask.fileConfigs.baseFile.name.trim();
    } else if (currentTask.results && currentTask.results[0] && currentTask.results[0].fileName) {
        baseModelName = currentTask.results[0].fileName.replace(/\.[^/.]+$/, "");
    }
    
    if (currentTask.fileConfigs && currentTask.fileConfigs.compareFile && currentTask.fileConfigs.compareFile.name && currentTask.fileConfigs.compareFile.name.trim()) {
        compareModelName = currentTask.fileConfigs.compareFile.name.trim();
    } else if (currentTask.results && currentTask.results[1] && currentTask.results[1].fileName) {
        compareModelName = currentTask.results[1].fileName.replace(/\.[^/.]+$/, "");
    }
    
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
                                <td>${model.name}</td>
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
    
    // 获取用户配置的模型名称
    let baseModelName = 'Base模型';
    let compareModelName = '对比模型';
    
    if (currentTask.fileConfigs && currentTask.fileConfigs.baseFile && currentTask.fileConfigs.baseFile.name && currentTask.fileConfigs.baseFile.name.trim()) {
        baseModelName = currentTask.fileConfigs.baseFile.name.trim();
    } else if (currentTask.results && currentTask.results[0] && currentTask.results[0].fileName) {
        baseModelName = currentTask.results[0].fileName.replace(/\.[^/.]+$/, "");
    }
    
    if (currentTask.fileConfigs && currentTask.fileConfigs.compareFile && currentTask.fileConfigs.compareFile.name && currentTask.fileConfigs.compareFile.name.trim()) {
        compareModelName = currentTask.fileConfigs.compareFile.name.trim();
    } else if (currentTask.results && currentTask.results[1] && currentTask.results[1].fileName) {
        compareModelName = currentTask.results[1].fileName.replace(/\.[^/.]+$/, "");
    }
    
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
                        <th>${baseModelName}</th>
                        <th>${compareModelName}</th>
                        <th>差异</th>
                    </tr>
                </thead>
                <tbody>
                    ${rankings.map((item, index) => {
                        const diffClass = item.diff > 0 ? 'text-success' : item.diff < 0 ? 'text-danger' : 'text-muted';
                        return `
                            <tr>
                                <td><strong>${index + 1}</strong></td>
                                <td>${item.category}</td>
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
                        <th>${(() => {
                            let baseModelName = 'Base模型';
                            if (currentTask.fileConfigs && currentTask.fileConfigs.baseFile && currentTask.fileConfigs.baseFile.name && currentTask.fileConfigs.baseFile.name.trim()) {
                                baseModelName = currentTask.fileConfigs.baseFile.name.trim();
                            } else if (currentTask.results && currentTask.results[0] && currentTask.results[0].fileName) {
                                baseModelName = currentTask.results[0].fileName.replace(/\.[^/.]+$/, "");
                            }
                            return baseModelName;
                        })()}</th>
                        <th>${(() => {
                            let compareModelName = '对比模型';
                            if (currentTask.fileConfigs && currentTask.fileConfigs.compareFile && currentTask.fileConfigs.compareFile.name && currentTask.fileConfigs.compareFile.name.trim()) {
                                compareModelName = currentTask.fileConfigs.compareFile.name.trim();
                            } else if (currentTask.results && currentTask.results[1] && currentTask.results[1].fileName) {
                                compareModelName = currentTask.results[1].fileName.replace(/\.[^/.]+$/, "");
                            }
                            return compareModelName;
                        })()}</th>
                        <th>差异</th>
                    </tr>
                </thead>
                <tbody>
                    ${rankings.map((item, index) => {
                        const diffClass = item.diff > 0 ? 'text-success' : item.diff < 0 ? 'text-danger' : 'text-muted';
                        return `
                            <tr>
                                <td><strong>${index + 1}</strong></td>
                                <td>${item.category}</td>
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

// 导出详细报告
// 一键导出全部文件
async function exportAllFiles() {
    if (!currentTask) {
        showError('当前没有可用的任务数据');
        return;
    }
    
    showSuccess('正在准备导出全部文件，请稍候...');
    
    try {
        // 1. 导出详细报告
        await exportDetailedReport();
        
        // 延迟一下，避免同时下载太多文件
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 2. 下载Base评分文件
        if (currentTask.baseFile) {
            downloadScoredFile('file1');
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // 3. 下载对比评分文件
        if (currentTask.compareFile) {
            downloadScoredFile('file2');
        }
        
        showSuccess('全部文件导出完成！请检查浏览器下载文件夹');
    } catch (error) {
        console.error('导出全部文件失败:', error);
        showError('导出全部文件失败: ' + error.message);
    }
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

// 下载评分文件
function downloadScoredFile(fileType) {
    if (!currentTask) {
        showError('当前没有可用的任务数据');
        return;
    }
    
    const downloadUrl = `/api/download/${currentTask.id}/${fileType}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        startBtn.textContent = '开始评测';
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
    
    // 收集文件配置
    const fileConfigs = {};
    
    // Base文件配置
    if (currentTask.baseFile) {
        const baseEvaluate = document.getElementById('baseEvaluate');
        const baseFileName = document.getElementById('baseFileName');
        
        if (baseEvaluate && baseFileName) {
            fileConfigs.baseFile = {
                evaluate: baseEvaluate.checked,
                name: baseFileName.value.trim() || currentTask.baseFile.name
            };
        }
    }
    
    // 对比文件配置
    if (currentTask.compareFile) {
        const compareEvaluate = document.getElementById('compareEvaluate');
        const compareFileName = document.getElementById('compareFileName');
        
        if (compareEvaluate && compareFileName) {
            fileConfigs.compareFile = {
                evaluate: compareEvaluate.checked,
                name: compareFileName.value.trim() || currentTask.compareFile.name
            };
        }
    }
    
    // 检查是否选择了直接对比模式
    const directCompareCheckbox = document.getElementById('directCompare');
    const isDirectCompare = directCompareCheckbox && directCompareCheckbox.checked;
    
    if (isDirectCompare) {
        // 直接对比模式：调用直接对比API
        await handleDirectComparison();
        return;
    }
    
    // 检查文件是否包含score字段
    let baseHasScore = false;
    let compareHasScore = false;
    
    if (currentTask.baseFile && currentTask.compareFile) {
        try {
            // 检查base文件是否包含score列
            const baseCheckResponse = await fetch(`/api/tasks/${currentTask.id}/check-score-column`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: currentTask.baseFile.path })
            });
            const baseCheckData = await baseCheckResponse.json();
            baseHasScore = baseCheckData.hasScore;
            
            // 检查compare文件是否包含score列
            const compareCheckResponse = await fetch(`/api/tasks/${currentTask.id}/check-score-column`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: currentTask.compareFile.path })
            });
            const compareCheckData = await compareCheckResponse.json();
            compareHasScore = compareCheckData.hasScore;
        } catch (error) {
            console.error('检查score列失败:', error);
        }
    }
    
    // 如果两个文件都有score字段，直接进行对比
    if (baseHasScore && compareHasScore) {
        console.log('两个文件都包含score字段，直接进行对比');
        await handleDirectComparison();
        return;
    }
    
    // 检查是否至少选择了一个需要评测的文件进行评测
    const hasFileToEvaluate = Object.values(fileConfigs).some(config => config.evaluate);
    if (!hasFileToEvaluate) {
        showError('请至少选择一个需要评测的文件进行评测');
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
    console.log('更新进度:', data);
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
    console.log('🎉 评测完成事件接收到的数据:', data);
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
        console.log('✅ 进度容器保持显示');
    }
    
    // 显示结果区域
    if (data.results) {
        console.log('📊 准备显示结果:', {
            results: data.results,
            statistics: data.statistics,
            statisticsType: typeof data.statistics,
            statisticsLength: data.statistics ? data.statistics.length : 'undefined'
        });
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
    
    console.log('✅ 评测完成处理结束，进度条数量:', progressElements.length);
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
    console.log('displayResults called with:', { results, statistics });
    
    const resultsContainer = document.getElementById('resultsContainer');
    resultsContainer.style.display = 'block';
    
    const resultsContent = document.getElementById('resultsContent');
    resultsContent.innerHTML = '';
    
    // 如果有base和compare文件，显示新的三栏对比布局
    const baseResult = results.find(r => r.type === 'base');
    const compareResult = results.find(r => r.type === 'compare');
    
    console.log('检查三栏布局条件:', {
        baseResult: !!baseResult,
        compareResult: !!compareResult,
        statistics: !!statistics,
        statisticsLength: statistics ? statistics.length : 0,
        baseResultData: baseResult,
        compareResultData: compareResult
    });
    
    // 检查文件是否有可用于对比的数据（评测结果数据或已有的score数据）
    const baseHasData = baseResult && (baseResult.data || (currentTask && currentTask.baseHasScore));
    const compareHasData = compareResult && (compareResult.data || (currentTask && currentTask.compareHasScore));
    
    console.log('检查数据可用性:', {
        baseHasData,
        compareHasData,
        baseResultData: baseResult ? !!baseResult.data : false,
        compareResultData: compareResult ? !!compareResult.data : false,
        baseHasScore: currentTask ? currentTask.baseHasScore : false,
        compareHasScore: currentTask ? currentTask.compareHasScore : false
    });
    
    // 如果有任何文件有可用数据且有统计数据，显示三栏对比布局
    if ((baseHasData || compareHasData) && statistics && statistics.length >= 1) {
        console.log('✅ 显示三栏对比布局', { baseResult, compareResult, statistics });
        const newComparisonCard = createNewComparisonLayout(baseResult, compareResult, statistics);
        resultsContent.appendChild(newComparisonCard);
        
        // 保存统计数据到全局变量以供其他函数使用
        if (currentTask) {
            currentTask.statistics = statistics;
        }
    } else {
        console.log('❌ 显示传统布局，原因:', {
            hasBaseResult: !!baseResult,
            hasCompareResult: !!compareResult,
            hasStatistics: !!statistics,
            statisticsLength: statistics ? statistics.length : 0,
            results,
            statistics
        });
        // 显示每个文件的结果（旧版本兼容）
        results.forEach(result => {
            const resultCard = createResultCard(result);
            resultsContent.appendChild(resultCard);
        });
        
        // 显示统计信息
        if (statistics) {
            const statsCard = createStatisticsCard(statistics);
            resultsContent.appendChild(statsCard);
        }
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
    
    const stats = result.statistics;
    const overall = stats.overall || {};
    
    // 检测并获取模型名称，优先使用用户配置的名称
    let displayName = result.type === 'base' ? 'Base模型' : '对比模型';
    
    // 检查是否有用户配置的模型名称
    if (currentTask && currentTask.fileConfigs) {
        if (result.type === 'base' && currentTask.fileConfigs.baseFile && currentTask.fileConfigs.baseFile.name && currentTask.fileConfigs.baseFile.name.trim()) {
            displayName = currentTask.fileConfigs.baseFile.name.trim();
        } else if (result.type === 'compare' && currentTask.fileConfigs.compareFile && currentTask.fileConfigs.compareFile.name && currentTask.fileConfigs.compareFile.name.trim()) {
            displayName = currentTask.fileConfigs.compareFile.name.trim();
        } else if (result.fileName) {
            // 如果没有用户配置的名称，使用文件名（去掉扩展名）
            displayName = result.fileName.replace(/\.[^/.]+$/, "");
        }
    } else if (result.fileName) {
        // 如果没有配置信息，使用文件名（去掉扩展名）
        displayName = result.fileName.replace(/\.[^/.]+$/, "");
    }
    
    card.innerHTML = `
        <div class="card-header">
            <h6 class="mb-0">${displayName} (${result.type === 'base' ? 'Base模型' : '对比模型'})</h6>
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
    
    // 检测并获取模型名称，优先使用用户配置的名称
    let baseModelName = 'Base模型';
    let compareModelName = '对比模型';
    
    // 检查是否有用户配置的模型名称
    if (currentTask.fileConfigs && currentTask.fileConfigs.baseFile && currentTask.fileConfigs.baseFile.name && currentTask.fileConfigs.baseFile.name.trim()) {
        baseModelName = currentTask.fileConfigs.baseFile.name.trim();
    } else if (baseResult.fileName) {
        // 如果没有用户配置的名称，使用文件名（去掉扩展名）
        baseModelName = baseResult.fileName.replace(/\.[^/.]+$/, "");
    }
    
    if (currentTask.fileConfigs && currentTask.fileConfigs.compareFile && currentTask.fileConfigs.compareFile.name && currentTask.fileConfigs.compareFile.name.trim()) {
        compareModelName = currentTask.fileConfigs.compareFile.name.trim();
    } else if (compareResult.fileName) {
        // 如果没有用户配置的名称，使用文件名（去掉扩展名）
        compareModelName = compareResult.fileName.replace(/\.[^/.]+$/, "");
    }
    
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
                                        <i class="fas fa-robot"></i> ${baseModelName}
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
                                        <i class="fas fa-robot"></i> ${compareModelName}
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

// 创建统计信息卡片（保留旧版本兼容）
function createStatisticsCard(statistics) {
    const card = document.createElement('div');
    card.className = 'card mb-3';
    
    // 检查是否有两个模型的统计数据
    const hasComparison = statistics && statistics.length === 2;
    
    if (!hasComparison) {
        card.innerHTML = `
            <div class="card-header">
                <h6 class="mb-0">整体统计</h6>
            </div>
            <div class="card-body">
                <p>需要两个模型的评测结果才能显示对比统计信息</p>
            </div>
        `;
        return card;
    }
    
    const baseStats = statistics[0];
    const compareStats = statistics[1];
    
    // 构建父类对比表格
    let parentClassTable = '';
    if (baseStats.by_parent_class && compareStats.by_parent_class) {
        const allParentClasses = new Set([
            ...Object.keys(baseStats.by_parent_class),
            ...Object.keys(compareStats.by_parent_class)
        ]);
        
        parentClassTable = `
            <h6 class="mt-4">父类对比</h6>
            <div class="table-responsive">
                <table class="table table-sm table-striped">
                    <thead>
                        <tr>
                            <th>父类</th>
                            <th>Base模型平均分</th>
                            <th>Compare模型平均分</th>
                            <th>差异</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        Array.from(allParentClasses).forEach(parentClass => {
            const baseAvg = baseStats.by_parent_class[parentClass]?.average_score || 0;
            const compareAvg = compareStats.by_parent_class[parentClass]?.average_score || 0;
            const diff = compareAvg - baseAvg;
            const diffClass = diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted';
            
            parentClassTable += `
                <tr>
                    <td>${parentClass}</td>
                    <td>${baseAvg.toFixed(3)}</td>
                    <td>${compareAvg.toFixed(3)}</td>
                    <td class="${diffClass}">${diff > 0 ? '+' : ''}${diff.toFixed(3)}</td>
                </tr>
            `;
        });
        
        parentClassTable += `
                    </tbody>
                </table>
            </div>
        `;
    }
    
    // 构建子类对比表格
    let subClassTable = '';
    if (baseStats.by_sub_class && compareStats.by_sub_class) {
        const allSubClasses = new Set([
            ...Object.keys(baseStats.by_sub_class),
            ...Object.keys(compareStats.by_sub_class)
        ]);
        
        subClassTable = `
            <h6 class="mt-4">子类对比</h6>
            <div class="table-responsive" style="max-height: 300px; overflow-y: auto;">
                <table class="table table-sm table-striped">
                    <thead>
                        <tr>
                            <th>子类</th>
                            <th>Base模型平均分</th>
                            <th>Compare模型平均分</th>
                            <th>差异</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        Array.from(allSubClasses).forEach(subClass => {
            const baseAvg = baseStats.by_sub_class[subClass]?.average_score || 0;
            const compareAvg = compareStats.by_sub_class[subClass]?.average_score || 0;
            const diff = compareAvg - baseAvg;
            const diffClass = diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted';
            
            subClassTable += `
                <tr>
                    <td>${subClass}</td>
                    <td>${baseAvg.toFixed(3)}</td>
                    <td>${compareAvg.toFixed(3)}</td>
                    <td class="${diffClass}">${diff > 0 ? '+' : ''}${diff.toFixed(3)}</td>
                </tr>
            `;
        });
        
        subClassTable += `
                    </tbody>
                </table>
            </div>
        `;
    }
    
    card.innerHTML = `
        <div class="card-header">
            <h6 class="mb-0">详细统计对比</h6>
        </div>
        <div class="card-body">
            <div class="row">
                <div class="col-md-6">
                    <h6>Base模型整体统计</h6>
                    <p>平均分: <strong>${baseStats.overall?.average_score?.toFixed(3) || '0.000'}</strong></p>
                    <p>最高分: <strong>${baseStats.overall?.max_score?.toFixed(3) || '0.000'}</strong></p>
                    <p>最低分: <strong>${baseStats.overall?.min_score?.toFixed(3) || '0.000'}</strong></p>
                    <p>题目总数: <strong>${baseStats.overall?.total_questions || 0}</strong></p>
                </div>
                <div class="col-md-6">
                    <h6>Compare模型整体统计</h6>
                    <p>平均分: <strong>${compareStats.overall?.average_score?.toFixed(3) || '0.000'}</strong></p>
                    <p>最高分: <strong>${compareStats.overall?.max_score?.toFixed(3) || '0.000'}</strong></p>
                    <p>最低分: <strong>${compareStats.overall?.min_score?.toFixed(3) || '0.000'}</strong></p>
                    <p>题目总数: <strong>${compareStats.overall?.total_questions || 0}</strong></p>
                </div>
            </div>
            ${parentClassTable}
            ${subClassTable}
        </div>
    `;
    
    return card;
}

// 创建对比卡片
// 旧的createComparisonCard函数已删除，现在使用createNewComparisonLayout函数

// 旧的generateComparisonReport函数已删除，现在使用新的导出功能

// 下载文件
// 获取URL中的任务ID
function getTaskIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('taskId');
}

// 下载功能已移除，统一使用导出报告功能

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
        console.log(`${type.toUpperCase()}: ${message}`);
        return;
    }
    
    const alertId = 'alert-' + Date.now();
    const alertHtml = `
        <div id="${alertId}" class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${message}
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

// 添加CSS样式
const style = document.createElement('style');
style.textContent = `
    .log-entry {
        padding: 2px 0;
        font-family: monospace;
        font-size: 0.9em;
    }
    
    .progress-bar-entry {
        padding: 4px 0;
        font-family: 'Courier New', monospace;
        font-size: 0.85em;
        color: #28a745;
        font-weight: bold;
        background-color: #f8f9fa;
        border-left: 3px solid #28a745;
        padding-left: 8px;
        margin: 2px 0;
        border-radius: 3px;
        transition: all 0.3s ease;
    }
    .progress-bar-entry.completed {
        background-color: #e8f5e8;
        border-left-color: #20c997;
        color: #20c997;
    }
    
    #evaluationLog {
        max-height: 300px;
        overflow-y: auto;
        background-color: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 0.375rem;
        padding: 10px;
        font-family: monospace;
    }
    
    .card-header h6 {
        color: #495057;
        font-weight: 600;
    }
    
    #alertContainer {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1050;
        max-width: 400px;
    }
    
    /* 新增样式：三栏对比布局 */
    .comparison-layout {
        margin-top: 20px;
    }

    .bg-gradient-primary {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .comparison-column {
        border: 1px solid #e8ecef;
        border-radius: 12px;
        padding: 20px;
        height: 100%;
        background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%);
        box-shadow: 0 2px 10px rgba(0,0,0,0.08);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .comparison-column:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(0,0,0,0.12);
    }

    .overall-column {
        border-left: 4px solid #ffc107;
    }

    .parent-column {
        border-left: 4px solid #17a2b8;
    }

    .subclass-column {
        border-left: 4px solid #28a745;
    }

    .column-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 20px;
        padding-bottom: 10px;
        border-bottom: 2px solid #f1f3f4;
    }

    .column-header i {
        font-size: 18px;
    }

    .column-header h6 {
        font-weight: 600;
        color: #2c3e50;
    }

    .score-comparison {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 20px 0;
    }

    .model-score {
        text-align: center;
        flex: 1;
        position: relative;
    }

    .model-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
    }

    .base-badge {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
    }

    .compare-badge {
        background: linear-gradient(135deg, #f093fb, #f5576c);
        color: white;
    }

    .model-name-display {
        margin-bottom: 8px;
    }

    .model-title {
        font-size: 12px;
        color: #495057;
        font-weight: 600;
        margin-bottom: 4px;
    }

    .model-name {
        font-size: 10px;
        color: #6c757d;
        word-break: break-all;
        font-weight: 400;
        background-color: rgba(0,0,0,0.05);
        padding: 2px 6px;
        border-radius: 4px;
        display: inline-block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .score-value {
        font-size: 28px;
        font-weight: 700;
        margin-bottom: 4px;
    }

    .base-score {
        background: linear-gradient(135deg, #667eea, #764ba2);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .compare-score {
        background: linear-gradient(135deg, #f093fb, #f5576c);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .score-label {
        font-size: 10px;
        color: #adb5bd;
        margin-top: 2px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .vs-divider {
        margin: 0 15px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .vs-circle {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: linear-gradient(135deg, #ff6b6b, #ee5a24);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 700;
        font-size: 12px;
        box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
        animation: pulse 2s infinite;
    }

    @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
    }
    
    .score-difference {
        padding: 10px 15px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        margin-top: 15px;
    }

    .score-difference.positive {
        background: linear-gradient(135deg, #d4edda, #c3e6cb);
        color: #155724;
        border: 1px solid #c3e6cb;
    }

    .score-difference.negative {
        background: linear-gradient(135deg, #f8d7da, #f5c6cb);
        color: #721c24;
        border: 1px solid #f5c6cb;
    }

    .score-difference.neutral {
        background: linear-gradient(135deg, #e2e3e5, #d6d8db);
        color: #383d41;
        border: 1px solid #d6d8db;
    }

    .detail-btn {
        border-radius: 8px;
        font-weight: 500;
        transition: all 0.2s ease;
    }

    .detail-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .category-summary {
        max-height: 300px;
        overflow-y: auto;
        padding-right: 5px;
    }

    .category-summary::-webkit-scrollbar {
        width: 4px;
    }

    .category-summary::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 2px;
    }

    .category-summary::-webkit-scrollbar-thumb {
        background: #c1c1c1;
        border-radius: 2px;
    }

    .category-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid #f1f3f4;
        transition: background-color 0.2s ease;
    }

    .category-item:hover {
        background-color: rgba(102, 126, 234, 0.05);
        border-radius: 6px;
        padding-left: 8px;
        padding-right: 8px;
    }

    .category-item:last-child {
        border-bottom: none;
    }

    .category-name {
        font-size: 11px;
        color: #495057;
        flex: 1;
        font-weight: 500;
    }

    .category-scores {
        display: flex;
        gap: 12px;
        font-size: 10px;
        font-weight: 600;
    }
    
    .summary-stats {
        display: flex;
        justify-content: space-around;
        margin: 15px 0;
    }
    
    .stat-item {
        text-align: center;
    }
    
    .stat-number {
        display: block;
        font-size: 1.5em;
        font-weight: bold;
    }
    
    .stat-label {
        font-size: 0.8em;
        display: block;
    }
    
    .ranking-table {
        max-height: 400px;
        overflow-y: auto;
        border-radius: 8px;
        border: 1px solid #e9ecef;
    }

    .ranking-table::-webkit-scrollbar {
        width: 6px;
    }

    .ranking-table::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 3px;
    }

    .ranking-table::-webkit-scrollbar-thumb {
        background: #c1c1c1;
        border-radius: 3px;
    }

    .ranking-table table {
        margin-bottom: 0;
        border-collapse: collapse;
    }

    .ranking-table th {
        position: sticky;
        top: 0;
        background: linear-gradient(135deg, #f8f9fa, #e9ecef);
        z-index: 10;
        font-weight: 600;
        padding: 12px 8px;
        text-align: center;
        border-bottom: 2px solid #dee2e6;
        color: #495057;
        font-size: 13px;
    }

    .ranking-table td {
        padding: 10px 8px;
        text-align: center;
        border-bottom: 1px solid #f1f3f4;
        transition: background-color 0.2s ease;
        font-size: 12px;
    }

    .ranking-table tr:hover td {
        background-color: rgba(102, 126, 234, 0.05);
    }

    .ranking-table .category-name {
        text-align: left;
        max-width: 200px;
        word-break: break-word;
        font-weight: 500;
    }
    
    /* 完成消息样式 */
    .completion-message {
        color: #28a745;
        font-weight: bold;
        background-color: #d4edda;
        border-left: 3px solid #28a745;
        padding-left: 8px;
        margin: 2px 0;
        border-radius: 3px;
    }
`;
document.head.appendChild(style);
