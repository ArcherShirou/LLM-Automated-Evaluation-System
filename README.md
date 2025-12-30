# 自动评测系统

一个基于Node.js和Python的智能Excel文件评测系统，支持多文件对比分析、实时评测进度监控和详细报告生成。

## 系统特性

- 📊 **Excel文件自动评测**：支持批量评测Excel文件中的问答数据
- 🔄 **实时进度监控**：WebSocket实时显示评测进度和状态
- 📈 **对比分析报告**：生成详细的PDF和Excel对比报告
- 🎯 **灵活文件配置**：支持Base文件和Compare文件的灵活配置
- 📁 **文件管理**：完整的文件上传、下载和管理功能
- 🌐 **多用户支持**：支持多人同时在线使用
- 🤖 **AI智能评分**：基于OpenAI API的智能评分系统

## 系统架构

- **前端**：HTML + JavaScript + Socket.IO + Bootstrap
- **后端**：Node.js + Express + Socket.IO
- **评测引擎**：Python + OpenAI API + asyncio
- **文件处理**：ExcelJS + XLSX + pandas
- **报告生成**：PDFKit + ExcelJS

## 环境要求

### 系统要求
- Windows 10/11 或 Linux 或 macOS
- Node.js 16.0+ 
- Python 3.8+
- 至少 4GB RAM
- 至少 2GB 可用磁盘空间

### 软件依赖
- Node.js 和 npm
- Python 3.8+
- Git（可选，用于克隆代码）

## 安装部署

### 1. 获取代码

```bash
# 如果使用Git
git clone <repository-url>
cd 自动评测系统2

# 或者直接下载并解压代码包
```

### 2. 安装Node.js依赖

```bash
npm install
```

主要依赖包：
- express: Web应用框架
- socket.io: 实时通信
- multer: 文件上传处理
- xlsx: Excel文件解析
- exceljs: Excel文件生成
- pdfkit: PDF报告生成
- fs-extra: 文件系统操作
- cors: 跨域支持

### 3. 安装Python依赖

```bash
pip install pandas asyncio openai tqdm openpyxl
```

或者创建requirements.txt文件：

```txt
pandas>=1.3.0
openai>=1.0.0
tqdm>=4.60.0
openpyxl>=3.0.0
aiohttp>=3.8.0
```

然后安装：

```bash
pip install -r requirements.txt
```

### 4. 配置环境变量

在项目根目录创建 `.env` 文件（可选）：

```env
PORT=8000
TEACHER_MODEL_URL=your_openai_api_endpoint
OPENAI_API_KEY=your_openai_api_key
```

### 5. 配置评测模型

编辑 `eval_service.py` 文件，配置您的AI模型API：

```python
# 修改以下配置
TEACHER_MODEL_URL = "your_api_endpoint"  # 例如："https://api.openai.com/v1"
api_key = "your_api_key"  # 您的OpenAI API密钥
```

**重要**：请确保您有有效的OpenAI API密钥，否则评测功能将无法正常工作。

## 启动系统

### 开发模式

```bash
npm run dev
```

### 生产模式

```bash
npm start
```

系统启动后，您将看到类似输出：

```
已加载 X 个已完成文件
服务器运行在 http://localhost:8000
也可以通过网络访问: http://your_ip:8000
```

访问地址：
- 本地访问：http://localhost:8000
- 网络访问：http://your_ip:8000

## 使用说明

### 1. 创建评测任务

1. 访问系统首页
2. 点击"创建新任务"
3. 填写任务信息：
   - 任务名称
   - 提交人姓名
4. 上传文件：
   - Base文件（可选）：基准模型文件
   - Compare文件（必需）：待评测的模型文件
5. 点击"创建任务"

### 2. 配置评测参数

在任务页面可以配置：
- **文件名称**：自定义显示名称
- **是否参与评测**：选择文件是否需要进行AI评测
- **评测说明**：添加评测备注信息

### 3. 开始评测

1. 配置完成后点击"开始评测"
2. 系统将显示实时评测进度
3. 可以随时点击"停止评测"中断进程

### 4. 查看结果

评测完成后可以：
- **查看统计信息**：平均分、总题数、分类统计等
- **导出详细报告**：Excel格式的详细评测报告
- **生成对比报告**：PDF格式的对比分析报告
- **下载评测文件**：下载包含评分的Excel文件

### 5. 文件管理

- 访问"已完成文件"页面
- 查看所有历史评测文件
- 支持批量下载或删除文件
- 文件搜索和筛选功能

## 文件格式要求

### Excel文件格式

评测的Excel文件应包含以下列：

| 列名 | 说明 | 必需 | 示例 |
|------|------|------|------|
| question | 问题内容 | 是 | "什么是人工智能？" |
| answer | 标准答案 | 是 | "人工智能是..." |
| student_answer | 学生/模型答案 | 是 | "AI是一种技术..." |
| parent_class | 父类别 | 否 | "计算机科学" |
| sub_class | 子类别 | 否 | "人工智能基础" |
| source | 来源 | 否 | "教材第一章" |
| score | 分数（如果已有） | 否 | 85 |

### 示例数据

```csv
question,answer,student_answer,parent_class,sub_class,source
什么是AI？,人工智能是模拟人类智能的技术,人工智能技术,计算机科学,AI基础,教材
机器学习的定义,机器学习是AI的一个分支,ML是AI子领域,计算机科学,机器学习,课件
```

## 配置说明

### 服务器配置

