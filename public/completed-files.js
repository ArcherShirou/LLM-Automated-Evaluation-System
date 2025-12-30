// 全局变量
let completedFiles = [];
let filteredFiles = [];
let selectedFiles = [];
let selectionMode = false;
let selectionType = '';

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initializePage();
    loadCompletedFiles();
    setupEventListeners();
});

// 初始化页面
function initializePage() {
    // 检查URL参数，确定是否为选择模式
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const type = urlParams.get('type');
    
    if (mode === 'select' && type) {
        selectionMode = true;
        selectionType = type;
        
        // 显示选择模式提示
        const alert = document.getElementById('selectionModeAlert');
        const text = document.getElementById('selectionModeText');
        
        text.textContent = `请选择一个文件作为${type === 'base' ? 'Base' : '对比'}模型`;
        alert.style.display = 'block';
        
        // 隐藏批量操作按钮
        document.getElementById('batchDeleteBtn').style.display = 'none';
        document.querySelector('.btn-danger').style.display = 'none';
    }
}

// 设置事件监听器
function setupEventListeners() {
    // 全选复选框
    document.getElementById('selectAll').addEventListener('change', function() {
        const checkboxes = document.querySelectorAll('.file-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = this.checked;
        });
        updateSelectedCount();
    });
    
    // 筛选输入框
    document.getElementById('fileNameFilter').addEventListener('input', debounce(applyFilters, 300));
    document.getElementById('uploaderFilter').addEventListener('input', debounce(applyFilters, 300));
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 加载已完成文件列表
async function loadCompletedFiles() {
    try {
        const response = await fetch('/api/completed-files');
        const result = await response.json();
        
        if (response.ok) {
            completedFiles = result.files || [];
            filteredFiles = [...completedFiles];
            displayFiles(filteredFiles);
        } else {
            throw new Error(result.error || '加载文件失败');
        }
    } catch (error) {
        console.error('加载已完成文件失败:', error);
        showAlert('加载文件失败: ' + error.message, 'danger');
    }
}

