# 自动评测系统

上传 Excel，对模型回答打分、对比结果；也可以直接运行内置场景，查看助手或 Agent 的完整执行过程。

## 能做什么

| 功能 | 用途 |
| --- | --- |
| Excel 评分 | 按行评分，保留原始 ID 和评分结果 |
| 结果对比 | 按 ID 对齐两份结果，查看差异和待复核项 |
| 对话场景 | 模拟多轮用户对话，检查回复和沙盒动作 |
| Agent 评测 | 让待测模型自行调用工具，检查调用顺序、执行结果和最终回复 |

场景可独立运行 1 次或 3 次。页面会显示每次的轨迹、检查点、平均分和完整通过比例。每次运行都会重置沙盒。

## 启动

需要 Node.js 20+、Python 3.9+，以及兼容 OpenAI API 的待测模型和评分模型。

```bash
npm ci
pip install -r requirements.txt

export CANDIDATE_BASE_URL="你的待测模型接口地址"
export CANDIDATE_MODEL="你的待测模型名称"
export DEEPSEEK_BASE_URL="你的评分模型接口地址"
export DEEPSEEK_MODEL="你的评分模型名称"
# 接口需要密钥时，再设置 CANDIDATE_API_KEY 和 TEACHER_MODEL_API_KEY

npm start
```

打开 `http://127.0.0.1:8000`。也可以用 `GPT_OSS_BASE_URL` 和 `GPT_OSS_MODEL` 配置另一种评分模型。项目不会自动读取 `.env`；请在启动前设置环境变量。

## 使用

**评 Excel：** 首页上传 `.xlsx` 文件，选择评分模型，运行后查看或下载结果。要对比两份文件，再上传 Base 文件；已有分数可以直接复用，也可以重新评分。

**评对话：** 打开“场景与 Agent 评测”，选择场景和“对话场景”，设置重复次数后开始。系统会模拟用户回复，按检查点评分。

**评 Agent：** 在同一页面选择“Agent 工具调用”。待测模型须支持 OpenAI 兼容的 Chat Completions `tools` 接口。模型自行选择工具；系统返回沙盒结果，并记录请求、结果和最终回复。每次最多 6 步，每步最多 2 次工具调用。

内置 Agent 场景：

| 场景 | 可用工具 | 主要检查 |
| --- | --- | --- |
| 胸痛咨询 | 获取症状、记录紧急转介建议 | 是否识别危险症状、及时建议联系急救服务 |
| 报告咨询 | 查询报告、记录后续联系请求 | 报告缺失时是否避免臆断并安排后续联系 |
| 符合条件的退款 | 查询订单、提交退款 | 是否先查询、正确退款并告知客户 |
| 不符合条件的退款 | 查询订单、提交退款 | 是否查询条件、避免尝试违规退款 |

医疗场景、订单和所有工具都是合成数据。转介、复诊和退款只更新本地沙盒状态，不会联系医院、急救服务或真实订单系统。医疗场景结果不用于临床判断。

## 文件和配置

Excel 必需列：`id`、`instruction`、`reference`、`parent_class`、`subclass`、`model_ans`、`source`。`reference` 可为空；`id` 必须非空且唯一。可选 `score` 列取值为 0 到 1。单个文件上限 10 MB。

| 环境变量 | 用途 |
| --- | --- |
| `CANDIDATE_BASE_URL`、`CANDIDATE_MODEL`、`CANDIDATE_API_KEY` | 待测助手或 Agent；密钥按接口需要设置 |
| `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` | Deepseek 评分及模拟用户 |
| `GPT_OSS_BASE_URL`、`GPT_OSS_MODEL` | GPT-oss 评分及模拟用户 |
| `TEACHER_MODEL_API_KEY` | 评分接口需要鉴权时设置 |
| `PYTHON` | Python 可执行文件，默认 `python3` |

默认只监听本机 `127.0.0.1:8000`；可用 `PORT` 修改端口。设置 `HOST=0.0.0.0` 时必须配置 `APP_ACCESS_TOKEN`。运行记录保存在 `scenario-runs/`，可用 `SCENARIO_RUNS_DIR` 改路径。

## 本地验证

```bash
npm test
python3 -m unittest -v test_eval_service.py test_scenario_eval.py
```

测试使用本地模拟模型，不需要真实模型密钥。
