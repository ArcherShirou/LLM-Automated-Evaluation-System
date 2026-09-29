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


if __name__ == '__main__':
    unittest.main()
