import pandas as pd
import asyncio
import os
import re
import json
import sys
import uuid
import shutil
import time
from openai import OpenAI
from tqdm import tqdm



TEACHER_MODEL_NAME = 'GPT-oss'
# 教师模型URL
if TEACHER_MODEL_NAME == 'Deepseek':
    TEACHER_MODEL_URL = "http://192.168.1.111:23333/v1"
elif TEACHER_MODEL_NAME == 'GPT-oss':
    TEACHER_MODEL_URL = 'http://192.168.1.113:8000/v1'


def validate_excel(file_path):
    df = pd.read_excel(file_path)
    required_columns = ['id', 'instruction', 'reference', 'parent_class', 'subclass', 'model_ans', 'source']
    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        raise ValueError(f"Excel文件缺少必要字段: {', '.join(missing_columns)}")
    if len(df) == 0:
        raise ValueError("Excel文件没有数据行")
    return df


def build_prompt(row):
    question = str(row['instruction'])
    answer = str(row['model_ans'])
    # reference = str(row['reference']) if pd.notna(row['reference']) else ''
    reference = ''

    if reference.strip():
        return f"""
You are an internationally recognized medical professor with extensive experience in clinical evaluation.

Your task:
Evaluate the student's answer by comparing it with the provided reference answer, considering medical accuracy, completeness, and relevance.

Scoring rules:
- 1.0: The student's answer is medically correct, matches the reference in meaning, and contains no major omissions.
- 0.0: The student's answer is incorrect, contradicts the reference, omits essential points, or contains harmful medical misinformation.

Strict output requirements:
1. Output exactly two JSON objects in order:
   {{"student": SCORE}}
   {{"reason": "REASON"}}
2. SCORE must be either 0.0 or 1.0.
3. REASON should be concise (preferably under 150 characters) and clearly state the core basis for the score.
4. Do NOT add any other text, explanation, or formatting.
5. If unsure, make the best judgment based on medical accuracy and the reference answer.

Output format (strictly follow this):
{{"student": SCORE}}
{{"reason": "core reason, max 150 characters"}}

Question: {question}
Reference answer: {reference}
Student's answer: {answer}

"""
    else:
        return f"""
You are an internationally recognized medical professor with extensive experience in evaluating clinical answers.

Your task is to score the student's answer based on professional medical accuracy, completeness, and relevance.

Scoring criteria:
- 1.0 point: Completely correct, medically accurate, and comprehensive answer.
- 0.8–0.9 points: Basically correct with only minor omissions or slight lack of detail.
- 0.5–0.7 points: Partially correct but missing key points or containing notable inaccuracies.
- 0.2–0.4 points: Mostly incorrect but containing a few medically relevant elements.
- 0.0–0.1 points: Completely incorrect, irrelevant, or potentially misleading in a medical context.

**Strict output requirements:**
1. Output must contain exactly **two JSON objects** in the following order:
   {{"student": SCORE}}
   {{"reason": "REASON"}}
2. SCORE must be a single decimal number between 0 and 1 (inclusive), with **one decimal place**.
3. REASON should be concise (preferably under 150 characters) and clearly state the core basis for the score.
4. Do NOT add any other text, explanation, punctuation, or formatting outside these two JSON lines.
5. If unsure, make the best judgment based on the scoring criteria.

**Output format (strictly follow this, no deviation):**
{{"student": SCORE}}
{{"reason": "core reason, max 150 characters"}}

Question: {question}
Student's answer: {answer}

"""


def extract_score_and_reason(output: str):
    score = 0.0
    reason = ""

    try:
        # 先防御性截取第一组 {"student": ...}
        student_blocks = re.findall(r'\{\s*"student"\s*:\s*(0(?:\.\d)?|1(?:\.0)?)\s*\}', output)
        if student_blocks:
            score = float(student_blocks[0])  # 只取第一组

        # 再防御性截取第一组 {"reason": "..."}
        reason_blocks = re.findall(r'\{\s*"reason"\s*:\s*"([^"]*)"\s*\}', output, re.DOTALL)
        if reason_blocks:
            reason = reason_blocks[0]

        # 清理 reason：去掉多余空格和换行
        reason = re.sub(r'\s+', ' ', reason).strip()
        # 处理转义字符
        reason = reason.replace('\\"', '"').replace("\\'", "'")

        # 限制 reason 长度（150字符）
        if len(reason) > 150:
            reason = reason[:150].rstrip() + "…"

    except Exception:
        pass  # 出错就保持默认值

    return score, reason


