// Socket.IO连接
const socket = io();

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

// 全局变量
let selectedFiles = {
    base: null,
    compare: null
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    try {
        initializeFileUpload();
        initializeForm();
        loadTasks();
        setupSocketListeners();
        setupSourceToggle();
    } catch (error) {
        console.error('初始化过程中发生错误:', error);
    }
});

// 初始化文件上传功能
function initializeFileUpload() {
    for (const key of ['base', 'compare']) {
        document.getElementById(`${key}File`).addEventListener('change', event => handleFileSelect(event, key));
    }
}

function setupSourceToggle() {
    for (const key of ['base', 'compare']) {
        document.querySelectorAll(`input[name="${key}Source"]`).forEach(radio => {
            radio.addEventListener('change', () => {
                const upload = radio.value === 'upload';
                document.getElementById(`${key}UploadArea`).style.display = upload ? 'block' : 'none';
                document.getElementById(`${key}SelectArea`).style.display = upload ? 'none' : 'block';
                removeFile(key);
            });
        });
    }
}

// 处理文件选择
function handleFileSelect(event, fileKey) {
    const file = event.target.files[0];
    if (!file) {
        selectedFiles[fileKey] = null;
        checkFormValidity();
        return;
    }

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
        selectedFiles[fileKey] = null;
        event.target.value = '';
        checkFormValidity();
        showAlert('请选择.xlsx格式的文件', 'warning');
        return;
    }

    selectedFiles[fileKey] = {
        type: 'upload',
        file: file,
        name: file.name
    };
    
    checkFormValidity();
}

// 更新已选择文件的显示
function updateSelectedFileDisplay(fileKey) {
    const selectedFileDiv = document.getElementById(`${fileKey}SelectedFile`);
    
    if (!selectedFileDiv) {
        return;
    }
    
    if (selectedFiles[fileKey] && selectedFiles[fileKey].type === 'select') {
        selectedFileDiv.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <i class="fas fa-file-excel text-success me-2"></i>
                    <strong>${escapeHtml(selectedFiles[fileKey].name)}</strong>
                    <small class="text-muted">(已完成评估)</small>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeFile('${fileKey}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    } else {
        selectedFileDiv.innerHTML = '<span class="text-muted">未选择</span>';
    }
}

// 移除文件
function removeFile(fileKey) {
    selectedFiles[fileKey] = null;
    
    // 清除文件输入
    const fileInput = document.getElementById(`${fileKey}File`);
    if (fileInput) {
        fileInput.value = '';
    }
    
    // 更新已选择文件显示
    updateSelectedFileDisplay(fileKey);
    
    checkFormValidity();
}

// 检查表单有效性
function checkFormValidity() {
    document.getElementById('submitBtn').disabled =
        !document.getElementById('taskName').value.trim() || !selectedFiles.compare;
}

function initializeForm() {
    document.getElementById('uploadForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('taskName').addEventListener('input', checkFormValidity);
    checkFormValidity();
}

// 处理表单提交
async function handleFormSubmit(event) {
    event.preventDefault();
    
    const taskName = document.getElementById('taskName').value.trim();
    const submitter = document.getElementById('submitter').value.trim();
    
    
    if (!selectedFiles.compare) {
        showAlert('请选择对比模型文件', 'warning');
        return;
    }
    
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>创建中...';
    
    try {
        const formData = new FormData();
        formData.append('taskName', taskName);
        formData.append('submitter', submitter);
        
        // 处理base模型
        if (selectedFiles.base) {
            if (selectedFiles.base.type === 'upload') {
                formData.append('baseFile', selectedFiles.base.file);
                formData.append('baseType', 'upload');
            } else {
                formData.append('baseFileId', selectedFiles.base.id);
                formData.append('baseType', 'select');
            }
        }
        
        // 处理对比模型
        if (selectedFiles.compare.type === 'upload') {
            formData.append('compareFile', selectedFiles.compare.file);
            formData.append('compareType', 'upload');
        } else {
            formData.append('compareFileId', selectedFiles.compare.id);
            formData.append('compareType', 'select');
        }
        
        const response = await fetch('/api/create-task', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            window.location.assign(`/evaluation.html?taskId=${encodeURIComponent(result.taskId)}`);
        } else {
            throw new Error(result.error || '创建任务失败');
        }
    } catch (error) {
        console.error('创建任务失败:', error);
        showAlert('创建任务失败: ' + error.message, 'danger');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-rocket me-2"></i>创建评测任务';
    }
}

// 显示提示信息
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alertDiv.textContent = message;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn-close';
    closeButton.setAttribute('data-bs-dismiss', 'alert');
    alertDiv.appendChild(closeButton);
    
    document.body.appendChild(alertDiv);
    
    // 3秒后自动移除
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

// 显示已完成文件页面
function selectCompletedFile(type) {
    // 打开已完成文件选择页面，并传递选择类型
    const url = `completed-files.html?mode=select&type=${type}`;
    window.open(url, '_blank');
}

// 从已完成文件页面接收选择的文件
window.addEventListener('message', function(event) {
    if (event.data.type === 'fileSelected') {
        const { fileType, fileData } = event.data;
        
        selectedFiles[fileType] = {
            type: 'select',
            id: fileData.id,
            name: fileData.name
        };
        
        updateSelectedFileDisplay(fileType);
        checkFormValidity();
        
        showAlert(`已选择${fileType === 'base' ? 'Base' : '对比'}模型文件: ${fileData.name}`, 'success');
    }
});

// 加载任务列表
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        const data = await response.json();
        
        // 服务器返回格式是 { tasks: [...] }
        const tasks = data.tasks || [];
        displayTasks(tasks);
    } catch (error) {
        console.error('加载任务失败:', error);
        showAlert('加载任务失败', 'danger');
    }
}