// 显示文件列表
function displayFiles(files) {
    const tbody = document.getElementById('filesTableBody');
    const fileCount = document.getElementById('fileCount');
    
    fileCount.textContent = `${files.length} 个文件`;
    
    if (files.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-4">
                    <i class="fas fa-inbox fa-2x mb-2"></i>
                    <br>暂无已完成的评估文件
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = files.map(file => {

        
        return `
            <tr>
                <td>
                    <input type="checkbox" class="form-check-input file-checkbox" 
                           value="${file.id}" onchange="updateSelectedCount()">
                </td>
                <td>${file.id}</td>
                <td>
                    <i class="fas fa-file-excel text-success me-2"></i>
                    ${file.name}
                </td>
                <td>
                    <i class="fas fa-user me-1 text-muted"></i>
                    ${file.submitter || file.uploader || '未知'}
                </td>
                <td>
                    <small class="text-muted">
                        ${new Date(file.uploadTime).toLocaleString()}
                    </small>
                </td>
                <td>
                    <span class="badge bg-info">
                        ${formatFileSize(file.size || 0)}
                    </span>
                </td>
                <td>
                    <div class="btn-group btn-group-sm">
                        ${selectionMode ? 
                            `<button class="btn btn-outline-success" onclick="selectFile('${file.id}')" title="选择此文件">
                                <i class="fas fa-check"></i> 选择
                            </button>` :
                            `<button class="btn btn-outline-primary" onclick="downloadFile('${file.id}')" title="下载文件">
                                <i class="fas fa-download"></i>
                            </button>
                            <button class="btn btn-outline-danger" onclick="deleteFile('${file.id}')" title="删除文件">
                                <i class="fas fa-trash"></i>
                            </button>`
                        }
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 应用筛选
function applyFilters() {
    const fileNameFilter = document.getElementById('fileNameFilter').value.toLowerCase();
    const uploaderFilter = document.getElementById('uploaderFilter').value.toLowerCase();
    
    filteredFiles = completedFiles.filter(file => {
        const matchesFileName = !fileNameFilter || file.name.toLowerCase().includes(fileNameFilter);
        const matchesUploader = !uploaderFilter || file.uploader.toLowerCase().includes(uploaderFilter);
        return matchesFileName && matchesUploader;
    });
    
    displayFiles(filteredFiles);
    updateSelectedCount();
}

// 更新选中数量
function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.file-checkbox:checked');
    const count = checkboxes.length;
    
    const selectedCountBadge = document.getElementById('selectedCount');
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    
    if (count > 0) {
        selectedCountBadge.textContent = `已选择 ${count} 个`;
        selectedCountBadge.style.display = 'inline';
        
        if (!selectionMode) {
            batchDeleteBtn.disabled = false;
        }
    } else {
        selectedCountBadge.style.display = 'none';
        
        if (!selectionMode) {
            batchDeleteBtn.disabled = true;
        }
    }
    
    // 在选择模式下，只能选择一个文件
    if (selectionMode) {
        if (count === 1) {
            confirmBtn.disabled = false;
        } else {
            confirmBtn.disabled = true;
        }
        
        // 如果选择了多个，取消其他选择
        if (count > 1) {
            const allCheckboxes = document.querySelectorAll('.file-checkbox');
            const checkedBoxes = document.querySelectorAll('.file-checkbox:checked');
            
            // 保留最后一个选中的
            for (let i = 0; i < checkedBoxes.length - 1; i++) {
                checkedBoxes[i].checked = false;
            }
            
            // 递归调用以更新计数
            setTimeout(() => updateSelectedCount(), 0);
        }
    }
}

// 选择文件（选择模式）
function selectFile(fileId) {
    const file = completedFiles.find(f => f.id === fileId);
    if (!file) return;
    
    // 发送消息给父窗口
    if (window.opener) {
        window.opener.postMessage({
            type: 'fileSelected',
            fileType: selectionType,
            fileData: {
                id: file.id,
                name: file.name
            }
        }, '*');
        
        // 关闭当前窗口
        window.close();
    }
}

// 确认选择
function confirmSelection() {
    const checkedBoxes = document.querySelectorAll('.file-checkbox:checked');
    if (checkedBoxes.length !== 1) {
        showAlert('请选择一个文件', 'warning');
        return;
    }
    
    const fileId = checkedBoxes[0].value;
    selectFile(fileId);
}

// 取消选择
function cancelSelection() {
    if (window.opener) {
        window.close();
    } else {
        goBackToHome();
    }
}

// 返回首页
function goBackToHome() {
    window.location.href = '/';
}

// 批量删除
function batchDelete() {
    const checkedBoxes = document.querySelectorAll('.file-checkbox:checked');
    if (checkedBoxes.length === 0) {
        showAlert('请选择要删除的文件', 'warning');
        return;
    }
    
    const fileIds = Array.from(checkedBoxes).map(cb => cb.value);
    const fileNames = fileIds.map(id => {
        const file = completedFiles.find(f => f.id === id);
        return file ? file.name : id;
    });
    
    showDeleteModal(
        `确定要删除以下 ${fileIds.length} 个文件吗？\n\n${fileNames.join('\n')}\n\n此操作不可撤销。`,
        () => deleteFiles(fileIds)
    );
}

// 清空全部
function clearAll() {
    if (completedFiles.length === 0) {
        showAlert('没有文件可以清空', 'info');
        return;
    }
    
    showDeleteModal(
        `确定要删除全部 ${completedFiles.length} 个文件吗？此操作不可撤销。`,
        () => deleteFiles(completedFiles.map(f => f.id))
    );
}

// 删除单个文件
function deleteFile(fileId) {
    const file = completedFiles.find(f => f.id === fileId);
    if (!file) return;
    
    showDeleteModal(
        `确定要删除文件 "${file.name}" 吗？此操作不可撤销。`,
        () => deleteFiles([fileId])
    );
}

// 显示删除确认模态框
function showDeleteModal(message, onConfirm) {
    const modal = new bootstrap.Modal(document.getElementById('deleteModal'));
    const messageElement = document.getElementById('deleteMessage');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    messageElement.textContent = message;
    
    // 移除之前的事件监听器
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    // 添加新的事件监听器
    newConfirmBtn.addEventListener('click', () => {
        modal.hide();
        onConfirm();
    });
    
    modal.show();
}

// 删除文件
async function deleteFiles(fileIds) {
    try {
        const response = await fetch('/api/completed-files/batch-delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fileIds })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert(`成功删除 ${fileIds.length} 个文件`, 'success');
            loadCompletedFiles(); // 重新加载文件列表
        } else {
            throw new Error(result.error || '删除失败');
        }
    } catch (error) {
        console.error('删除文件失败:', error);
        showAlert('删除文件失败: ' + error.message, 'danger');
    }
}

// 下载文件
function downloadFile(fileId) {
    const file = completedFiles.find(f => f.id === fileId);
    if (!file) return;
    
    // 创建下载链接
    const link = document.createElement('a');
    link.href = `/api/completed-files/${fileId}/download`;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 刷新文件列表
function refreshFiles() {
    loadCompletedFiles();
    showAlert('文件列表已刷新', 'success');
}

// 显示提示信息
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    // 3秒后自动移除
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

// 显示成功模态框
function showSuccessModal(message) {
    const modal = new bootstrap.Modal(document.getElementById('successModal'));
    const messageElement = document.getElementById('successMessage');
    
    messageElement.textContent = message;
    modal.show();
}