def call_teacher_model(prompt, api_base=TEACHER_MODEL_URL, teacher_model_name=TEACHER_MODEL_NAME):
    os.environ.pop("HTTP_PROXY", None)
    os.environ.pop("HTTPS_PROXY", None)
    try:
        if teacher_model_name == 'Deepseek':
            client = OpenAI(api_key="EMPTY", base_url=api_base)
            response = client.chat.completions.create(
                model='/disk2/liweichao/DeepSeek/DeepSeek-R1',
                messages=[{"role": "user", "content": prompt}],
                temperature=0.6,
                top_p=0.8,
                max_tokens=8192
            )
            return response.choices[-1].message.content.strip()
        elif teacher_model_name == 'GPT-oss':
            client = OpenAI(api_key="EMPTY", base_url=api_base)
            response = client.responses.create(
                model="Open-Model/openai-120B",
                instructions="You are a helfpul assistant.",
                input=prompt
            )
            return response.output_text
    except Exception as e:
        print(f"调用教师模型出错: {e}")
        return '{"student": 0.0, "reason": "调用失败"}'


async def evaluate_single_question(row, api_base, teacher_model_name=TEACHER_MODEL_NAME):
    try:
        prompt = build_prompt(row)
        output = call_teacher_model(prompt.strip(), api_base, teacher_model_name)
        print("Output", output)
        score, reason = extract_score_and_reason(output)
        return score, reason, output
    except Exception as e:
        print(f"评估问题出错: {e}")
        return 0.0, "评估失败", ""


async def evaluate_file_async(file_path, file_name="file", file_type=None,
                              api_base=TEACHER_MODEL_URL, process_count=4, pbar=None, teacher_model_name=TEACHER_MODEL_NAME):
    start_time = time.time()
    try:
        df = validate_excel(file_path)
        scores = []
        reasons = []
        batch_size = 4
        semaphore = asyncio.Semaphore(min(process_count, 24))

        async def process_row(index, row):
            async with semaphore:
                score, reason, model_output = await evaluate_single_question(row, api_base, teacher_model_name)
                if pbar:
                    pbar.update(1)
                return index, score, reason, model_output

        for start in range(0, len(df), batch_size):
            end = min(start + batch_size, len(df))
            batch_rows = [(i, df.iloc[i]) for i in range(start, end)]
            tasks = [process_row(index, row) for index, row in batch_rows]
            results = await asyncio.gather(*tasks)

            results.sort(key=lambda x: x[0])

            scores.extend(score for _, score, _, _ in results)
            reasons.extend(reason for _, _, reason, _ in results)

            for index, score, reason, model_output in results:
                df.at[index, 'teacher_model_output'] = model_output
                df.at[index, 'reason'] = reason

        df['score'] = scores
        df['reason'] = reasons

        result_path = file_path.replace('.xlsx', '_scored.xlsx')

        # 计算详细统计信息
        detailed_stats = calculate_detailed_statistics(df)

        # 创建包含多个工作表的Excel文件
        with pd.ExcelWriter(result_path, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='评分数据', index=False)

            stats_data = []

            if detailed_stats['overall']:
                stats_data.append(['整体统计', '', ''])
                stats_data.append(['平均分', detailed_stats['overall']['average_score'], ''])
                stats_data.append(['总题数', detailed_stats['overall']['total_questions'], ''])
                stats_data.append(['最高分', detailed_stats['overall']['max_score'], ''])
                stats_data.append(['最低分', detailed_stats['overall']['min_score'], ''])
                stats_data.append(['', '', ''])

            if detailed_stats['by_parent_class']:
                stats_data.append(['按父类统计', '', ''])
                stats_data.append(['父类', '平均分', '题目数量'])
                for parent_class, stats in detailed_stats['by_parent_class'].items():
                    stats_data.append([parent_class, stats['average_score'], stats['count']])
                stats_data.append(['', '', ''])

            if detailed_stats['by_sub_class']:
                stats_data.append(['按子类统计', '', ''])
                stats_data.append(['子类', '平均分', '题目数量'])
                for sub_class, stats in detailed_stats['by_sub_class'].items():
                    stats_data.append([sub_class, stats['average_score'], stats['count']])

            if stats_data:
                stats_df = pd.DataFrame(stats_data, columns=['项目', '数值', '备注'])
                stats_df.to_excel(writer, sheet_name='统计报告', index=False)

        avg_score = sum(scores) / len(scores) if scores else 0
        stats = {
            "average_score": round(avg_score, 3),
            "max_score": max(scores) if scores else 0,
            "min_score": min(scores) if scores else 0,
            "total_questions": len(scores)
        }

        return result_path, scores, stats

    except Exception as e:
        raise e


