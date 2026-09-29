import pandas as pd
import asyncio
import os
import json
import sys
import uuid
import shutil
import time
import math
import hashlib
from pathlib import Path
from openai import OpenAI
from tqdm import tqdm



TEACHER_MODEL_NAME = 'GPT-oss'
RUBRIC_VERSION = 'medical-rubric-2026-09'
TEACHER_MODEL_URL = os.environ.get('GPT_OSS_BASE_URL')


def validate_excel(file_path):
    df = pd.read_excel(file_path)
    required_columns = ['id', 'instruction', 'reference', 'parent_class', 'subclass', 'model_ans', 'source']
    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        raise ValueError(f"Excel文件缺少必要字段: {', '.join(missing_columns)}")
    if len(df) == 0:
        raise ValueError("Excel文件没有数据行")
    ids = df['id'].astype('string').str.strip()
    if ids.isna().any() or ids.eq('').any():
        raise ValueError("Excel文件存在空的 id")
    if ids.duplicated().any():
        raise ValueError(f"Excel文件存在重复 id: {ids[ids.duplicated()].iloc[0]}")
    return df


def build_prompt(row):
    question = str(row['instruction'])
    answer = str(row['model_ans'])
    reference = str(row['reference']) if pd.notna(row['reference']) else ''

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
    decoder = json.JSONDecoder()
    try:
        score_data, offset = decoder.raw_decode(output.lstrip())
        reason_data, end = decoder.raw_decode(output.lstrip()[offset:].lstrip())
        if output.lstrip()[offset:].lstrip()[end:].strip():
            raise ValueError("模型输出包含多余内容")
        score = score_data['student']
        reason = reason_data['reason']
    except (TypeError, KeyError, json.JSONDecodeError) as exc:
        raise ValueError("教师模型未返回有效评分和理由") from exc

    if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
        raise ValueError("教师模型评分必须是 0 到 1 之间的数字")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("教师模型未返回评分理由")
    return float(score), ' '.join(reason.split())[:150]


def call_teacher_model(prompt, api_base=TEACHER_MODEL_URL, teacher_model_name=TEACHER_MODEL_NAME):
    model_key = 'DEEPSEEK_MODEL' if teacher_model_name == 'Deepseek' else 'GPT_OSS_MODEL'
    model_id = os.environ.get(model_key)
    if not api_base or not model_id:
        raise ValueError(f'请配置模型地址和 {model_key}')
    client = OpenAI(
        api_key=os.environ.get('TEACHER_MODEL_API_KEY', 'EMPTY'),
        base_url=api_base,
        timeout=30.0,
        max_retries=2,
    )
    if teacher_model_name == 'Deepseek':
        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            top_p=0.8,
            max_tokens=8192,
        )
        return response.choices[0].message.content.strip()
    if teacher_model_name == 'GPT-oss':
        response = client.responses.create(
            model=model_id,
            instructions="You are a helpful assistant.",
            input=prompt,
        )
        return response.output_text
    raise ValueError(f"不支持的教师模型: {teacher_model_name}")


async def evaluate_single_question(row, api_base, teacher_model_name=TEACHER_MODEL_NAME):
    prompt = build_prompt(row)
    output = await asyncio.to_thread(call_teacher_model, prompt.strip(), api_base, teacher_model_name)
    score, reason = extract_score_and_reason(output)
    return score, reason, output


def review_trigger(row_id, score):
    """Choose cases worth a second call without using the first judge's prose."""
    if score <= 0.7:
        return 'low_or_borderline'
    digest = hashlib.sha256(str(row_id).encode('utf-8')).digest()
    return 'high_score_sample' if int.from_bytes(digest[:4], 'big') % 10 == 0 else None


