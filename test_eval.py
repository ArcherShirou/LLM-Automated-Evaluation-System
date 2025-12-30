import pandas as pd
import os
import json
from tqdm import tqdm
from openai import OpenAI

# 清除系统代理，防止连接失败
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)

API_BASE = "http://192.168.1.111:23333/v1"

client = OpenAI(api_key="EMPTY", base_url=API_BASE)


def validate_excel(file_path):
    df = pd.read_excel(file_path)
    required_columns = ['id', 'instruction', 'reference', 'parent_class', 'subclass', 'model_ans', 'source']
    if not all(col in df.columns for col in required_columns):
        raise ValueError("Excel文件缺少必要字段")
    return df


def build_prompt(row):
    question = str(row['instruction'])
    answer = str(row['model_ans'])

    if pd.notna(row['reference']) and str(row['reference']).strip() != '':
        reference = str(row['reference'])
        return f"""
You are an internationally renowned medical professor.
Please score the answers of the students based on the reference answers and questions.
If the answer is correct, you will get 1 point, otherwise you will get 0 points.
You only need to output the students' answer scores.
The output example is as follows:
{{"student": 1 or 0}}

Question is : {question}
Reference answer is : {reference}
Student's answer is: {answer}

Your rate is:
without any extra explanation and output,
"""
    else:
        return f"""
You are an internationally renowned medical professor.
Please score the student's answer based on your professional knowledge and experience.
The scoring criteria are as follows:
- 1.0 point: Completely correct and comprehensive answer
- 0.8-0.9 points: Basically correct with minor omissions
- 0.5-0.7 points: Partially correct but with significant deficiencies
- 0.2-0.4 points: Basically wrong but with some correct elements
- 0.0-0.1 points: Completely wrong or irrelevant answer

Please output only the score as a number between 0 and 1.
The output example is as follows:
{{"student": 0.0 to 1.0}}

Question is : {question}
Student's answer is: {answer}

Your rate is:
without any extra explanation and output,
"""


def extract_score(output):
    try:
        if isinstance(output, str):
            result = eval(output)
        else:
            result = output
        if isinstance(result, dict) and 'student' in result:
            score = float(result['student'])
            return max(0.0, min(1.0, score))
    except:
        pass
    return 0.0


def call_teacher_model(prompt):
    try:
        response = client.chat.completions.create(
            model=client.models.list().data[0].id,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            top_p=0.8,
            max_tokens=6144
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"模型调用失败: {e}")
        return '{"student": 0.0}'


def evaluate_excel_file(file_path):
    df = validate_excel(file_path)
    print(f"共有 {len(df)} 个问题，开始逐个打分...")

    scores = []

    for i in tqdm(range(len(df)), desc="逐题评分"):
        row = df.iloc[i]
        prompt = build_prompt(row).strip()
        output = call_teacher_model(prompt)
        score = extract_score(output)
        scores.append(score)

    df["score"] = scores
    result_path = file_path.replace(".xlsx", "_scored.xlsx")
    df.to_excel(result_path, index=False)
    print(f"打分完成，结果保存在：{result_path}")

    return result_path


def main():
    file_path = "hxk-1.xlsx"
    if not os.path.exists(file_path):
        print(f"文件不存在：{file_path}")
        return

    try:
        client.models.list()  # 检查 API 是否连通
        print("模型 API 连接成功")
    except Exception as e:
        print(f"无法连接教师模型 API：{e}")
        return

    result_path = evaluate_excel_file(file_path)
    df = pd.read_excel(result_path)

    print("\n平均分:", round(df["score"].mean(), 3))
    print("最高分:", df["score"].max())
    print("最低分:", df["score"].min())


if __name__ == "__main__":
    main()

