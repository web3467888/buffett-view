import datetime as dt
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('research_updater',pathlib.Path(__file__).with_name('update-research-data.py'))
updater=importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)

class LatestPERegression(unittest.TestCase):
    def setUp(self):
        self.original_today=updater.TODAY
        updater.TODAY=dt.date(2026,10,18)
        self.samples=[(f'{year}-{month:02d}-28',20) for year in (2024,2025) for month in range(1,13)]

    def tearDown(self):
        updater.TODAY=self.original_today

    def test_latest_nonpositive_or_missing_never_falls_back(self):
        for latest in (-5,0,None,float('nan')):
            with self.subTest(latest=latest):
                h=updater.history_record(self.samples+[('2026-10-16',10),('2026-10-17',latest)],'https://example.org')
                self.assertEqual(h['latestObservationDate'],'2026-10-17')
                self.assertEqual(h['end'],'2026-10-17')
                self.assertEqual(h['latestPE'],latest if updater.finite(latest) else None)
                self.assertEqual(h['count'],24)
                self.assertNotIn(10,h['value'])

    def test_month_uses_last_observation_before_positive_filter(self):
        h=updater.history_record(self.samples+[('2026-09-01',8),('2026-09-30',-2),('2026-10-16',11)],'https://example.org')
        self.assertEqual(h['count'],25)
        self.assertNotIn(8,h['value'])
        self.assertEqual(h['latestPE'],11)

    def test_latest_invalid_observation_survives_overseas_parsing(self):
        original_request=updater.request
        try:
            body=self.samples+[('2026-10-16',10),('2026-10-17','--')]
            updater.request=lambda url:{'Result':[{'DisplayData':{'resultData':{'tplData':{'result':{'chartInfo':[{'body':body}]}}}}}]}
            h=updater.get_history({'code':'TEST','market':'美股'})
            self.assertIsNone(h['latestPE'])
            self.assertEqual(h['latestObservationDate'],'2026-10-17')
        finally:
            updater.request=original_request

if __name__=='__main__':unittest.main()
