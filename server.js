const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs-extra');
const http = require('http');
const socketIo = require('socket.io');
const { spawn } = require('child_process');
// PDF相关库已删除，现在使用新的三栏对比布局
const ExcelJS = require('exceljs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 生成综合报告
function generateComprehensiveReport(req, res, task) {
  try {
    const file1ScoredPath = task.file1Path.replace('.xlsx', '_scored.xlsx');
    const file2ScoredPath = task.file2Path.replace('.xlsx', '_scored.xlsx');
    
    // 检查评测结果文件是否存在
    if (!fs.existsSync(file1ScoredPath) || !fs.existsSync(file2ScoredPath)) {
      return res.status(404).json({ error: '评测结果文件不存在' });
    }
    
    // 读取两个评测结果文件
    const file1Workbook = XLSX.readFile(file1ScoredPath, { codepage: 65001 });
  const file2Workbook = XLSX.readFile(file2ScoredPath, { codepage: 65001 });
    
    const file1SheetName = file1Workbook.SheetNames[0];
    const file2SheetName = file2Workbook.SheetNames[0];
    
    const file1Data = XLSX.utils.sheet_to_json(file1Workbook.Sheets[file1SheetName]);
    const file2Data = XLSX.utils.sheet_to_json(file2Workbook.Sheets[file2SheetName]);
    
    // 创建新的工作簿
    const comprehensiveWorkbook = XLSX.utils.book_new();
    
    // 添加文件1数据
    const file1DisplayName = task.fileConfig?.file1Name || '文件1';
    const file1Sheet = XLSX.utils.json_to_sheet(file1Data);
    XLSX.utils.book_append_sheet(comprehensiveWorkbook, file1Sheet, file1DisplayName);
    
    // 添加文件2数据
    const file2DisplayName = task.fileConfig?.file2Name || '文件2';
    const file2Sheet = XLSX.utils.json_to_sheet(file2Data);
    XLSX.utils.book_append_sheet(comprehensiveWorkbook, file2Sheet, file2DisplayName);
    
    // 添加模型输出记录（如果有的话）
    if (task.modelOutputs && task.modelOutputs.length > 0) {
      const modelOutputSheet = XLSX.utils.json_to_sheet(task.modelOutputs);
      XLSX.utils.book_append_sheet(comprehensiveWorkbook, modelOutputSheet, '模型输出记录');
    }
    
    // 生成临时文件
    const timestamp = Date.now();
    const comprehensiveFileName = `comprehensive_report_${timestamp}.xlsx`;
    const comprehensiveFilePath = path.join(uploadDir, comprehensiveFileName);
    
    // 写入文件
    XLSX.writeFile(comprehensiveWorkbook, comprehensiveFilePath);
    
    // 设置下载文件名
    const downloadFileName = `${file1DisplayName}_vs_${file2DisplayName}_综合报告.xlsx`;
    
    // 发送文件并在发送后删除临时文件
    res.download(comprehensiveFilePath, downloadFileName, (err) => {
      // 删除临时文件
      fs.unlink(comprehensiveFilePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('删除临时文件失败:', unlinkErr);
        }
      });
      
      if (err) {
        console.error('综合报告下载错误:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: '综合报告下载失败' });
        }
      }
    });
    
  } catch (error) {
    console.error('生成综合报告错误:', error);
    res.status(500).json({ error: '生成综合报告失败' });
  }
}

const PORT = process.env.PORT || 8000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 确保上传目录存在
const uploadDir = path.join(__dirname, 'uploads');
fs.ensureDirSync(uploadDir);

// 配置multer用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.xlsx') {
      cb(null, true);
    } else {
      cb(new Error('只允许上传.xlsx文件'));
    }
  }
});

// 内存中存储评测任务（实际项目中应使用数据库）
let evaluationTasks = [];

// 存储已完成评估文件
let completedFiles = [];

// 已完成文件存储目录
const completedFilesDir = path.join(__dirname, 'completed-files');
fs.ensureDirSync(completedFilesDir);

// 已完成文件列表的持久化文件
const completedFilesDataPath = path.join(__dirname, 'completed-files-data.json');

// 保存已完成文件列表到文件
function saveCompletedFiles() {
  try {
    fs.writeFileSync(completedFilesDataPath, JSON.stringify(completedFiles, null, 2));
    console.log('已完成文件列表已保存');
  } catch (error) {
    console.error('保存已完成文件列表失败:', error);
  }
}

// 从文件加载已完成文件列表
function loadCompletedFiles() {
  try {
    if (fs.existsSync(completedFilesDataPath)) {
      const data = fs.readFileSync(completedFilesDataPath, 'utf8');
      completedFiles = JSON.parse(data);
      // 验证文件是否仍然存在，移除不存在的文件
      completedFiles = completedFiles.filter(file => {
        if (fs.existsSync(file.filePath)) {
          return true;
        } else {
          console.log(`文件不存在，已从列表中移除: ${file.filePath}`);
          return false;
        }
      });
      console.log(`已加载 ${completedFiles.length} 个已完成文件`);
    }
  } catch (error) {
    console.error('加载已完成文件列表失败:', error);
    completedFiles = [];
  }
}

// 服务器启动时加载已完成文件列表
loadCompletedFiles();

// 验证Excel文件格式
function validateExcelFile(filePath) {
  try {
    const workbook = XLSX.readFile(filePath, { codepage: 65001 });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    if (data.length === 0) {
      return { valid: false, error: '文件为空' };
    }
    
    const requiredFields = ['id', 'instruction', 'reference', 'parent_class', 'subclass', 'model_ans', 'source'];
    const firstRow = data[0];
    const missingFields = requiredFields.filter(field => !(field in firstRow));
    
    if (missingFields.length > 0) {
      return { 
        valid: false, 
        error: `缺少必需字段: ${missingFields.join(', ')}` 
      };
    }
    
    return { 
      valid: true, 
      rowCount: data.length,
      data: data
    };
  } catch (error) {
    return { valid: false, error: '文件读取失败: ' + error.message };
  }
}

// API路由

// 上传并验证文件
app.post('/api/upload', upload.fields([{ name: 'file1' }, { name: 'file2' }]), (req, res) => {
  try {
    if (!req.files.file1 || !req.files.file2) {
      return res.status(400).json({ error: '请上传两个文件' });
    }
    
    const file1Path = req.files.file1[0].path;
    const file2Path = req.files.file2[0].path;
    
    const validation1 = validateExcelFile(file1Path);
    const validation2 = validateExcelFile(file2Path);
    
    if (!validation1.valid) {
      return res.status(400).json({ error: `文件1验证失败: ${validation1.error}` });
    }
    
    if (!validation2.valid) {
      return res.status(400).json({ error: `文件2验证失败: ${validation2.error}` });
    }
    
    if (validation1.rowCount !== validation2.rowCount) {
      return res.status(400).json({ 
        error: `两个文件行数不一致: 文件1有${validation1.rowCount}行，文件2有${validation2.rowCount}行` 
      });
    }
    
    res.json({
      success: true,
      message: '文件验证成功',
      file1: {
        filename: req.files.file1[0].filename,
        rowCount: validation1.rowCount
      },
      file2: {
        filename: req.files.file2[0].filename,
        rowCount: validation2.rowCount
      },
      file1Path: req.files.file1[0].filename,
      file2Path: req.files.file2[0].filename,
      sessionId: uuidv4()
    });
  } catch (error) {
    res.status(500).json({ error: '服务器错误: ' + error.message });
  }
});

