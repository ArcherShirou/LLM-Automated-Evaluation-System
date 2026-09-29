# 自动评测系统

用 Excel 对模型回答评分、对比结果；也可以运行多轮合成场景，查看助手的回复、沙盒动作和评分证据。

## 启动

需要 Node.js 20+ 和 Python 3.9+：

```bash
npm ci
pip install -r requirements.txt
npm start
```

打开 `http://127.0.0.1:8000`。服务器默认只监听本机。项目不会自动读取 `.env` 文件；请在启动前由终端或进程管理器设置环境变量。

## 常用流程

1. 在首页填写任务名，上传待评测的 `.xlsx` 文件；如需对比，再上传 Base 文件。提交人可留空。创建后会直接进入评测页。
2. 选择评分模型。没有分数的文件会评分；已有分数的文件默认复用，可勾选“重新评分”。两个文件都已有分数且均不重新评分时，直接查看对比。
3. 查看结果和待人工复核清单，按需下载详细 Excel 报告。已完成文件可用于新任务。
4. 场景评测从首页进入。内置合成医疗咨询和客服退款场景；客服场景中的订单查询与退款只修改沙盒状态，不连接真实业务。

Excel 必需列：`id`、`instruction`、`reference`、`parent_class`、`subclass`、`model_ans`、`source`。`reference` 可以为空。`id` 必须非空且唯一。可选 `score` 列取值为 0 到 1；两个文件直接对比时，每行都必须有有效分数且两份文件的 `id` 一一对应。单个上传文件上限为 10 MB。

## 模型配置

在使用对应功能前配置所需的兼容 OpenAI API 的模型：

| 环境变量 | 用途 |
| --- | --- |
| `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` | 选择 Deepseek 评分/模拟时使用 |
| `GPT_OSS_BASE_URL`、`GPT_OSS_MODEL` | 选择 GPT-oss 评分/模拟时使用 |
| `TEACHER_MODEL_API_KEY` | 评分/模拟服务需要鉴权时设置 |
| `CANDIDATE_BASE_URL`、`CANDIDATE_MODEL` | 场景评测的待测助手 |
| `CANDIDATE_API_KEY` | 待测模型需要鉴权时设置 |
| `PYTHON` | Python 可执行文件，默认 `python3` |

运行客服退款场景时，待测模型应按提示返回含 `message` 和 `actions` 的 JSON。环境会确定性地执行 `lookup_order`、`issue_refund`，并将结果写入下一轮对话。普通回答仍可记录，但不会触发沙盒动作。场景评分核对待测模型的原文证据；评分器与证据规则不一致时标记人工复核。合成场景结果不用于真实诊疗或临床认证。

## 访问与数据

默认地址为 `127.0.0.1:8000`，可通过 `PORT` 修改端口。设置 `HOST=0.0.0.0` 时必须设置高强度的 `APP_ACCESS_TOKEN`。跨网络使用时请配置 HTTPS 反向代理，并设置 `APP_HTTPS=1`。访问令牌保护的是一个共享工作区，不提供独立账号或用户级数据隔离。

任务和已完成文件的元数据默认分别保存在 `tasks-data.json`、`completed-files-data.json`；上传文件在 `uploads/`，场景运行记录在 `scenario-runs/`。可用 `TASKS_DATA_PATH`、`COMPLETED_FILES_DATA_PATH`、`SCENARIO_RUNS_DIR` 调整位置。删除任务会清理未被其他任务或已完成文件引用的上传文件；被任务引用的已完成文件须先删除相关任务。

## 验证

```bash
npm test
python3 -m unittest -v test_eval_service.py test_scenario_eval.py
```

这些测试使用本地模拟模型，不需要真实模型凭据。
