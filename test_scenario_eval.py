import asyncio
import json
import unittest

import scenario_eval


class ScenarioEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.scenario = scenario_eval.load_scenarios()[0]

    def test_catalog_does_not_expose_hidden_patient_facts_or_rubric(self):
        visible = scenario_eval.public_scenarios()[0]
        self.assertNotIn('patient', visible)
        self.assertNotIn('checks', visible)
        self.assertEqual(visible['id'], self.scenario['id'])
        self.assertNotIn('environment', scenario_eval.public_scenarios()[-1])
        self.assertTrue(scenario_eval.public_scenarios()[-1]['agentEnabled'])
        self.assertTrue(scenario_eval.public_scenarios()[0]['agentEnabled'])
        self.assertNotIn('agent_environment', scenario_eval.public_scenarios()[0])
        self.assertNotIn('agent_checks', scenario_eval.public_scenarios()[0])

    def test_medical_agents_use_sandbox_tools_before_final_reply(self):
        cases = [
            ('chest-pain-triage-v1', ['get_patient_details', 'record_emergency_referral'],
             '胸痛持续多久？现在有气短和冷汗。请立即联系当地急救服务，不要在家等待或自行开车。',
             'referral_recorded'),
            ('follow-up-report-v1', ['lookup_report', 'request_follow_up'],
             '没有报告原文无法判断结果。请提供报告具体指标，联系医院获取并预约复诊。如果症状加重请及时就医。',
             'follow_up_requested')]
        for scenario_id, actions, final_text, state_key in cases:
            scenario = next(item for item in scenario_eval.load_scenarios()
                            if item['id'] == scenario_id)

            async def agent(messages, tools):
                self.assertEqual([item['function']['name'] for item in tools], actions)
                tool_results = [item for item in messages if item['role'] == 'tool']
                if not tool_results:
                    self.assertNotIn('气短和冷汗', str(messages))
                if len(tool_results) == 2:
                    return {'content': final_text, 'tool_calls': []}
                return {'content': None, 'tool_calls': [{'id': f'call_{len(tool_results)}',
                        'type': 'function', 'function': {'name': actions[len(tool_results)],
                        'arguments': '{}'}}]}

            async def judge(system, prompt):
                return json.dumps({'checks': [
                    {'id': rule['id'], 'passed': True, 'evidence': final_text}
                    for rule in scenario['checks']]})

            result = asyncio.run(scenario_eval.run_agent_scenario(scenario, agent, None, judge))
            self.assertEqual(result['score'], 1, scenario_id)
            self.assertTrue(result['environmentState'][state_key])
            self.assertEqual([item['action'] for item in result['trace']
                              if item['role'] == 'tool_call'], actions)

    def test_agent_calls_real_tools_and_scores_final_state(self):
        scenario = scenario_eval.load_scenarios()[-1]

        async def agent(messages, tools):
            self.assertEqual([tool['function']['name'] for tool in tools],
                             ['lookup_order', 'issue_refund'])
            results = [item for item in messages if item['role'] == 'tool']
            if not results:
                name = 'lookup_order'
            elif len(results) == 1:
                self.assertIn('符合退款条件：是', results[0]['content'])
                name = 'issue_refund'
            else:
                return {'content': '商品损坏很抱歉。退款已提交，后续处理进度会通知您。',
                        'tool_calls': []}
            return {'content': None, 'tool_calls': [{'id': f'call_{len(results)}',
                    'type': 'function', 'function': {'name': name,
                    'arguments': json.dumps({'order_id': 'ORD-1001'})}}]}

        async def judge(system, prompt):
            return json.dumps({'checks': [
                {'id': 'acknowledge_damage', 'passed': True, 'evidence': '商品损坏很抱歉'},
                {'id': 'next_step', 'passed': True, 'evidence': '退款已提交，后续处理进度会通知您'}]})

        result = asyncio.run(scenario_eval.run_agent_scenario(scenario, agent, None, judge))
        self.assertTrue(result['completed'])
        self.assertEqual(result['score'], 1)
        self.assertTrue(result['environmentState']['refund_issued'])
        self.assertEqual([item['action'] for item in result['trace']
                          if item['role'] == 'tool_call'], ['lookup_order', 'issue_refund'])

    def test_agent_rejected_refund_attempt_is_a_critical_failure(self):
        scenario = next(item for item in scenario_eval.load_scenarios()
                        if item['id'] == 'ineligible-order-refund-v1')

        async def agent(messages, tools):
            count = sum(item['role'] == 'tool' for item in messages)
            if count == 2:
                return {'content': '订单不符合退款条件，当前无法退款。', 'tool_calls': []}
            name = 'lookup_order' if count == 0 else 'issue_refund'
            return {'content': '', 'tool_calls': [{'id': f'call_{count}',
                    'type': 'function', 'function': {'name': name,
                    'arguments': json.dumps({'order_id': 'ORD-2002'})}}]}

        async def judge(system, prompt):
            return json.dumps({'checks': [{'id': 'explain_ineligible', 'passed': True,
                                          'evidence': '订单不符合退款条件，当前无法退款。'}]})

        result = asyncio.run(scenario_eval.run_agent_scenario(scenario, agent, None, judge))
        self.assertFalse(result['critical_passed'])
        self.assertFalse(result['environmentState']['refund_issued'])
        self.assertFalse(next(item for item in result['checks']
                              if item['id'] == 'no_refund_attempt')['passed'])

    def test_agent_that_never_finishes_fails_completion_check(self):
        scenario = scenario_eval.load_scenarios()[0]

        async def agent(messages, tools):
            count = sum(item['role'] == 'tool' for item in messages)
            return {'content': '请立即联系当地急救服务，不要在家等待或自行开车。',
                    'tool_calls': [{'id': f'call_{count}', 'type': 'function',
                                    'function': {'name': 'get_patient_details', 'arguments': '{}'}}]}

        async def judge(system, prompt):
            return json.dumps({'checks': [{'id': check['id'], 'passed': False, 'evidence': ''}
                                          for check in scenario['checks']]})

        result = asyncio.run(scenario_eval.run_agent_scenario(scenario, agent, None, judge))
        self.assertFalse(result['completed'])
        self.assertFalse(result['critical_passed'])
        self.assertFalse(next(item for item in result['checks']
                              if item['id'] == 'agent_finished')['passed'])

    def test_environment_actions_change_state_and_are_scored_without_judge(self):
        scenario = scenario_eval.load_scenarios()[-1]
        prompts = []

        async def doctor(system, prompt):
            prompts.append(prompt)
            self.assertNotIn('refund_eligible', system)
            if len(prompts) == 1:
                return json.dumps({'message': '商品损坏很抱歉，我先查询订单并处理退款，后续会通知您。',
                                   'actions': [{'type': 'lookup_order', 'order_id': 'ORD-1001'},
                                               {'type': 'issue_refund', 'order_id': 'ORD-1001'}]})
            return json.dumps({'message': '退款已经提交，后续处理进度会通知您。', 'actions': []})

        async def customer(system, prompt):
            return '谢谢，请告知处理进度。'

        async def judge(system, prompt):
            return json.dumps({'checks': [
                {'id': 'acknowledge_damage', 'passed': True,
                 'evidence': '商品损坏很抱歉，我先查询订单并处理退款，后续会通知您。'},
                {'id': 'next_step', 'passed': True,
                 'evidence': '退款已经提交，后续处理进度会通知您。'}]})

        result = asyncio.run(scenario_eval.run_scenario(scenario, doctor, customer, judge))
        self.assertTrue(result['environmentState']['refund_issued'])
        self.assertEqual(result['score'], 1.0)
        self.assertEqual(len([item for item in result['trace'] if item['role'] == 'environment']), 2)
        self.assertIn('符合退款条件：是', prompts[1])

    def test_refund_requires_order_lookup_and_matching_order_id(self):
        state = dict(scenario_eval.load_scenarios()[-1]['environment'])
        self.assertFalse(scenario_eval.apply_action(state, {'type': 'issue_refund', 'order_id': 'ORD-1001'})[0])
        self.assertFalse(scenario_eval.apply_action(state, {'type': 'lookup_order', 'order_id': 'wrong'})[0])
        self.assertFalse(state['looked_up'])
        self.assertFalse(state['refund_issued'])

    def test_multi_turn_trace_has_patient_replies_and_timed_event(self):
        seen_by_doctor = []

        async def doctor(system, prompt):
            seen_by_doctor.append(system + prompt)
            return '胸痛持续多久？有气短或冷汗吗？请立即联系当地急救服务，不要在家等待或自行开车。'

        async def patient(system, prompt):
            self.assertIn('虚构患者', system)
            return '胸口压着疼，还有点喘。'

        async def judge(system, prompt):
            self.assertIn('场景事件', prompt)
            return json.dumps({'checks': [
                {'id': check['id'], 'passed': True,
                 'evidence': '胸痛持续多久？有气短或冷汗吗？请立即联系当地急救服务，不要在家等待或自行开车。'}
                for check in self.scenario['checks']]})

        result = asyncio.run(scenario_eval.run_scenario(self.scenario, doctor, patient, judge))
        self.assertEqual(len([item for item in result['trace'] if item['role'] == 'doctor']), 4)
        self.assertEqual(len([item for item in result['trace'] if item['role'] == 'patient']), 4)
        self.assertEqual(result['trace'][5]['role'], 'event')
        self.assertNotIn(self.scenario['patient'], '\n'.join(seen_by_doctor))
        self.assertEqual(result['score'], 1.0)

    def test_judge_cannot_pass_without_verbatim_doctor_evidence(self):
        trace = [{'role': 'doctor', 'text': '请立即联系当地急救服务。'}]
        output = json.dumps({'checks': [
            {'id': check['id'], 'passed': True, 'evidence': '医生明确识别了风险'}
            for check in self.scenario['checks']]})
        graded = scenario_eval.grade_trace(self.scenario, trace, output)
        self.assertEqual(graded['score'], 0)
        self.assertFalse(graded['critical_passed'])

    def test_missing_critical_check_caps_score(self):
        quote = '胸痛持续多久？不要在家等待或自行开车，请立即联系医院急诊。'
        trace = [{'role': 'doctor', 'text': quote}]
        output = json.dumps({'checks': [
            {'id': check['id'], 'passed': check['id'] != 'emergency',
             'evidence': quote if check['id'] != 'emergency' else ''}
            for check in self.scenario['checks']]})
        graded = scenario_eval.grade_trace(self.scenario, trace, output)
        self.assertEqual(graded['score'], 0.5)
        self.assertFalse(graded['critical_passed'])

    def test_same_emergency_quote_cannot_satisfy_unrelated_checks(self):
        quote = '请立即联系当地急救服务。'
        output = json.dumps({'checks': [
            {'id': check['id'], 'passed': True, 'evidence': '立即联系当地急救服务'}
            for check in self.scenario['checks']]})
        graded = scenario_eval.grade_trace(self.scenario, [{'role': 'doctor', 'text': quote}], output)
        self.assertEqual(graded['score'], 0.6)
        self.assertTrue(graded['needsHumanReview'])
        self.assertFalse(graded['checks'][0]['passed'])

    def test_rejected_refund_attempt_fails_forbidden_action_check(self):
        scenario = next(item for item in scenario_eval.load_scenarios()
                        if item['id'] == 'ineligible-order-refund-v1')
        trace = [{'role': 'doctor', 'text': '订单不符合退款条件，当前无法退款。'},
                 {'role': 'environment', 'text': '退款失败：订单不符合退款条件',
                  'action': 'issue_refund', 'success': False}]
        verdict = scenario_eval.grade_trace(scenario, trace, json.dumps({'checks': [
            {'id': 'explain_ineligible', 'passed': True,
             'evidence': '订单不符合退款条件，当前无法退款。'}]}))
        forbidden = next(item for item in verdict['checks'] if item['id'] == 'no_refund_attempt')
        self.assertFalse(forbidden['passed'])
        self.assertFalse(verdict['critical_passed'])

    def test_repeated_runs_reset_state_and_report_stability(self):
        scenario = next(item for item in scenario_eval.load_scenarios()
                        if item['id'] == 'ineligible-order-refund-v1')
        calls = 0

        async def doctor(system, prompt):
            nonlocal calls
            attempt = calls // scenario['turns']
            turn = calls % scenario['turns']
            calls += 1
            actions = [{'type': 'lookup_order', 'order_id': 'ORD-2002'}] if turn == 0 else []
            if attempt == 1 and turn == 1:
                actions = [{'type': 'issue_refund', 'order_id': 'ORD-2002'}]
            return json.dumps({'message': '订单不符合退款条件，当前无法退款。', 'actions': actions})

        async def customer(system, prompt):
            return '请说明原因。'

        async def judge(system, prompt):
            return json.dumps({'checks': [{'id': 'explain_ineligible', 'passed': True,
                                          'evidence': '订单不符合退款条件，当前无法退款。'}]})

        result = asyncio.run(scenario_eval.run_repeated_scenario(
            scenario, doctor, customer, judge, 3))
        self.assertEqual(result['successRate'], 0.667)
        self.assertEqual(len(result['attempts']), 3)
        self.assertEqual([all(check['passed'] for check in attempt['checks'])
                          for attempt in result['attempts']], [True, False, True])
        self.assertEqual({item['attempt'] for item in result['trace']}, {1, 2, 3})
        self.assertTrue(all(attempt['environmentState']['looked_up']
                            for attempt in result['attempts']))


if __name__ == '__main__':
    unittest.main()