// 创建评测任务
app.post('/api/create-task', upload.fields([
  { name: 'baseFile', maxCount: 1 },
  { name: 'compareFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const { taskName, submitter, baseType, compareType, baseFileId, compareFileId } = req.body;
    
    if (!taskName || !submitter || !compareType) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    let baseFilePath = null;
    let baseFileName = null;
    let compareFilePath = null;
    let compareFileName = null;
    
    // 处理base模型文件
    if (baseType === 'upload' && req.files.baseFile) {
      const baseFile = req.files.baseFile[0];
      baseFilePath = baseFile.path;
      baseFileName = baseFile.originalname;
      
      // 验证文件格式
      const baseValidation = validateExcelFile(baseFilePath);
      if (!baseValidation.valid) {
        return res.status(400).json({ error: `Base文件格式错误: ${baseValidation.error}` });
      }
    } else if (baseType === 'select' && baseFileId) {
      const completedFile = completedFiles.find(f => f.id === baseFileId);
      if (!completedFile) {
        return res.status(404).json({ error: 'Base文件不存在' });
      }
      baseFilePath = completedFile.filePath;
      baseFileName = completedFile.name;
    }
    
    // 处理对比模型文件
    if (compareType === 'upload' && req.files.compareFile) {
      const compareFile = req.files.compareFile[0];
      compareFilePath = compareFile.path;
      compareFileName = compareFile.originalname;
      
      // 验证文件格式
      const compareValidation = validateExcelFile(compareFilePath);
      if (!compareValidation.valid) {
        return res.status(400).json({ error: `对比文件格式错误: ${compareValidation.error}` });
      }
    } else if (compareType === 'select' && compareFileId) {
      const completedFile = completedFiles.find(f => f.id === compareFileId);
      if (!completedFile) {
        return res.status(404).json({ error: '对比文件不存在' });
      }
      compareFilePath = completedFile.filePath;
      compareFileName = completedFile.name;
    } else {
      return res.status(400).json({ error: '必须提供对比模型文件' });
    }
    
    const taskId = uuidv4();
    const task = {
      id: taskId,
      name: taskName,
      submitter: submitter,
      submitTime: new Date().toISOString(),
      status: '待评测',
      baseFile: baseFilePath ? {
        path: baseFilePath,
        name: baseFileName,
        type: baseType
      } : null,
      compareFile: {
        path: compareFilePath,
        name: compareFileName,
        type: compareType
      }
    };
    
    evaluationTasks.push(task);
    
    // 通知所有连接的客户端有新任务
    io.emit('taskCreated', task);
    
    res.json({ success: true, taskId: taskId, task: task });
  } catch (error) {
    res.status(500).json({ error: '创建任务失败: ' + error.message });
  }
});

// 获取所有评测任务
app.get('/api/tasks', (req, res) => {
  res.json({ tasks: evaluationTasks });
});

// 获取已完成文件列表
app.get('/api/completed-files', (req, res) => {
  // 将submitter字段映射为uploader字段，以保持前端兼容性
  // 同时为没有size字段的文件动态计算文件大小
  const filesWithUploader = completedFiles.map(file => {
    let fileSize = file.size || 0;
    
    // 如果文件没有size字段，尝试从文件系统获取
    if (!file.size && file.filePath && fs.existsSync(file.filePath)) {
      try {
        const stats = fs.statSync(file.filePath);
        fileSize = stats.size;
      } catch (error) {
        console.error(`获取文件大小失败 ${file.filePath}: ${error.message}`);
      }
    }
    
    return {
      ...file,
      uploader: file.submitter || file.uploader || '未知',
      size: fileSize
    };
  });
  res.json({ success: true, files: filesWithUploader });
});

// 批量删除已完成文件
app.delete('/api/completed-files/batch-delete', async (req, res) => {
  try {
    const { fileIds } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds)) {
      return res.status(400).json({ error: '无效的文件ID列表' });
    }
    
    let deletedCount = 0;
    
    for (const fileId of fileIds) {
      const fileIndex = completedFiles.findIndex(f => f.id === fileId);
      if (fileIndex !== -1) {
        const file = completedFiles[fileIndex];
        
        // 删除物理文件
        try {
          if (fs.existsSync(file.filePath)) {
            await fs.unlink(file.filePath);
          }
        } catch (error) {
          console.error(`删除文件失败: ${file.filePath}`, error);
        }
        
        // 从列表中移除
        completedFiles.splice(fileIndex, 1);
        deletedCount++;
      }
    }
    
    // 保存已完成文件列表
    saveCompletedFiles();
    
    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('批量删除文件失败:', error);
    res.status(500).json({ error: '批量删除文件失败' });
  }
});

// 下载已完成文件
app.get('/api/completed-files/:fileId/download', (req, res) => {
  try {
    const { fileId } = req.params;
    const file = completedFiles.find(f => f.id === fileId);
    
    if (!file) {
      return res.status(404).json({ error: '文件不存在' });
    }
    
    if (!fs.existsSync(file.filePath)) {
      return res.status(404).json({ error: '文件已被删除' });
    }
    
    res.download(file.filePath, file.name);
   } catch (error) {
     console.error('下载文件失败:', error);
     res.status(500).json({ error: '下载文件失败' });
   }
 });

