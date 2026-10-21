"""Cost estimates for the Modernize proposals. Run: python -m unittest test_cost_model.py -v"""
import copy
import tempfile
import unittest
from pathlib import Path

import cost_model
import deeper_docs


class RatesFileTests(unittest.TestCase):
    def test_every_rate_has_a_source_and_a_date(self):
        rates = cost_model.load_rates()
        self.assertTrue(rates["checked"])
        self.assertIn("cloud.google.com", rates["cloud_run"]["source"])
        self.assertIn("cloud.google.com", rates["cloud_sql_postgres"]["source"])


class CostFigureTests(unittest.TestCase):
    def setUp(self):
        self.rates = cost_model.load_rates()

    def test_cloud_run_is_free_inside_the_free_tier(self):
        self.assertEqual(cost_model.cloud_run_monthly(self.rates, 100, 10), 0.0)

    def test_cloud_run_large_case(self):
        # 10,000 users x 50 requests a day x 30 days = 15 million requests a month.
        self.assertAlmostEqual(cost_model.cloud_run_monthly(self.rates, 10000, 50), 75.73, places=2)

    def test_database_tiers_step_up_with_users(self):
        self.assertEqual(cost_model.database_tier(self.rates, 100)["vcpu"], 1)
        self.assertEqual(cost_model.database_tier(self.rates, 101)["vcpu"], 2)
        self.assertEqual(cost_model.database_tier(self.rates, 50000)["vcpu"], 4)

    def test_database_cost_for_100_users(self):
        self.assertAlmostEqual(cost_model.cloud_sql_monthly(self.rates, 100), 53.99, places=2)


class ConfigurableTests(unittest.TestCase):
    def test_changing_a_rate_in_the_file_changes_the_estimate(self):
        rates = cost_model.load_rates()
        base = cost_model.cloud_sql_monthly(rates, 100)
        changed = copy.deepcopy(rates)
        changed["cloud_sql_postgres"]["per_vcpu_hour"] *= 2
        self.assertGreater(cost_model.cloud_sql_monthly(changed, 100), base)

    def test_rates_can_be_loaded_from_another_file(self):
        rates = cost_model.load_rates()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "rates.json"
            path.write_text('{"currency":"USD","checked":"2030-01-01","cloud_run":{},"cloud_sql_postgres":{},"sizing":{}}',
                            encoding="utf-8")
            self.assertEqual(cost_model.load_rates(path)["checked"], "2030-01-01")
        self.assertIn("cloud_run", rates)


class ProposalCostTests(unittest.TestCase):
    def test_containers_and_managed_database_are_costed_and_the_rest_is_not(self):
        keep, containerize, managed = deeper_docs.modernize({"findings": {}})
        self.assertFalse(any("cost" in p.lower() for p in keep["points"]))
        for proposal in (containerize, managed):
            lines = [p for p in proposal["points"] if p.startswith("Estimated Google Cloud cost")]
            self.assertEqual(len(lines), 3, proposal["id"])
        self.assertTrue(any("Not costed: AWS and Azure" in p for p in managed["points"]))

    def test_the_note_says_what_is_left_out(self):
        rates = cost_model.load_rates()
        note = cost_model.cost_note(rates)
        self.assertIn("checked 2026-10-21", note)
        self.assertIn("network", note)
        self.assertIn("Estimates, not quotes", note)


if __name__ == "__main__":
    unittest.main()


class NoTablesTests(unittest.TestCase):
    def _report(self, count):
        return {"findings": {"data.tables": {"id": "data.tables", "category": "data",
                                             "value": {"count": count, "names": []}}}}

    def test_no_tables_means_no_database_cost_and_says_so(self):
        keep, containerize, managed = deeper_docs.modernize(self._report(0))
        self.assertIn("No database tables were found", managed["points"][0])
        self.assertIn(cost_model.NO_DATABASE_LINE, managed["points"])
        self.assertFalse(any("Cloud SQL" in p for p in managed["points"]))
        self.assertEqual(len([p for p in containerize["points"] if p.startswith("Estimated Google Cloud cost")]), 3)

    def test_one_table_is_not_pluralised_wrongly(self):
        managed = deeper_docs.modernize(self._report(1))[2]
        self.assertIn("for the 1 table,", managed["points"][0])

    def test_a_true_zero_is_shown_as_zero_dollars(self):
        self.assertEqual(cost_model._usd(0.0), "$0")
        self.assertEqual(cost_model._range(0.0, 0.0), "about $0")