// 显示任务列表
function displayTasks(tasks) {
    const tbody = document.getElementById('tasksTableBody');
    const taskCount = document.getElementById('taskCount');
    
    taskCount.textContent = `${tasks.length} 个任务`;
    
    if (tasks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-muted py-4">
                    <i class="fas fa-inbox fa-2x mb-2"></i>
                    <br>暂无评测任务
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = tasks.map(task => `
        <tr data-task-id="${task.id}">
            <td>${escapeHtml(task.name)}</td>
            <td>${escapeHtml(task.submitter)}</td>
            <td>${new Date(task.submitTime).toLocaleString()}</td>
            <td><span class="badge task-status ${getStatusClass(task.status)}">${getStatusText(task.status)}</span></td>
            <td>
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-primary btn-enter-evaluation" onclick="enterEvaluation('${task.id}')" title="${task.status === '评测中' ? '查看评测进度' : '进入评测'}">
                        <i class="fas ${task.status === '评测中' ? 'fa-eye' : 'fa-play'}"></i> ${task.status === '评测中' ? '查看进度' : '进入评测'}
                    </button>
                    <button class="btn btn-outline-danger" onclick="deleteTask('${task.id}')" title="删除任务">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// 获取状态样式类
function getStatusClass(status) {
    const statusClasses = {
        'pending': 'bg-warning text-dark',
        '待评测': 'bg-warning text-dark',
        'running': 'bg-info text-white',
        '评测中': 'bg-info text-white',
        'completed': 'bg-success text-white',
        '已完成': 'bg-success text-white',
        'failed': 'bg-danger text-white',
        '评测失败': 'bg-danger text-white',
        '失败': 'bg-danger text-white'
    };
    return statusClasses[status] || 'bg-secondary text-white';
}

// 获取状态文本
function getStatusText(status) {
    const statusTexts = {
        'pending': '等待中',
        '待评测': '待评测',
        'running': '评测中',
        '评测中': '评测中',
        'completed': '已完成',
        '已完成': '已完成',
        'failed': '失败',
        '评测失败': '评测失败',
        '失败': '失败'
    };
    return statusTexts[status] || '未知';
}

// 进入评测页面
function enterEvaluation(taskId) {
    window.location.href = `evaluation.html?taskId=${taskId}`;
}

// 删除任务
async function deleteTask(taskId) {
    if (!confirm('确定要删除这个任务吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/tasks/${taskId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showAlert('任务删除成功', 'success');
            loadTasks();
        } else {
            throw new Error('删除失败');
        }
    } catch (error) {
        console.error('删除任务失败:', error);
        showAlert('删除任务失败', 'danger');
    }
}

// 更新特定任务的状态显示
function updateTaskStatus(taskId, newStatus) {
    const taskRow = document.querySelector(`tr[data-task-id="${taskId}"]`);
    if (taskRow) {
        const statusCell = taskRow.querySelector('.task-status');
        if (statusCell) {
            // 更新状态文本
            statusCell.textContent = getStatusText(newStatus);
            // 更新状态样式
            statusCell.className = 'task-status ' + getStatusClass(newStatus);
        }
        
        // 如果是评测中状态，禁用进入评测按钮
        const enterBtn = taskRow.querySelector('.btn-enter-evaluation');
        if (enterBtn) {
            if (newStatus === '评测中') {
                enterBtn.disabled = true;
                enterBtn.textContent = '评测中...';
            } else {
                enterBtn.disabled = false;
                enterBtn.textContent = '进入评测';
            }
        }
    }
}

// 设置Socket监听器
function setupSocketListeners() {
    socket.on('taskCreated', () => {
        loadTasks();
    });
    
    socket.on('taskUpdated', (data) => {
        // 如果是简单的状态更新（包含taskId和status），直接更新状态
        if (data.taskId && data.status) {
            updateTaskStatus(data.taskId, data.status);
        } else if (data.id && data.status) {
            // 如果是完整的task对象，提取taskId和status
            updateTaskStatus(data.id, data.status);
        }
        // 重新加载任务列表以确保数据同步
        loadTasks();
    });
    
    // 监听评测进度更新
    socket.on('evaluationProgress', (data) => {
        // 更新对应任务的状态显示
        updateTaskStatus(data.taskId, '评测中');
    });
    
    // 监听评测完成
    socket.on('evaluationComplete', (data) => {
        // 更新对应任务的状态显示
        updateTaskStatus(data.taskId, '已完成');
        // 重新加载任务列表以获取最新数据
        loadTasks();
    });
    
    // 监听评测错误
    socket.on('evaluationError', (data) => {
        // 更新对应任务的状态显示
        updateTaskStatus(data.taskId, '评测失败');
        loadTasks();
    });
}