def calculate_detailed_statistics(df):
    if df.empty or 'score' not in df.columns:
        return {"overall": {}, "by_parent_class": {}, "by_sub_class": {}}

    overall_stats = {
        "average_score": round(float(df['score'].mean()), 3),
        "total_questions": int(len(df)),
        "max_score": round(float(df['score'].max()), 3),
        "min_score": round(float(df['score'].min()), 3)
    }

    by_parent_class = {
        str(parent): {
            "average_score": round(float(group['score'].mean()), 3),
            "count": len(group)
        }
        for parent, group in df.groupby('parent_class') if pd.notna(parent)
    }

    by_subclass = {
        str(sub): {
            "average_score": round(float(group['score'].mean()), 3),
            "count": len(group)
        }
        for sub, group in df.groupby('subclass') if pd.notna(sub)
    }

    return {
        "overall": overall_stats,
        "by_parent_class": by_parent_class,
        "by_sub_class": by_subclass
    }


async def main():
    if len(sys.argv) < 5:
        print(json.dumps({"type": "error", "message": "用法: python eval_service.py <teacher_model> <file_path> <file_name> <file_type> [...]"}), flush=True)
        return

    # 获取教师模型参数
    teacher_model = sys.argv[1]
    
    # 设置教师模型URL
    if teacher_model == 'Deepseek':
        api_base = "http://192.168.1.111:23333/v1"
    elif teacher_model == 'GPT-oss':
        api_base = 'http://192.168.1.113:8000/v1'
    else:
        print(json.dumps({"type": "error", "message": f"不支持的教师模型: {teacher_model}"}), flush=True)
        return

    # 检查剩余参数是否为3的倍数
    remaining_args = len(sys.argv) - 2  # 减去脚本名和教师模型参数
    if remaining_args < 3 or remaining_args % 3 != 0:
        print(json.dumps({"type": "error", "message": "用法: python eval_service.py <teacher_model> <file_path> <file_name> <file_type> [...]"}), flush=True)
        return

    files_to_evaluate = [
        {
            'path': sys.argv[i],
            'name': sys.argv[i + 1],
            'type': sys.argv[i + 2]
        } for i in range(2, len(sys.argv), 3)
    ]

    total_questions = sum(len(validate_excel(f['path'])) for f in files_to_evaluate)

    with tqdm(total=total_questions, desc="Overall Progress", unit="question") as pbar:
        results = []
        for file_info in files_to_evaluate:
            result_path, scores, stats = await evaluate_file_async(
                file_info['path'], file_info['name'], file_info['type'], api_base=api_base, pbar=pbar, teacher_model_name=teacher_model
            )
            df = pd.read_excel(result_path)
            detailed_stats = calculate_detailed_statistics(df)

            completed_dir = os.path.join(os.path.dirname(__file__), 'completed-files')
            os.makedirs(completed_dir, exist_ok=True)

            base_name = os.path.splitext(file_info['name'])[0]
            unique_id = str(uuid.uuid4())[:8]
            output_filename = f"{base_name}_scored_{unique_id}.xlsx"
            output_path = os.path.join(completed_dir, output_filename)
            shutil.copy2(result_path, output_path)

            results.append({
                'fileName': file_info['name'],
                'type': file_info['type'],
                'outputPath': output_path,
                'statistics': detailed_stats
            })

        print(json.dumps({"type": "complete", "results": results}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())