// 获取特定任务详情
app.get('/api/tasks/:taskId', (req, res) => {
  const task = evaluationTasks.find(t => t.id === req.params.taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  res.json({ success: true, task: task });
});

// 导出详细报告
app.get('/api/tasks/:taskId/detailed-report', async (req, res) => {
  const taskId = req.params.taskId;
  const task = evaluationTasks.find(t => t.id === taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务未找到' });
  }
  
  if (task.status !== '已完成' || !task.results || task.results.length !== 2) {
    return res.status(400).json({ error: '任务未完成或缺少对比数据' });
  }
  
  try {
    const excelBuffer = await generateDetailedExcelReport(task);
    const fileName = `detailed_comparison_report_${taskId}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(excelBuffer);
  } catch (error) {
    console.error('生成详细报告失败:', error);
    res.status(500).json({ error: '生成详细报告失败: ' + error.message });
  }
});

// 删除评测任务
app.delete('/api/tasks/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const taskIndex = evaluationTasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  const task = evaluationTasks[taskIndex];
  
  // 检查任务状态，只有待评测和已完成的任务可以删除
  if (task.status === '评测中') {
    return res.status(400).json({ error: '正在评测中的任务不能删除' });
  }
  
  // 删除任务
  evaluationTasks.splice(taskIndex, 1);
  
  // 通知所有连接的客户端任务已删除
  io.emit('taskDeleted', { taskId: taskId });
  
  res.json({ message: '任务删除成功' });
});

// 启动评测
app.post('/api/tasks/:taskId/evaluate', async (req, res) => {
  const taskId = req.params.taskId;
  const { fileConfigs, teacherModel } = req.body; // 文件配置信息和教师模型
  const task = evaluationTasks.find(t => t.id === taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  if (task.status === '评测中') {
    return res.status(400).json({ error: '任务已在评测中' });
  }
  
  // 更新任务状态
  task.status = '评测中';
  task.startTime = new Date().toISOString();
  task.fileConfigs = fileConfigs;
  task.file1Progress = 0;
  task.file2Progress = 0;
  task.file1Results = null;
  task.file2Results = null;
  
  // 准备评测文件列表
  const filesToEvaluate = [];
  
  // 处理base文件
  if (task.baseFile && fileConfigs && fileConfigs.baseFile && fileConfigs.baseFile.evaluate) {
    filesToEvaluate.push({
      path: task.baseFile.path,
      name: fileConfigs.baseFile.name || task.baseFile.name,
      type: 'base'
    });
  }
  
  // 处理对比文件
  if (task.compareFile && fileConfigs && fileConfigs.compareFile && fileConfigs.compareFile.evaluate) {
    filesToEvaluate.push({
      path: task.compareFile.path,
      name: fileConfigs.compareFile.name || task.compareFile.name,
      type: 'compare'
    });
  }
  
  if (filesToEvaluate.length === 0) {
    task.status = '已完成';
    task.completedTime = new Date().toISOString();
    io.emit('evaluationComplete', { taskId, task, message: '没有选择要评测的文件' });
    return res.json({ message: '没有选择要评测的文件', taskId: taskId });
  }
  
  // 启动评测进程
  startEvaluationProcess(task, filesToEvaluate, teacherModel || 'Deepseek');
  
  // 发送Socket事件通知前端更新任务状态
  io.emit('taskUpdated', { taskId, status: '评测中' });
  
  res.json({ message: '评测已启动', taskId: taskId });
});

// 直接对比已有评分数据
app.post('/api/tasks/:taskId/check-score-column', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { fileType } = req.body;
    
    // 查找任务
    const task = evaluationTasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }
    
    // 根据fileType获取对应的文件路径
    let filePath;
    if (fileType === 'base') {
      filePath = task.baseFile?.path;
    } else if (fileType === 'compare') {
      filePath = task.compareFile?.path;
    } else {
      return res.status(400).json({ error: '无效的文件类型' });
    }
    
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(400).json({ error: '文件不存在' });
    }
    
    // 使用readExcelFile函数读取Excel文件，优先选择"评分数据"工作表
    const data = readExcelFile(filePath);
    
    // 检查是否包含score列
    const hasScore = data && data.length > 0 && data[0].hasOwnProperty('score');
    
    res.json({ hasScore });
    
  } catch (error) {
    console.error('检查score列失败:', error);
    res.status(500).json({ error: '检查score列失败: ' + error.message });
  }
});

app.post('/api/tasks/:taskId/direct-comparison', async (req, res) => {
  const taskId = req.params.taskId;
  const task = evaluationTasks.find(t => t.id === taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  try {
    // 检查两个文件是否都存在且包含score列
    if (!task.baseFile || !task.compareFile) {
      return res.status(400).json({ error: '需要选择两个文件进行对比' });
    }
    
    // 读取base文件数据
    const baseData = readExcelFile(task.baseFile.path);
    
    // 读取compare文件数据
    const compareData = readExcelFile(task.compareFile.path);
    
    // 检查是否都包含score列
    const baseHasScore = baseData.length > 0 && baseData[0].hasOwnProperty('score');
    const compareHasScore = compareData.length > 0 && compareData[0].hasOwnProperty('score');
    
    if (!baseHasScore || !compareHasScore) {
      return res.status(400).json({ error: '两个文件都必须包含score列才能进行直接对比' });
    }
    
    // 计算统计数据
    const baseStats = calculateDetailedStats(baseData);
    const compareStats = calculateDetailedStats(compareData);
    
    // 构建结果数据
    const results = [
      {
        type: 'base',
        name: task.baseFile.name,
        data: baseData,
        statistics: baseStats
      },
      {
        type: 'compare', 
        name: task.compareFile.name,
        data: compareData,
        statistics: compareStats
      }
    ];
    
    const statistics = [baseStats, compareStats];
    
    // 更新任务状态
    task.status = '已完成';
    task.completedTime = new Date().toISOString();
    task.results = results;
    task.statistics = statistics;
    
    // 通知前端
    io.emit('evaluationComplete', {
      taskId,
      task,
      results,
      statistics,
      message: '直接对比完成'
    });
    
    res.json({
      message: '直接对比完成',
      results,
      statistics
    });
    
  } catch (error) {
    console.error('直接对比失败:', error);
    res.status(500).json({ error: '直接对比失败: ' + error.message });
  }
});

// 获取评测进度
app.get('/api/tasks/:taskId/progress', (req, res) => {
  const taskId = req.params.taskId;
  const task = evaluationTasks.find(t => t.id === taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  res.json({
    taskId: taskId,
    status: task.status,
    file1Progress: task.file1Progress || 0,
    file2Progress: task.file2Progress || 0,
    file1Results: task.file1Results,
    file2Results: task.file2Results
  });
});

// 保存评测日志
app.post('/api/tasks/:taskId/save-log', (req, res) => {
  const taskId = req.params.taskId;
  const { evaluationLog } = req.body;
  const task = evaluationTasks.find(t => t.id === taskId);
  
  if (!task) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  
  task.evaluationLog = evaluationLog;
  res.json({ success: true });
});

// 停止评测
app.post('/api/tasks/:taskId/stop', (req, res) => {
  const taskId = req.params.taskId;
  const task = evaluationTasks.find(t => t.id === taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  if (task.status !== '评测中') {
    return res.status(400).json({ error: '任务未在评测中' });
  }
  
  // 获取并终止Python进程
  const pythonProcess = evaluationProcesses.get(taskId);
  if (pythonProcess) {
    try {
      // 强制终止进程
      pythonProcess.kill('SIGTERM');
      
      // 如果SIGTERM无效，使用SIGKILL
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill('SIGKILL');
        }
      }, 5000);
      
      console.log(`强制停止评测任务: ${taskId}`);
    } catch (error) {
      console.error('停止进程时出错:', error);
    }
    
    // 清理进程引用
    evaluationProcesses.delete(taskId);
  }
  
  // 更新任务状态
  task.status = '已停止';
  task.stoppedTime = new Date().toISOString();
  
  // 通知前端评测已停止
  io.emit('evaluationStopped', {
    taskId: taskId,
    message: '评测已被用户停止'
  });
  
  // 通知首页任务状态更新
  io.emit('taskUpdated', task);
  
  res.json({ message: '评测已停止', taskId: taskId });
});

// 评测进程管理
const evaluationProcesses = new Map();

function startEvaluationProcess(task, filesToEvaluate, teacherModel = 'Deepseek') {
  const processId = task.id;
  
  // 调用Python评测服务
  callPythonEvaluationService(task, filesToEvaluate, teacherModel);
}

async function callPythonEvaluationService(task, filesToEvaluate, teacherModel = 'Deepseek') {
  try {
    // 准备Python评测进程参数
    const args = [teacherModel]; // 教师模型参数作为第一个参数
    
    // 添加要评测的文件路径和名称
    filesToEvaluate.forEach(file => {
      args.push(file.path);
      args.push(file.name);
      args.push(file.type);
    });
    
    // 启动Python评测进程
    const pythonProcess = spawn('python', ['eval_service.py', ...args], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      }
    });
    
    // 处理Python进程输出
    pythonProcess.stdout.on('data', (data) => {
      const lines = data.toString('utf8').split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        try {
          const result = JSON.parse(line);
          
          if (result.type === 'progress') {
            if (result.file === 'file1') {
              task.file1Progress = result.progress;
            } else if (result.file === 'file2') {
              task.file2Progress = result.progress;
            }
            
            // 计算总体进度
            const totalFiles = filesToEvaluate.length;
            const file1Progress = task.file1Progress || 0;
            const file2Progress = task.file2Progress || 0;
            const overallProgress = totalFiles > 0 ? (file1Progress + file2Progress) / totalFiles : 0;
            
            // 计算总体当前和总计问题数
            let overallCurrent = 0;
            let overallTotal = 0;
            if (result.current && result.total) {
              // 假设每个文件有相同数量的问题
              const questionsPerFile = result.total;
              overallTotal = totalFiles * questionsPerFile;
              
              // 计算当前完成的总问题数
              const file1Completed = Math.round((file1Progress / 100) * questionsPerFile);
              const file2Completed = Math.round((file2Progress / 100) * questionsPerFile);
              overallCurrent = file1Completed + file2Completed;
            }
            
            // 发送进度更新
            const progressData = {
              taskId: task.id,
              file1Progress: file1Progress,
              file2Progress: file2Progress,
              overallProgress: overallProgress,
              overallCurrent: overallCurrent,
              overallTotal: overallTotal
            };
            
            // 如果有模型输出，添加到进度数据中
            if (result.modelOutput) {
              progressData.modelOutput = result.modelOutput;
              
              // 保存模型输出记录到任务对象
              if (!task.modelOutputs) {
                task.modelOutputs = [];
              }
              task.modelOutputs.push({
                timestamp: new Date().toISOString(),
                file: result.file || 'unknown',
                output: result.modelOutput
              });
            }
            
            // 添加耗时信息
            if (result.elapsed_time) {
              progressData.elapsedTime = result.elapsed_time;
            }
            
            // 添加当前处理的问题信息
            if (result.current) {
              progressData.currentQuestion = result.current;
            }
            
            if (result.total) {
              progressData.totalQuestions = result.total;
            }
            
            io.emit('evaluationProgress', progressData);
          } else if (result.type === 'file_completed') {
            // 处理文件完成事件
            io.emit('evaluationProgress', {
              taskId: task.id,
              file1Progress: task.file1Progress || 0,
              file2Progress: task.file2Progress || 0,
              fileCompleted: result.file,
              totalTime: result.total_time,
              message: result.message
            });
          } else if (result.type === 'complete') {
            // 评测完成
            task.status = '已完成';
            task.completedTime = new Date().toISOString();
            task.results = result.results;
            
            // 从results中提取statistics并构建全局statistics数组
            if (result.results && Array.isArray(result.results)) {
              task.statistics = result.results.map(res => res.statistics).filter(stat => stat);
            } else {
              task.statistics = result.statistics || [];
            }
            
            // 处理base文件不参与评测的情况
            // 如果base文件存在但没有参与评测，尝试从base文件读取已有的score数据
            if (task.baseFile && task.fileConfigs && task.fileConfigs.baseFile && !task.fileConfigs.baseFile.evaluate) {
              try {
                console.log('Base文件未参与评测，尝试读取已有分数数据...');
                const baseData = readExcelFile(task.baseFile.path);
                
                // 检查是否有score列
                if (baseData && baseData.length > 0 && baseData[0].hasOwnProperty('score')) {
                  console.log('发现base文件包含score列，生成统计数据...');
                  
                  // 计算base文件的统计数据
                  const baseStats = calculateDetailedStats(baseData);
                  
                  // 创建base文件的结果对象
                  const baseResult = {
                    fileName: task.fileConfigs.baseFile.name || task.baseFile.name,
                    type: 'base',
                    statistics: baseStats,
                    outputPath: task.baseFile.path, // 使用原始文件路径
                    totalQuestions: baseData.length,
                    averageScore: baseStats.averageScore
                  };
                  
                  // 将base结果添加到results数组的开头
                  if (!task.results) {
                    task.results = [];
                  }
                  task.results.unshift(baseResult);
                  
                  // 将base统计数据添加到statistics数组的开头
                  if (!task.statistics) {
                    task.statistics = [];
                  }
                  task.statistics.unshift(baseStats);
                  
                  console.log('Base文件统计数据已生成并添加到结果中');
                } else {
                  console.log('Base文件不包含score列，生成基础统计数据以支持三栏布局...');
                  
                  // 即使没有score列，也创建一个基础的统计数据对象以支持前端三栏布局
                  const baseStats = {
                    averageScore: 0,
                    totalQuestions: baseData.length,
                    scoreDistribution: {},
                    classDistribution: {},
                    sourceDistribution: {},
                    hasScoreData: false
                  };
                  
                  // 创建base文件的结果对象
                  const baseResult = {
                    fileName: task.fileConfigs.baseFile.name || task.baseFile.name,
                    type: 'base',
                    statistics: baseStats,
                    outputPath: task.baseFile.path, // 使用原始文件路径
                    totalQuestions: baseData.length,
                    averageScore: 0,
                    hasScoreData: false
                  };
                  
                  // 将base结果添加到results数组的开头
                  if (!task.results) {
                    task.results = [];
                  }
                  task.results.unshift(baseResult);
                  
                  // 将base统计数据添加到statistics数组的开头
                  if (!task.statistics) {
                    task.statistics = [];
                  }
                  task.statistics.unshift(baseStats);
                  
                  console.log('Base文件基础统计数据已生成并添加到结果中（无score数据）');
                }
              } catch (error) {
                console.error('读取base文件分数数据失败:', error);
              }
            }
            
            // 处理compare文件不参与评测的情况
            // 如果compare文件存在但没有参与评测，尝试从compare文件读取已有的score数据
            if (task.compareFile && task.fileConfigs && task.fileConfigs.compareFile && !task.fileConfigs.compareFile.evaluate) {
              try {
                console.log('Compare文件未参与评测，尝试读取已有分数数据...');
                const compareData = readExcelFile(task.compareFile.path);
                
                // 检查是否有score列
                if (compareData && compareData.length > 0 && compareData[0].hasOwnProperty('score')) {
                  console.log('发现compare文件包含score列，生成统计数据...');
                  
                  // 计算compare文件的统计数据
                  const compareStats = calculateDetailedStats(compareData);
                  
                  // 创建compare文件的结果对象
                  const compareResult = {
                    fileName: task.fileConfigs.compareFile.name || task.compareFile.name,
                    type: 'compare',
                    statistics: compareStats,
                    outputPath: task.compareFile.path, // 使用原始文件路径
                    totalQuestions: compareData.length,
                    averageScore: compareStats.averageScore
                  };
                  
                  // 将compare结果添加到results数组
                  if (!task.results) {
                    task.results = [];
                  }
                  task.results.push(compareResult);
                  
                  // 将compare统计数据添加到statistics数组
                  if (!task.statistics) {
                    task.statistics = [];
                  }
                  task.statistics.push(compareStats);
                  
                  console.log('Compare文件统计数据已生成并添加到结果中');
                } else {
                  console.log('Compare文件不包含score列，生成基础统计数据以支持三栏布局...');
                  
                  // 即使没有score列，也创建一个基础的统计数据对象以支持前端三栏布局
                  const compareStats = {
                    averageScore: 0,
                    totalQuestions: compareData.length,
                    scoreDistribution: {},
                    classDistribution: {},
                    sourceDistribution: {},
                    hasScoreData: false
                  };
                  
                  // 创建compare文件的结果对象
                  const compareResult = {
                    fileName: task.fileConfigs.compareFile.name || task.compareFile.name,
                    type: 'compare',
                    statistics: compareStats,
                    outputPath: task.compareFile.path, // 使用原始文件路径
                    totalQuestions: compareData.length,
                    averageScore: 0,
                    hasScoreData: false
                  };
                  
                  // 将compare结果添加到results数组
                  if (!task.results) {
                    task.results = [];
                  }
                  task.results.push(compareResult);
                  
                  // 将compare统计数据添加到statistics数组
                  if (!task.statistics) {
                    task.statistics = [];
                  }
                  task.statistics.push(compareStats);
                  
                  console.log('Compare文件基础统计数据已生成并添加到结果中（无score数据）');
                }
              } catch (error) {
                console.error('读取compare文件分数数据失败:', error);
              }
            }
            
            // 确保results数组中的结果有正确的type字段用于前端三栏布局判断
            if (task.results && Array.isArray(task.results)) {
              task.results.forEach(result => {
                if (!result.type) {
                  // 如果没有type字段，根据文件名或其他信息推断
                  if (task.baseFile && (result.fileName === task.baseFile.name || 
                      (task.fileConfigs && task.fileConfigs.baseFile && result.fileName === task.fileConfigs.baseFile.name))) {
                    result.type = 'base';
                  } else if (task.compareFile && (result.fileName === task.compareFile.name || 
                      (task.fileConfigs && task.fileConfigs.compareFile && result.fileName === task.fileConfigs.compareFile.name))) {
                    result.type = 'compare';
                  }
                }
              });
            }
            
            // 保存评测日志以便页面刷新后恢复
            if (!task.evaluationLog) {
              task.evaluationLog = '';
            }
            
            // 保存已完成的文件到已完成文件列表
            if (result.results && Array.isArray(result.results)) {
              result.results.forEach(res => {
                if (res.outputPath && fs.existsSync(res.outputPath)) {
                  // 检查原始文件是否已包含评分数据
                  let originalFileHasScore = false;
                  let originalFilePath = null;
                  
                  // 确定原始文件路径
                  if (res.type === 'base' && task.baseFile) {
                    originalFilePath = task.baseFile.path;
                  } else if (res.type === 'compare' && task.compareFile) {
                    originalFilePath = task.compareFile.path;
                  }
                  
                  // 检查原始文件是否包含score列
                  if (originalFilePath && fs.existsSync(originalFilePath)) {
                    try {
                      const originalWorkbook = XLSX.readFile(originalFilePath, { codepage: 65001 });
                      const originalSheetName = originalWorkbook.SheetNames[0];
                      const originalData = XLSX.utils.sheet_to_json(originalWorkbook.Sheets[originalSheetName]);
                      
                      if (originalData.length > 0 && originalData[0].hasOwnProperty('score')) {
                        originalFileHasScore = true;
                        console.log(`原始文件 ${originalFilePath} 已包含评分数据，跳过保存到已完成文件列表`);
                      }
                    } catch (error) {
                      console.error(`检查原始文件评分数据失败: ${error.message}`);
                    }
                  }
                  
                  // 如果原始文件已包含评分数据，则不保存到已完成文件列表
                  if (originalFileHasScore) {
                    return;
                  }
                  
                  // 读取文件并计算score统计信息
                  let scoreStats = null;
                  try {
                    const workbook = XLSX.readFile(res.outputPath, { codepage: 65001 });
                    const sheetName = workbook.SheetNames[0];
                    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
                    
                    // 检查是否包含score列
                    if (data.length > 0 && data[0].hasOwnProperty('score')) {
                      const scores = data.map(row => parseFloat(row.score)).filter(score => !isNaN(score));
                      if (scores.length > 0) {
                        const sum = scores.reduce((a, b) => a + b, 0);
                        const avg = sum / scores.length;
                        const sortedScores = scores.sort((a, b) => a - b);
                        const min = sortedScores[0];
                        const max = sortedScores[sortedScores.length - 1];
                        
                        scoreStats = {
                          totalQuestions: data.length,
                          scoredQuestions: scores.length,
                          averageScore: Math.round(avg * 100) / 100,
                          minScore: min,
                          maxScore: max,
                          scoreDistribution: {
                            '0-20': scores.filter(s => s >= 0 && s < 20).length,
                            '20-40': scores.filter(s => s >= 20 && s < 40).length,
                            '40-60': scores.filter(s => s >= 40 && s < 60).length,
                            '60-80': scores.filter(s => s >= 60 && s < 80).length,
                            '80-100': scores.filter(s => s >= 80 && s <= 100).length
                          }
                        };
                      }
                    }
                  } catch (error) {
                    console.error(`读取文件score信息失败: ${error.message}`);
                  }
                  
                  // 获取文件大小
                  let fileSize = 0;
                  try {
                    const stats = fs.statSync(res.outputPath);
                    fileSize = stats.size;
                  } catch (error) {
                    console.error(`获取文件大小失败: ${error.message}`);
                  }
                  
                  // 使用源文件名而非用户配置的模型名
                  const displayName = res.fileName;
                  
                  const completedFile = {
                    id: uuidv4(),
                    name: displayName,
                    originalName: res.fileName,
                    filePath: res.outputPath,
                    submitter: task.submitter,
                    uploadTime: new Date().toISOString(),
                    taskId: task.id,
                    type: res.type || 'unknown',
                    size: fileSize,
                    scoreStats: scoreStats
                  };
                  
                  // 检查是否存在同名文件，如果存在则覆盖
                  const existingFileIndex = completedFiles.findIndex(file => file.name === displayName);
                  if (existingFileIndex !== -1) {
                    // 删除旧文件
                    const oldFile = completedFiles[existingFileIndex];
                    if (fs.existsSync(oldFile.filePath)) {
                      try {
                        fs.unlinkSync(oldFile.filePath);
                        console.log(`删除旧文件: ${oldFile.filePath}`);
                      } catch (error) {
                        console.error(`删除旧文件失败: ${error.message}`);
                      }
                    }
                    // 替换为新文件
                    completedFiles[existingFileIndex] = completedFile;
                    console.log(`覆盖已完成文件: ${displayName}`);
                  } else {
                    // 添加新文件
                    completedFiles.push(completedFile);
                    console.log(`添加已完成文件: ${displayName}`);
                  }
                }
              });
              // 保存已完成文件列表
              saveCompletedFiles();
            }
            
            // 保存模型输出到.jsonl文件
            if (task.modelOutputs && task.modelOutputs.length > 0) {
              try {
                const file1Outputs = task.modelOutputs.filter(output => output.file === 'file1');
                const file2Outputs = task.modelOutputs.filter(output => output.file === 'file2');
                
                if (file1Outputs.length > 0) {
                  const file1JsonlPath = path.join(uploadDir, `${task.id}_file1_outputs.jsonl`);
                  const file1JsonlContent = file1Outputs.map(output => JSON.stringify({
                    timestamp: output.timestamp,
                    output: output.output
                  })).join('\n');
                  fs.writeFileSync(file1JsonlPath, file1JsonlContent);
                  task.file1OutputsPath = `${task.id}_file1_outputs.jsonl`;
                }
                
                if (file2Outputs.length > 0) {
                  const file2JsonlPath = path.join(uploadDir, `${task.id}_file2_outputs.jsonl`);
                  const file2JsonlContent = file2Outputs.map(output => JSON.stringify({
                    timestamp: output.timestamp,
                    output: output.output
                  })).join('\n');
                  fs.writeFileSync(file2JsonlPath, file2JsonlContent);
                  task.file2OutputsPath = `${task.id}_file2_outputs.jsonl`;
                }
              } catch (error) {
                console.error('保存模型输出文件失败:', error);
              }
            }
            
            // 通知前端评测完成
            io.emit('evaluationComplete', {
              taskId: task.id,
              task: task,
              results: task.results,  // 使用处理过的task.results而不是原始的result.results
              statistics: task.statistics  // 使用从results中提取的statistics
            });
            
            // 通知首页任务状态更新
            io.emit('taskUpdated', task);
            
            // 清理进程
            evaluationProcesses.delete(task.id);
          } else if (result.type === 'error') {
            console.error('Python评测服务错误:', result.message);
            task.status = '评测失败';
            
            // 通知前端评测失败
            io.emit('evaluationError', {
              taskId: task.id,
              message: result.message,
              error: result.message  // 保持向后兼容
            });
            
            // 清理进程
            evaluationProcesses.delete(task.id);
          }
        } catch (e) {
          console.log('Python输出:', line);
        }
      });
    });
    
    pythonProcess.stderr.on('data', (data) => {
      try {
        const stderrOutput = data.toString();
        
        // 检查是否包含进度条信息
        const lines = stderrOutput.split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            // 检查是否是tqdm进度条
            if (line.includes('%|') || line.includes('it/s') || line.includes('s/it') || line.trim().match(/^\d+%\|.*\|/)) {
              // 发送进度条信息到前端
              io.emit('evaluationLog', {
                taskId: task.id,
                message: line.trim(),
                type: 'progress'
              });
            } else if (!line.includes('Terminal#')) {
              // 其他非终端控制信息作为错误输出
              console.error('Python错误输出:', line);
              io.emit('evaluationLog', {
                taskId: task.id,
                message: line.trim(),
                type: 'error'
              });
            }
          }
        });
      } catch (error) {
        console.error('处理Python输出时出错:', error);
      }
    });
    
    pythonProcess.on('close', (code) => {
      console.log(`Python进程退出，代码: ${code}`);
      if (code !== 0 && task.status === '评测中') {
        task.status = '评测失败';
        io.emit('evaluationError', {
          taskId: task.id,
          message: `Python进程异常退出，代码: ${code}`,
          error: `Python进程异常退出，代码: ${code}`  // 保持向后兼容
        });
        evaluationProcesses.delete(task.id);
      }
    });
    
    // 保存进程引用
    evaluationProcesses.set(task.id, pythonProcess);
    
  } catch (error) {
    console.error('启动Python评测服务失败:', error);
    task.status = '评测失败';
    
    io.emit('evaluationError', {
      taskId: task.id,
      message: '启动评测服务失败: ' + error.message,
      error: '启动评测服务失败: ' + error.message  // 保持向后兼容
    });
  }
}

// 模拟评测函数已移除，现在使用真正的Python评测服务

// 下载评测结果文件
app.get('/api/download/:taskId/:fileType', (req, res) => {
  try {
    const { taskId, fileType } = req.params;
    
    // 查找任务
    const task = evaluationTasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }
    
    // 确定要下载的文件
    let originalFileName, scoredFileName, originalFilePath;
    if (fileType === 'file1') {
      originalFileName = task.file1Name;
      originalFilePath = task.file1Path;
      scoredFileName = task.file1Path.replace('.xlsx', '_scored.xlsx');
    } else if (fileType === 'file2') {
      originalFileName = task.file2Name;
      originalFilePath = task.file2Path;
      scoredFileName = task.file2Path.replace('.xlsx', '_scored.xlsx');
    } else if (fileType === 'comprehensive') {
      // 生成综合报告
      return generateComprehensiveReport(req, res, task);
    } else if (fileType === 'file1_outputs') {
      // 下载文件1的模型输出
      if (!task.file1OutputsPath) {
        return res.status(404).json({ error: '文件1模型输出不存在' });
      }
      const filePath = path.join(uploadDir, task.file1OutputsPath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '文件1模型输出文件不存在' });
      }
      const downloadFileName = `${task.file1Name.replace('.xlsx', '')}_模型输出.jsonl`;
      return res.download(filePath, downloadFileName);
    } else if (fileType === 'file2_outputs') {
      // 下载文件2的模型输出
      if (!task.file2OutputsPath) {
        return res.status(404).json({ error: '文件2模型输出不存在' });
      }
      const filePath = path.join(uploadDir, task.file2OutputsPath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '文件2模型输出文件不存在' });
      }
      const downloadFileName = `${task.file2Name.replace('.xlsx', '')}_模型输出.jsonl`;
      return res.download(filePath, downloadFileName);
    } else if (fileType === 'file1_scored') {
      // 下载文件1的评分结果
      const scoredFilePath = task.file1Path.replace('.xlsx', '_scored.xlsx');
      const filePath = path.join(uploadDir, scoredFilePath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '文件1评分结果不存在' });
      }
      const downloadFileName = `${task.file1Name.replace('.xlsx', '')}_评分结果.xlsx`;
      return res.download(filePath, downloadFileName);
    } else if (fileType === 'file2_scored') {
      // 下载文件2的评分结果
      const scoredFilePath = task.file2Path.replace('.xlsx', '_scored.xlsx');
      const filePath = path.join(uploadDir, scoredFilePath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '文件2评分结果不存在' });
      }
      const downloadFileName = `${task.file2Name.replace('.xlsx', '')}_评分结果.xlsx`;
      return res.download(filePath, downloadFileName);
    } else {
      return res.status(400).json({ error: '无效的文件类型' });
    }
    
    let filePath = path.join(uploadDir, scoredFileName);
    let downloadFileName = originalFileName.replace('.xlsx', '_scored.xlsx');
    
    // 检查评分结果文件是否存在，如果不存在则下载原始文件
    if (!fs.existsSync(filePath)) {
      // 检查是否是base文件不参与评测的情况
      const isBaseFile = (fileType === 'file1' && task.baseFileEvaluate === false) || 
                        (fileType === 'file2' && task.compareFileEvaluate === false);
      
      if (isBaseFile) {
        // 如果是base文件不参与评测，下载原始文件
        filePath = path.join(uploadDir, originalFilePath);
        downloadFileName = originalFileName;
        
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: '原始文件不存在' });
        }
      } else {
        return res.status(404).json({ error: '评测结果文件不存在' });
      }
    }
    
    // 设置正确的MIME类型
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
    
    // 发送文件
    res.download(filePath, downloadFileName, (err) => {
      if (err) {
        console.error('文件下载错误:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: '文件下载失败' });
        }
      }
    });
    
  } catch (error) {
    console.error('下载文件错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 读取Excel文件数据
function readExcelFile(filePath, sheetName = null) {
  const workbook = XLSX.readFile(filePath, { codepage: 65001 }); // 使用UTF-8编码
  
  // 如果没有指定工作表名，优先选择'评分数据'工作表，否则选择第一个工作表
  let targetSheetName;
  if (sheetName) {
    targetSheetName = sheetName;
  } else if (workbook.SheetNames.includes('评分数据')) {
    targetSheetName = '评分数据';
  } else {
    targetSheetName = workbook.SheetNames[0];
  }
  
  return XLSX.utils.sheet_to_json(workbook.Sheets[targetSheetName]);
}

// 计算详细统计数据
function calculateDetailedStats(data) {
  const stats = {
    overall: {
      average_score: 0,
      total_questions: data.length,
      max_score: 0,
      min_score: 1
    },
    by_parent_class: {},
    by_sub_class: {}
  };
  
  if (data.length === 0) return stats;
  
  let totalScore = 0;
  
  data.forEach(row => {
    const score = parseFloat(row.score) || 0;
    totalScore += score;
    
    stats.overall.max_score = Math.max(stats.overall.max_score, score);
    stats.overall.min_score = Math.min(stats.overall.min_score, score);
    
    // 按父类统计
    const parentClass = row.parent_class || '其他';
    if (!stats.by_parent_class[parentClass]) {
      stats.by_parent_class[parentClass] = { total_score: 0, count: 0 };
    }
    stats.by_parent_class[parentClass].total_score += score;
    stats.by_parent_class[parentClass].count += 1;
    
    // 按子类统计
    const subclass = row.subclass || '其他';
    if (!stats.by_sub_class[subclass]) {
      stats.by_sub_class[subclass] = { total_score: 0, count: 0 };
    }
    stats.by_sub_class[subclass].total_score += score;
    stats.by_sub_class[subclass].count += 1;
  });
  
  stats.overall.average_score = totalScore / data.length;
  
  // 计算各类别平均分
  Object.keys(stats.by_parent_class).forEach(key => {
    const item = stats.by_parent_class[key];
    item.average_score = item.total_score / item.count;
  });
  
  Object.keys(stats.by_sub_class).forEach(key => {
    const item = stats.by_sub_class[key];
    item.average_score = item.total_score / item.count;
  });
  
  return stats;
}

// 计算类别分布（用于没有评分的base文件）
function calculateClassDistribution(data) {
  const classDistribution = {};
  data.forEach(row => {
    const parentClass = row.parent_class || '其他';
    const subclass = row.subclass || '其他';
    const key = `${parentClass}-${subclass}`;
    
    if (!classDistribution[key]) {
      classDistribution[key] = {
        count: 0
      };
    }
    
    classDistribution[key].count++;
  });
  return classDistribution;
}

// 计算来源分布（用于没有评分的base文件）
function calculateSourceDistribution(data) {
  const sourceDistribution = {};
  data.forEach(row => {
    const source = row.source || '未知来源';
    
    if (!sourceDistribution[source]) {
      sourceDistribution[source] = {
        count: 0
      };
    }
    
    sourceDistribution[source].count++;
  });
  return sourceDistribution;
}

// 旧的PDF对比报告生成函数已删除，现在使用新的三栏对比布局

// 绘制表格
// 旧的PDF绘图函数已删除，现在使用新的三栏对比布局

// 生成详细Excel报告
async function generateDetailedExcelReport(task) {
  const workbook = new ExcelJS.Workbook();
  
  // 读取评测结果数据
  const baseResult = task.results.find(r => r.type === 'base');
  const compareResult = task.results.find(r => r.type === 'compare');
  
  // 检查是否至少有一个结果
  if (!baseResult && !compareResult) {
    throw new Error('缺少评测结果数据');
  }
  
  const hasBase = !!baseResult;
  const hasCompare = !!compareResult;
  
  // 检查文件是否存在并读取数据
  let basePath, comparePath, baseData, compareData;
  
  if (hasBase) {
    console.log('Base模型文件路径:', baseResult.outputPath);
    basePath = baseResult.outputPath;
    console.log('处理后Base模型文件路径:', basePath);
    
    // 检查文件是否存在，如果不存在则尝试从原始路径读取
    if (!fs.existsSync(basePath)) {
      console.log('Base模型结果文件不存在，尝试从原始路径读取:', basePath);
      // 如果base文件未参与评测，直接使用原始文件路径
      if (baseResult.type === 'base' && task.baseFile && task.baseFile.path) {
        basePath = task.baseFile.path;
        console.log('使用原始Base文件路径:', basePath);
        if (!fs.existsSync(basePath)) {
          throw new Error(`Base文件不存在: ${basePath}`);
        }
      } else {
        throw new Error(`Base模型结果文件不存在: ${basePath}`);
      }
    }
    baseData = readExcelFile(basePath);
  } else {
    baseData = [];
  }
  
  if (hasCompare) {
    console.log('对比模型文件路径:', compareResult.outputPath);
    comparePath = compareResult.outputPath;
    console.log('处理后对比模型文件路径:', comparePath);
    
    // 如果outputPath为undefined或文件不存在，尝试使用原始文件路径
    if (!comparePath || !fs.existsSync(comparePath)) {
      console.log('对比模型结果文件不存在，尝试从原始路径读取:', comparePath);
      // 如果compare文件未参与评测，直接使用原始文件路径
      if (compareResult.type === 'compare' && task.compareFile && task.compareFile.path) {
        comparePath = task.compareFile.path;
        console.log('使用原始Compare文件路径:', comparePath);
        if (!fs.existsSync(comparePath)) {
          throw new Error(`Compare文件不存在: ${comparePath}`);
        }
      } else {
        throw new Error(`对比模型结果文件不存在: ${comparePath}`);
      }
    }
    compareData = readExcelFile(comparePath);
  } else {
    compareData = [];
  }
  
  // 使用已有的统计数据或重新计算
  let baseStats, compareStats;
  
  if (hasBase) {
    baseStats = (task.statistics && task.statistics[0]) ? task.statistics[0] : calculateDetailedStats(baseData);
  }
  
  if (hasCompare) {
    const statsIndex = hasBase ? 1 : 0;
    compareStats = (task.statistics && task.statistics[statsIndex]) ? task.statistics[statsIndex] : calculateDetailedStats(compareData);
  }
  
  // 创建概览工作表
  const overviewSheet = workbook.addWorksheet('概览对比');
  
  // 设置标题
  overviewSheet.mergeCells('A1:D1');
  const reportTitle = (hasBase && hasCompare) ? '模型评测对比报告' : '模型评测报告';
  overviewSheet.getCell('A1').value = reportTitle;
  overviewSheet.getCell('A1').font = { size: 16, bold: true };
  overviewSheet.getCell('A1').alignment = { horizontal: 'center' };
  
  // 获取用户配置的模型名称
  const baseModelName = (task.fileConfigs && task.fileConfigs.baseFile && task.fileConfigs.baseFile.name) || (baseResult && baseResult.fileName) || 'Base模型';
  const compareModelName = (task.fileConfigs && task.fileConfigs.compareFile && task.fileConfigs.compareFile.name) || (compareResult && compareResult.fileName) || '对比模型';
  
  // 基本信息
  let currentRow = 3;
  if (hasBase) {
    overviewSheet.getCell(`A${currentRow}`).value = 'Base模型:';
    overviewSheet.getCell(`B${currentRow}`).value = baseModelName;
    currentRow++;
  }
  if (hasCompare) {
    overviewSheet.getCell(`A${currentRow}`).value = hasBase ? '对比模型:' : '评测模型:';
    overviewSheet.getCell(`B${currentRow}`).value = compareModelName;
    currentRow++;
  }
  
  // 整体评测结果表格
  currentRow += 2;
  const tableTitle = (hasBase && hasCompare) ? '整体评测结果对比' : '整体评测结果';
  overviewSheet.getCell(`A${currentRow}`).value = tableTitle;
  overviewSheet.getCell(`A${currentRow}`).font = { bold: true };
  currentRow++;
  
  if (hasBase && hasCompare) {
    // 对比模式
    const overallHeaders = ['指标', baseModelName, compareModelName, '差值'];
    overviewSheet.addRow(overallHeaders);
    
    const overallData = [
      ['平均分', baseStats.overall.average_score.toFixed(3), compareStats.overall.average_score.toFixed(3), (compareStats.overall.average_score - baseStats.overall.average_score).toFixed(3)],
      ['最高分', baseStats.overall.max_score.toFixed(3), compareStats.overall.max_score.toFixed(3), (compareStats.overall.max_score - baseStats.overall.max_score).toFixed(3)],
      ['最低分', baseStats.overall.min_score.toFixed(3), compareStats.overall.min_score.toFixed(3), (compareStats.overall.min_score - baseStats.overall.min_score).toFixed(3)],
      ['题目总数', baseStats.overall.total_questions, compareStats.overall.total_questions, compareStats.overall.total_questions - baseStats.overall.total_questions]
    ];
    
    overallData.forEach(row => {
      overviewSheet.addRow(row);
    });
  } else {
    // 单模型模式
    const stats = hasBase ? baseStats : compareStats;
    const modelName = hasBase ? baseModelName : compareModelName;
    
    const singleHeaders = ['指标', modelName];
    overviewSheet.addRow(singleHeaders);
    
    const singleData = [
      ['平均分', stats.overall.average_score.toFixed(3)],
      ['最高分', stats.overall.max_score.toFixed(3)],
      ['最低分', stats.overall.min_score.toFixed(3)],
      ['题目总数', stats.overall.total_questions]
    ];
    
    singleData.forEach(row => {
      overviewSheet.addRow(row);
    });
  }
  
  // 父类统计
  currentRow = overviewSheet.rowCount + 2;
  const parentClassTitle = (hasBase && hasCompare) ? '按父类对比' : '按父类统计';
  overviewSheet.getCell(`A${currentRow}`).value = parentClassTitle;
  overviewSheet.getCell(`A${currentRow}`).font = { bold: true };
  currentRow++;
  
  if (hasBase && hasCompare) {
    // 对比模式
    const parentClassHeaders = ['父类', `${baseModelName}平均分`, `${compareModelName}平均分`, '差值'];
    overviewSheet.addRow(parentClassHeaders);
    
    const allParentClasses = new Set([...Object.keys(baseStats.by_parent_class), ...Object.keys(compareStats.by_parent_class)]);
    allParentClasses.forEach(parentClass => {
      const baseScore = baseStats.by_parent_class[parentClass]?.average_score || 0;
      const compareScore = compareStats.by_parent_class[parentClass]?.average_score || 0;
      overviewSheet.addRow([
        parentClass,
        baseScore.toFixed(3),
        compareScore.toFixed(3),
        (compareScore - baseScore).toFixed(3)
      ]);
    });
  } else {
    // 单模型模式
    const stats = hasBase ? baseStats : compareStats;
    const modelName = hasBase ? `${baseModelName}平均分` : `${compareModelName}平均分`;
    
    const parentClassHeaders = ['父类', modelName];
    overviewSheet.addRow(parentClassHeaders);
    
    Object.keys(stats.by_parent_class).forEach(parentClass => {
      const score = stats.by_parent_class[parentClass]?.average_score || 0;
      overviewSheet.addRow([
        parentClass,
        score.toFixed(3)
      ]);
    });
  }
  
  // 子类统计
  const subclassStartRow = overviewSheet.rowCount + 2;
  const subclassTitle = (hasBase && hasCompare) ? '按子类对比' : '按子类统计';
  overviewSheet.getCell(`A${subclassStartRow}`).value = subclassTitle;
  overviewSheet.getCell(`A${subclassStartRow}`).font = { bold: true };
  
  if (hasBase && hasCompare) {
    // 对比模式
    const subclassHeaders = ['子类', `${baseModelName}平均分`, `${compareModelName}平均分`, '差值'];
    overviewSheet.addRow(subclassHeaders);
    
    const allSubclasses = new Set([...Object.keys(baseStats.by_sub_class || {}), ...Object.keys(compareStats.by_sub_class || {})]);
    allSubclasses.forEach(subclass => {
      const baseScore = baseStats.by_sub_class[subclass]?.average_score || 0;
      const compareScore = compareStats.by_sub_class[subclass]?.average_score || 0;
      overviewSheet.addRow([
        subclass,
        baseScore.toFixed(3),
        compareScore.toFixed(3),
        (compareScore - baseScore).toFixed(3)
      ]);
    });
  } else {
    // 单模型模式
    const stats = hasBase ? baseStats : compareStats;
    const modelName = hasBase ? `${baseModelName}平均分` : `${compareModelName}平均分`;
    
    const subclassHeaders = ['子类', modelName];
    overviewSheet.addRow(subclassHeaders);
    
    Object.keys(stats.by_sub_class || {}).forEach(subclass => {
      const score = stats.by_sub_class[subclass]?.average_score || 0;
      overviewSheet.addRow([
        subclass,
        score.toFixed(3)
      ]);
    });
  }
  
  // 设置列宽
  overviewSheet.columns = [
    { width: 20 },
    { width: 15 },
    { width: 15 },
    { width: 15 }
  ];
  
  // 创建合并的详细数据工作表
  const detailSheet = workbook.addWorksheet('详细对比数据');
  
  // 确保至少有一个数据源
  if ((hasBase && baseData.length > 0) || (hasCompare && compareData.length > 0)) {
    // 为详细数据工作表调整模型名称
    let detailBaseModelName = baseModelName;
    let detailCompareModelName = compareModelName;
    
    if (!hasBase) {
      detailBaseModelName = "Base模型(未参与评测)";
    }
    if (!hasCompare) {
      detailCompareModelName = "对比模型(未参与评测)";
    }
    
    const headers = [
      'id', 'instruction', 'reference', 'parent_class', 'subclass',
      `model_ans(${detailBaseModelName})`, `score(${detailBaseModelName})`, `reason(${detailBaseModelName})`,
      `model_ans(${detailCompareModelName})`, `score(${detailCompareModelName})`, `reason(${detailCompareModelName})`,
      'source'
    ];
    detailSheet.addRow(headers);
    
    // 创建统一的ID映射，将所有数据按行号重新编号为自然数序列
    let primaryData, secondaryData;
    let primaryDataWithIndex, secondaryDataWithIndex;
    
    if (hasBase && baseData.length > 0) {
      primaryData = baseData;
      secondaryData = hasCompare ? compareData : [];
    } else {
      primaryData = compareData;
      secondaryData = [];
    }
    
    primaryDataWithIndex = primaryData.map((row, index) => ({
      ...row,
      normalizedId: (index + 1).toString()
    }));
    
    secondaryDataWithIndex = secondaryData.map((row, index) => ({
      ...row,
      normalizedId: (index + 1).toString()
    }));
    
    // 创建ID到数据的映射
    const secondaryDataMap = new Map();
    secondaryDataWithIndex.forEach(row => {
      secondaryDataMap.set(row.normalizedId, row);
    });
    
    // 按照主要文件的顺序合并数据
    primaryDataWithIndex.forEach(primaryRow => {
      const secondaryRow = secondaryDataMap.get(primaryRow.normalizedId) || {};
      
      let mergedRow;
      if (hasBase && baseData.length > 0) {
        // base是主要数据源
        mergedRow = [
          primaryRow.id || '',
          primaryRow.instruction || '',
          primaryRow.reference || '',
          primaryRow.parent_class || '',
          primaryRow.subclass || '',
          primaryRow.model_ans || '',
          primaryRow.score !== undefined && primaryRow.score !== null && primaryRow.score !== '' ? primaryRow.score : 0,
          primaryRow.reason || '',
          secondaryRow.model_ans || '',
          secondaryRow.score !== undefined && secondaryRow.score !== null && secondaryRow.score !== '' ? secondaryRow.score : 0,
          secondaryRow.reason || '',
          primaryRow.source || ''
        ];
      } else {
        // compare是主要数据源
        mergedRow = [
          primaryRow.id || '',
          primaryRow.instruction || '',
          primaryRow.reference || '',
          primaryRow.parent_class || '',
          primaryRow.subclass || '',
          '', // base model_ans (空)
          0,  // base score (0)
          '', // base reason (空)
          primaryRow.model_ans || '',
          primaryRow.score !== undefined && primaryRow.score !== null && primaryRow.score !== '' ? primaryRow.score : 0,
          primaryRow.reason || '',
          primaryRow.source || ''
        ];
      }
      
      detailSheet.addRow(mergedRow);
    });
    
    // 设置详细数据表的列宽
    detailSheet.columns = [
      { width: 8 },   // id
      { width: 50 },  // instruction
      { width: 30 },  // reference
      { width: 15 },  // parent_class
      { width: 15 },  // subclass
      { width: 30 },  // base model_ans
      { width: 10 },  // base score
      { width: 40 },  // base reason
      { width: 30 },  // compare model_ans
      { width: 10 },  // compare score
      { width: 40 },  // compare reason
      { width: 15 }   // source
    ];
  }
  
  // 生成Excel缓冲区
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// 生成PDF对比报告
// 旧的对比报告路由已删除，现在使用新的三栏对比布局

// Socket.IO连接处理
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
  });
});

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`也可以通过网络访问: http://192.168.10.34:${PORT}`);
});

module.exports = app;