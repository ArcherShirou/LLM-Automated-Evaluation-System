import asyncio
import contextlib
import io
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import eval_service
import test_eval


class EvaluationTests(unittest.TestCase):
    def test_excel_rejects_duplicate_and_empty_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.xlsx'
            required = {'instruction': 'q', 'reference': 'a', 'parent_class': 'p',
                        'subclass': 's', 'model_ans': 'x', 'source': 'test'}
            for ids in ([1, 1], [1, None]):
                with self.subTest(ids=ids):
                    pd.DataFrame([{'id': value, **required} for value in ids]).to_excel(source, index=False)
                    with self.assertRaisesRegex(ValueError, 'id'):
                        eval_service.validate_excel(source)

    def test_reference_is_used_when_present(self):
        row = {'instruction': 'question', 'reference': 'correct answer', 'model_ans': 'candidate'}
        self.assertIn('Reference answer: correct answer', eval_service.build_prompt(row))
        row['reference'] = None
        self.assertNotIn('Reference answer:', eval_service.build_prompt(row))

    def test_score_parser_rejects_invalid_results(self):
        self.assertEqual(
            eval_service.extract_score_and_reason('{"student": 0.8}\n{"reason": "a \\"quote\\""}'),
            (0.8, 'a "quote"'),
        )
        for output in ('{"student": 0.0}\n{"reason": "调用失败"} extra',
                       '{"student": 1.5}\n{"reason": "wrong"}',
                       '{"student": 0.0}'):
            with self.subTest(output=output), self.assertRaises(ValueError):
                eval_service.extract_score_and_reason(output)

    def test_failed_model_call_is_not_a_zero_score(self):
        with patch.object(eval_service, 'call_teacher_model', side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError):
                asyncio.run(eval_service.evaluate_single_question(
                    {'instruction': 'q', 'reference': 'a', 'model_ans': 'x'}, 'http://localhost/v1'))

    def test_requests_run_concurrently(self):
        barrier = threading.Barrier(2)

        def respond(*_):
            barrier.wait(timeout=2)
            return '{"student": 1.0}\n{"reason": "ok"}'

        row = {'instruction': 'q', 'reference': 'a', 'model_ans': 'a'}
        async def run():
            return await asyncio.gather(
                eval_service.evaluate_single_question(row, 'http://localhost/v1'),
                eval_service.evaluate_single_question(row, 'http://localhost/v1'),
            )

        with patch.object(eval_service, 'call_teacher_model', side_effect=respond):
            self.assertEqual([result[0] for result in asyncio.run(run())], [1.0, 1.0])

    def test_invalid_model_output_does_not_write_scored_file(self):
        data = pd.DataFrame([{'instruction': 'q', 'reference': 'a', 'model_ans': 'x'}])
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.xlsx'
            with patch.object(eval_service, 'validate_excel', return_value=data), \
                 patch.object(eval_service, 'call_teacher_model', return_value='invalid'):
                with self.assertRaises(ValueError):
                    asyncio.run(eval_service.evaluate_file_async(str(source)))
            self.assertFalse((Path(directory) / 'input_scored.xlsx').exists())

    def test_scoring_emits_progress_and_preserves_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.xlsx'
            rows = [{'id': value, 'instruction': 'q', 'reference': 'a',
                     'parent_class': 'p', 'subclass': 's', 'model_ans': 'a', 'source': 'test'}
                    for value in [2, 1]]
            pd.DataFrame(rows).to_excel(source, index=False)
            output = io.StringIO()
            with patch.object(eval_service, 'call_teacher_model',
                              return_value='{"student": 1.0}\n{"reason": "correct"}'), \
                 contextlib.redirect_stdout(output):
                result_path, scores, _ = asyncio.run(eval_service.evaluate_file_async(
                    str(source), file_type='compare', process_count=2))
            self.assertEqual(scores, [1.0, 1.0])
            self.assertIn('"progress": 100.0', output.getvalue())
            self.assertEqual(pd.read_excel(result_path)['id'].tolist(), [2, 1])

    def test_agent_review_flags_disagreement_without_changing_primary_score(self):
        row = {'id': 1, 'instruction': 'q', 'reference': 'a', 'model_ans': 'x'}
        outputs = ['{"student": 0.0}\n{"reason": "initial"}',
                   '{"student": 1.0}\n{"reason": "disagrees"}']
        with patch.object(eval_service, 'call_teacher_model', side_effect=outputs) as call:
            score, reason, _, review = asyncio.run(eval_service.evaluate_with_review(
                row, 'http://localhost/v1', 'Deepseek', agent_review=True))
        self.assertEqual((score, reason), (0.0, 'initial'))
        self.assertEqual(review['review_status'], 'needs_human_review')
        self.assertEqual(review['review_score'], 1.0)
        self.assertNotIn('initial', call.call_args_list[1].args[0])

    def test_agent_review_error_keeps_primary_score(self):
        row = {'id': 1, 'instruction': 'q', 'reference': 'a', 'model_ans': 'x'}
        with patch.object(eval_service, 'call_teacher_model', side_effect=[
                '{"student": 0.0}\n{"reason": "initial"}', 'invalid']):
            score, _, _, review = asyncio.run(eval_service.evaluate_with_review(
                row, 'http://localhost/v1', 'Deepseek', agent_review=True))
        self.assertEqual(score, 0.0)
        self.assertEqual(review['review_status'], 'review_error')

    def test_agent_review_sampling_is_deterministic(self):
        self.assertEqual(eval_service.review_trigger('case', 0.7), 'low_or_borderline')
        self.assertEqual(eval_service.review_trigger('case', 0.9),
                         eval_service.review_trigger('case', 0.9))

    def test_agent_review_is_saved_in_scored_workbook(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.xlsx'
            pd.DataFrame([{'id': 1, 'instruction': 'q', 'reference': 'a',
                           'parent_class': 'p', 'subclass': 's', 'model_ans': 'x',
                           'source': 'test'}]).to_excel(source, index=False)
            outputs = ['{"student": 0.0}\n{"reason": "initial"}',
                       '{"student": 1.0}\n{"reason": "disagrees"}']
            with patch.object(eval_service, 'call_teacher_model', side_effect=outputs), \
                 contextlib.redirect_stdout(io.StringIO()):
                result_path, scores, _ = asyncio.run(eval_service.evaluate_file_async(
                    str(source), agent_review=True))
            saved = pd.read_excel(result_path, sheet_name='评分数据')
            self.assertEqual(scores, [0.0])
            self.assertEqual(saved.loc[0, 'review_status'], 'needs_human_review')
            self.assertEqual(saved.loc[0, 'review_score'], 1.0)

    def test_legacy_score_parser_never_executes_model_output(self):
        self.assertEqual(test_eval.extract_score('{"student": 0.7}'), 0.7)
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'executed'
            payload = f'__import__("pathlib").Path({str(marker)!r}).touch()'
            with self.assertRaises(ValueError):
                test_eval.extract_score(payload)
            self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
