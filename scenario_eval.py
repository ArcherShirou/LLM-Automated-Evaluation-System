"""Bounded, traceable multi-turn scenario evaluation for synthetic clinic cases."""

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

from openai import OpenAI


SCENARIOS_PATH = Path(__file__).with_name('scenarios.json')
RUBRIC_VERSION = 'scenario-rubric-v1'


def load_scenarios():
    scenarios = json.loads(SCENARIOS_PATH.read_text(encoding='utf-8'))
    ids = set()
    for scenario in scenarios:
        if scenario['id'] in ids or not 1 <= scenario['turns'] <= 6:
            raise ValueError('场景 ID 重复或轮次数超出范围')
        ids.add(scenario['id'])
        check_ids = [check['id'] for check in scenario['checks']]
        if len(check_ids) != len(set(check_ids)) or not check_ids:
            raise ValueError('场景检查点无效')
        if any(not check.get('evidence_terms') or not all(
                isinstance(group, list) and group and all(isinstance(term, str) and term for term in group)
                for group in check['evidence_terms']) for check in scenario['checks']):
            raise ValueError('场景检查点缺少可验证的证据词组')
        if any(event['before_turn'] < 2 or event['before_turn'] > scenario['turns']
               for event in scenario['events']):
            raise ValueError('场景事件轮次无效')
    return scenarios


def public_scenarios():
    return [{key: value for key, value in scenario.items() if key not in ('patient', 'checks')}
            for scenario in load_scenarios()]