def build_review_prompt(row):
    reference = str(row['reference']) if pd.notna(row['reference']) else ''
    return f"""Independently audit this medical answer. Identify concrete factual errors,
unsafe claims, and missing essential points. Do not assume another judge's score.
Score 0.0 or 1.0 when a reference is provided; otherwise score from 0.0 to 1.0.
Return exactly two JSON objects, with no other text:
{{"student": SCORE}}
{{"reason": "specific evidence, at most 150 characters"}}
Question: {row['instruction']}
Reference answer: {reference}
Student's answer: {row['model_ans']}"""


async def evaluate_with_review(row, api_base, teacher_model_name, agent_review=False):
    score, reason, output = await evaluate_single_question(row, api_base, teacher_model_name)
    review = {'review_score': None, 'review_reason': '', 'review_status': 'not_reviewed',
              'review_trigger': '', 'review_model_output': ''}
    trigger = review_trigger(row['id'], score) if agent_review else None
    if trigger:
        review['review_trigger'] = trigger
        try:
            second_output = await asyncio.to_thread(
                call_teacher_model, build_review_prompt(row), api_base, teacher_model_name)
            second_score, second_reason = extract_score_and_reason(second_output)
            review.update(review_score=second_score, review_reason=second_reason,
                          review_model_output=second_output,
                          review_status=('needs_human_review' if abs(score - second_score) >= 0.3
                                         else 'agreed'))
        except Exception as exc:
            review.update(review_status='review_error', review_reason=str(exc)[:150])
    return score, reason, output, review


async def evaluate_file_async(file_path, file_name="file", file_type=None,
                              api_base=TEACHER_MODEL_URL, process_count=4, pbar=None,
                              teacher_model_name=TEACHER_MODEL_NAME, agent_review=False):
    start_time = time.time()
    try:
        df = validate_excel(file_path)
        scores = []
        reasons = []
        batch_size = max(1, min(process_count, 24))

        async def process_row(index, row):
            score, reason, model_output, review = await evaluate_with_review(
                row, api_base, teacher_model_name, agent_review)
            if pbar:
                pbar.update(1)
            return index, score, reason, model_output, review

        for start in range(0, len(df), batch_size):
            end = min(start + batch_size, len(df))
            batch_rows = [(i, df.iloc[i]) for i in range(start, end)]
            tasks = [process_row(index, row) for index, row in batch_rows]
            results = await asyncio.gather(*tasks)

            results.sort(key=lambda x: x[0])

            scores.extend(result[1] for result in results)
            reasons.extend(result[2] for result in results)

            for index, score, reason, model_output, review in results:
                df.at[index, 'teacher_model_output'] = model_output
                df.at[index, 'reason'] = reason
                if agent_review:
                    for key, value in review.items():
                        df.at[index, key] = value
            print(json.dumps({
                'type': 'progress', 'file': file_type, 'progress': round(end * 100 / len(df), 1),
                'current': end, 'total': len(df), 'elapsed_time': round(time.time() - start_time, 1)
            }), flush=True)

        df['score'] = scores
        df['reason'] = reasons

        source = Path(file_path)
        result_path = str(source.with_name(f'{source.stem}_scored.xlsx'))

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
        api_base = os.environ.get('DEEPSEEK_BASE_URL')
        model_id = os.environ.get('DEEPSEEK_MODEL')
    elif teacher_model == 'GPT-oss':
        api_base = os.environ.get('GPT_OSS_BASE_URL')
        model_id = os.environ.get('GPT_OSS_MODEL')
    else:
        print(json.dumps({"type": "error", "message": f"不支持的教师模型: {teacher_model}"}), flush=True)
        return
    if not api_base or not model_id:
        print(json.dumps({"type": "error", "message": "请配置教师模型的 BASE_URL 和 MODEL 环境变量"}), flush=True)
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
                file_info['path'], file_info['name'], file_info['type'], api_base=api_base, pbar=pbar,
                teacher_model_name=teacher_model, agent_review=os.environ.get('AGENT_REVIEW') == '1'
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

        print(json.dumps({"type": "complete", "results": results, "rubricVersion": RUBRIC_VERSION,
                          "modelId": model_id}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