在 `server.js` 中可以修改：

```javascript
const PORT = process.env.PORT || 8000;  // 服务器端口

// 文件上传限制
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('只支持.xlsx格式的文件'), false);
    }
  }
});
```

### 评测配置

在 `eval_service.py` 中可以修改：

```python
TEACHER_MODEL_URL = "your_api_endpoint"  # AI模型API地址
process_count = 4  # 并发评测数量
max_retries = 3    # 最大重试次数
timeout = 30       # 请求超时时间（秒）
```

### 目录结构配置

系统会自动创建以下目录：
- `uploads/`: 上传文件存储
- `completed-files/`: 完成评测的文件
- `__pycache__/`: Python缓存文件

## 故障排除

### 常见问题

1. **端口被占用**
   ```bash
   # Windows
   netstat -ano | findstr :8000
   taskkill /PID <PID> /F
   
   # Linux/macOS
   lsof -i :8000
   kill -9 <PID>
   ```

2. **Python依赖问题**
   ```bash
   pip install --upgrade pip
   pip install pandas openai tqdm openpyxl
   ```

3. **Node.js依赖问题**
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **文件权限问题**
   ```bash
   # Linux/macOS
   chmod -R 755 ./
   ```

5. **OpenAI API问题**
   - 检查API密钥是否正确
   - 确认API额度是否充足
   - 检查网络连接是否正常

6. **内存不足**
   - 减少并发评测数量（修改process_count）
   - 增加系统内存
   - 分批处理大文件

### 日志查看

- **服务器日志**：控制台输出，包含请求处理和错误信息
- **Python评测日志**：控制台输出，包含评测进度和API调用信息
- **浏览器日志**：F12开发者工具Console面板

### 调试模式

启用详细日志：

```bash
# 设置环境变量
set DEBUG=* && npm start  # Windows
export DEBUG=* && npm start  # Linux/macOS
```

## 性能优化

### 服务器优化

1. **增加并发数**：修改 `eval_service.py` 中的 `process_count`
2. **内存优化**：处理大文件时分批读取
3. **缓存优化**：启用文件缓存机制
4. **进程管理**：使用PM2管理Node.js进程

```bash
npm install -g pm2
pm2 start server.js --name "auto-eval-system"
```

### 网络优化

1. **使用CDN**：静态资源使用CDN加速
2. **启用压缩**：启用gzip压缩
3. **负载均衡**：多实例部署
4. **缓存策略**：设置合适的缓存头

### 数据库优化（可选）

对于大规模部署，建议使用数据库存储任务信息：
- MongoDB：存储任务和结果数据
- Redis：缓存和会话管理

## 安全注意事项

1. **API密钥安全**：
   - 不要在代码中硬编码API密钥
   - 使用环境变量或配置文件
   - 定期轮换API密钥

2. **文件上传安全**：
   - 限制上传文件大小（默认10MB）
   - 只允许.xlsx格式文件
   - 扫描上传文件的恶意内容

3. **访问控制**：
   - 生产环境建议添加身份验证
   - 使用防火墙限制访问
   - 启用HTTPS

4. **数据保护**：
   - 定期备份重要数据
   - 加密敏感信息
   - 遵守数据保护法规

## 开发指南

### 项目结构

```
自动评测系统2/
├── server.js                 # 主服务器文件
├── eval_service.py           # Python评测服务
├── package.json              # Node.js依赖配置
├── package-lock.json         # 依赖版本锁定
├── public/                   # 前端静态文件
│   ├── index.html           # 主页
│   ├── evaluation.html      # 评测页面
│   ├── completed-files.html # 文件管理页面
│   ├── app.js              # 主页逻辑
│   ├── evaluation.js       # 评测页面逻辑
│   └── completed-files.js  # 文件管理逻辑
├── uploads/                  # 上传文件目录
├── completed-files/          # 完成文件目录
├── completed-files-data.json # 文件元数据
└── README.md                # 本文档
```

### 添加新功能

1. **后端API**：在 `server.js` 中添加新的路由
2. **前端页面**：在 `public/` 目录添加HTML和JS文件
3. **评测逻辑**：在 `eval_service.py` 中修改评测算法
4. **数据处理**：扩展Excel文件处理功能

### 代码规范

- 使用ES6+语法
- 遵循RESTful API设计
- 添加适当的错误处理
- 编写清晰的注释
- 使用async/await处理异步操作

## 部署到生产环境

### 使用PM2部署

```bash
# 安装PM2
npm install -g pm2

# 启动应用
pm2 start server.js --name "auto-eval-system"

# 查看状态
pm2 status

# 查看日志
pm2 logs auto-eval-system

# 重启应用
pm2 restart auto-eval-system
```

### 使用Docker部署

创建 `Dockerfile`：

```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8000

CMD ["npm", "start"]
```

构建和运行：

```bash
docker build -t auto-eval-system .
docker run -p 8000:8000 auto-eval-system
```

### 反向代理配置

使用Nginx作为反向代理：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 许可证

本项目采用 MIT 许可证。详见 LICENSE 文件。

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 支持与反馈

如有问题或建议，请：

1. 查看本文档的故障排除部分
2. 检查已知问题列表
3. 提交Issue描述问题
4. 联系开发团队

---

**注意**：首次部署时请确保所有依赖都已正确安装，并根据实际环境调整配置参数。特别是OpenAI API的配置，这是系统正常运行的关键。# -LLM-Automated-Evaluation-System
