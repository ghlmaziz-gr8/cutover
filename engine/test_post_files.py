"""Tests for the chunked file-results sender. Run from the engine folder: python3 -m unittest test_post_files"""
import unittest

import post_files


def records(n):
    return [{"path": f"src/F{i}.java", "category": "application", "purpose": "Handles requests.", "suggestions": []} for i in range(n)]


class ChunkingTests(unittest.TestCase):
    def test_splits_into_chunks_of_at_most_200_in_order(self):
        sizes = [len(c) for c in post_files.chunks(records(450))]
        self.assertEqual(sizes, [200, 200, 50])

    def test_no_records_means_no_chunks(self):
        self.assertEqual(list(post_files.chunks([])), [])


class SendTests(unittest.TestCase):
    def test_sends_every_chunk_and_counts_the_saved_files(self):
        sent = []

        def poster(callback, analysis_id, secret, files):
            sent.append(len(files))
            return 201

        saved, problem, refused = post_files.send_all(records(450), poster, "https://api.test", "a", "s")
        self.assertEqual((saved, problem, refused), (450, None, None))
        self.assertEqual(sent, [200, 200, 50])

    def test_stops_at_the_first_refused_chunk(self):
        calls = []

        def poster(callback, analysis_id, secret, files):
            calls.append(len(files))
            return 201 if len(calls) == 1 else 413

        saved, problem, refused = post_files.send_all(records(450), poster, "https://api.test", "a", "s")
        self.assertEqual(saved, 200)
        self.assertIn("413", problem)
        self.assertEqual(refused, 413)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
