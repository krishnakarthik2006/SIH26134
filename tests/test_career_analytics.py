import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ai_service'))

from career_analytics import get_career_analytics, predict_education_band


class CareerAnalyticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.analytics = get_career_analytics()

    def test_preprocessing_uses_large_labeled_cohort_and_holdout(self):
        dataset = self.analytics['dataset']
        self.assertGreaterEqual(dataset['occupationRecords'], 1000)
        self.assertGreater(dataset['labeledRecords'], 700)
        self.assertGreater(dataset['trainRecords'], dataset['testRecords'])
        self.assertEqual(dataset['trainRecords'] + dataset['testRecords'], dataset['labeledRecords'])
        self.assertGreater(dataset['featureCount'], 10)

    def test_two_models_and_baseline_are_compared(self):
        models = {item['name']: item for item in self.analytics['models']}
        self.assertIn('Random Forest', models)
        self.assertIn('Gradient Boosting', models)
        self.assertIn('Majority baseline', models)
        for metrics in models.values():
            self.assertGreaterEqual(metrics['accuracy'], 0)
            self.assertLessEqual(metrics['accuracy'], 1)
            self.assertEqual(metrics['testRecords'], self.analytics['dataset']['testRecords'])
            self.assertEqual(len(metrics['perBand']), 4)

    def test_predicts_with_both_models_and_probabilities(self):
        result = predict_education_band('15-1252.00')
        self.assertEqual(result['occupation']['title'], 'Software Developers')
        self.assertEqual(result['observedEducationBand'], 'Undergraduate')
        self.assertEqual({item['model'] for item in result['predictions']}, {'Random Forest', 'Gradient Boosting'})
        for model in result['predictions']:
            self.assertTrue(model['prediction'])
            self.assertGreaterEqual(model['confidence'], 0)
            self.assertLessEqual(model['confidence'], 100)
            self.assertAlmostEqual(sum(item['probability'] for item in model['probabilities']), 100, delta=0.2)

    def test_unknown_occupation_is_rejected(self):
        with self.assertRaises(KeyError):
            predict_education_band('00-0000.00')


if __name__ == '__main__':
    unittest.main()
