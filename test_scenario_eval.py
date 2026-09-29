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
