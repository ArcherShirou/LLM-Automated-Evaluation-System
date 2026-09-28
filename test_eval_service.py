import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import eval_service
import test_eval


class EvaluationTests(unittest.TestCase):
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