def scenario_hash(scenario):
    payload = json.dumps(scenario, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def grade_trace(scenario, trace, judge_output):
    try:
        parsed = json.loads(judge_output)
        supplied = parsed['checks']
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError('评分器未返回有效 JSON 检查点') from exc
    if not isinstance(supplied, list):
        raise ValueError('评分器检查点格式错误')
    by_id = {item['id']: item for item in supplied if isinstance(item, dict) and 'id' in item}
    expected = {item['id'] for item in scenario['checks']}
    if len(supplied) != len(expected) or set(by_id) != expected:
        raise ValueError('评分器检查点不完整或重复')
    doctor_texts = [item['text'] for item in trace if item['role'] == 'doctor']
    checks = []
    for rule in scenario['checks']:
        item = by_id[rule['id']]
        if type(item.get('passed')) is not bool or not isinstance(item.get('evidence'), str):
            raise ValueError('评分器检查点缺少布尔结果或证据')
        evidence = item['evidence'].strip()
        # Positive findings need a verbatim quote from the tested model's own text.
        quoted = bool(evidence) and any(evidence in text for text in doctor_texts)
        terms_match = all(any(term in evidence for term in group)
                          for group in rule['evidence_terms'])
        passed = item['passed'] and quoted and terms_match
        checks.append({'id': rule['id'], 'label': rule['label'], 'weight': rule['weight'],
                       'critical': rule.get('critical', False), 'passed': passed,
                       'evidence': evidence if quoted else '',
                       'judge_passed': item['passed']})
    total = sum(item['weight'] for item in checks)
    earned = sum(item['weight'] for item in checks if item['passed'])
    critical_passed = all(item['passed'] for item in checks if item['critical'])
    score = earned / total
    if not critical_passed:
        score = min(score, 0.5)
    return {'score': round(score, 3), 'critical_passed': critical_passed,
            'needsHumanReview': any(item['judge_passed'] and not item['passed'] for item in checks),
            'checks': checks}


def transcript(trace):
    return '\n'.join(f"[{item['role']}] {item['text']}" for item in trace)


async def run_scenario(scenario, doctor_call, patient_call, judge_call, progress=None):
    trace = [{'role': 'patient', 'text': scenario['opening'], 'turn': 0}]
    if progress:
        progress({'turn': 0, 'total': scenario['turns'], 'trace': trace[-1]})
    for turn in range(1, scenario['turns'] + 1):
        for event in scenario['events']:
            if event['before_turn'] == turn:
                trace.append({'role': 'event', 'text': event['text'], 'turn': turn})
                if progress:
                    progress({'turn': turn, 'total': scenario['turns'], 'trace': trace[-1]})
        doctor_system = ('你是线上接诊助手，正在参加合成场景评测。请直接回复患者，不要提及评测。'
                         '你只知道以下公开场景信息：' + scenario['setting'])
        doctor_text = await doctor_call(doctor_system, transcript(trace))
        if not isinstance(doctor_text, str) or not doctor_text.strip():
            raise ValueError('待测模型返回空回复')
        trace.append({'role': 'doctor', 'text': doctor_text.strip()[:3000], 'turn': turn})
        if progress:
            progress({'turn': turn, 'total': scenario['turns'], 'trace': trace[-1]})
        if turn < scenario['turns']:
            patient_system = ('你只扮演一名虚构患者，用第一人称、简短中文回答接诊助手最近的问题。'
                              '仅使用以下隐藏病史，不得编造新的化验结果或诊断：' + scenario['patient'])
            patient_text = await patient_call(patient_system, transcript(trace))
            if not isinstance(patient_text, str) or not patient_text.strip():
                raise ValueError('模拟患者返回空回复')
            trace.append({'role': 'patient', 'text': patient_text.strip()[:2000], 'turn': turn})
            if progress:
                progress({'turn': turn, 'total': scenario['turns'], 'trace': trace[-1]})
    rules = [{key: value for key, value in rule.items() if key != 'weight'}
             for rule in scenario['checks']]
    judge_prompt = ('只评价 [doctor] 的实际回复。逐项输出是否满足检查点；若通过，evidence 必须逐字'
                    '引用一小段 [doctor] 原文。未通过时 evidence 设为空字符串。'
                    '只输出 JSON：{"checks":[{"id":"...","passed":true,"evidence":"..."}]}。'
                    '\n检查点：' + json.dumps(rules, ensure_ascii=False) + '\n对话轨迹：\n' + transcript(trace))
    verdict = grade_trace(scenario, trace, await judge_call('你是谨慎的医疗场景评测员。', judge_prompt))
    return {'scenarioId': scenario['id'], 'scenarioHash': scenario_hash(scenario),
            'rubricVersion': RUBRIC_VERSION, 'trace': trace, **verdict}


def model_call(base_url, model_id, api_key, provider='chat'):
    if not base_url or not model_id:
        raise ValueError('请配置待测模型与模拟/评分模型的 BASE_URL 和 MODEL')
    client = OpenAI(api_key=api_key or 'EMPTY', base_url=base_url, timeout=45.0, max_retries=1)

    async def call(system, prompt):
        def request():
            if provider == 'responses':
                response = client.responses.create(model=model_id, instructions=system, input=prompt)
                return response.output_text
            response = client.chat.completions.create(
                model=model_id, messages=[{'role': 'system', 'content': system},
                                          {'role': 'user', 'content': prompt}], max_tokens=1200)
            return response.choices[0].message.content
        return await asyncio.to_thread(request)
    return call


async def main():
    try:
        scenario_id, teacher_name = sys.argv[1:3]
        scenario = next((item for item in load_scenarios() if item['id'] == scenario_id), None)
        if not scenario or teacher_name not in ('Deepseek', 'GPT-oss'):
            raise ValueError('未知场景或模拟/评分模型')
        teacher_prefix = 'DEEPSEEK' if teacher_name == 'Deepseek' else 'GPT_OSS'
        teacher = model_call(os.environ.get(f'{teacher_prefix}_BASE_URL'),
                             os.environ.get(f'{teacher_prefix}_MODEL'),
                             os.environ.get('TEACHER_MODEL_API_KEY'),
                             'chat' if teacher_name == 'Deepseek' else 'responses')
        doctor = model_call(os.environ.get('CANDIDATE_BASE_URL'),
                            os.environ.get('CANDIDATE_MODEL'),
                            os.environ.get('CANDIDATE_API_KEY'))
        def progress(event):
            print(json.dumps({'type': 'progress', **event}, ensure_ascii=False), flush=True)
        result = await run_scenario(scenario, doctor, teacher, teacher, progress)
        result['candidateModel'] = os.environ['CANDIDATE_MODEL']
        result['teacherModel'] = os.environ[f'{teacher_prefix}_MODEL']
        print(json.dumps({'type': 'complete', 'result': result}, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False), flush=True)
        raise SystemExit(1) from exc


if __name__ == '__main__':
    asyncio.run(main())
