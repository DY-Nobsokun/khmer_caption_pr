"""Offline checks using the same installed normalizer as the KFA runtime.

Run with the Python executable configured in local-paths.js.
"""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / 'local-paths.js').read_text().split('=', 1)[1].strip().rstrip(';'))
sys.path.insert(0, config['sitePackages'])
from khmernormalizer import normalize
from khmernormalizer.khnormal import khmer_normalize

spec = importlib.util.spec_from_file_location('caption_mapping', ROOT / 'kfa' / 'align-gemini-draft.py')
mapping = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapping)


class MappingTests(unittest.TestCase):
    def test_kfa_vowel_replacement_preserves_original_spelling_and_times(self):
        original = '\u17b2\u17d2\u1799'
        acoustic = normalize(original)
        self.assertNotEqual(khmer_normalize(original), khmer_normalize(acoustic))
        word = {'text': acoustic, 'startMs': 100, 'endMs': 320, 'confidence': .9}
        rows = mapping.map_words_to_original(original, [word])
        self.assertEqual(rows, [{**word, 'text': original, 'acousticText': acoustic}])

    def test_complete_normalization_keeps_source_text_across_multiple_anchors(self):
        originals = ['\u17b2\u17d2\u1799', 'Hello', '\u201cworld\u201d', '\uff21']
        words = [{'text': normalize(text), 'startMs': i * 200, 'endMs': i * 200 + 150}
                 for i, text in enumerate(originals)]
        rows = mapping.map_words_to_original(' '.join(originals), words)
        self.assertEqual([row['text'] for row in rows], originals)
        self.assertEqual([(row['startMs'], row['endMs']) for row in rows],
                         [(word['startMs'], word['endMs']) for word in words])

    def test_invisible_separator_is_preserved(self):
        text = '\u17b2\u17d2\u1799\u200b Hello'
        words = [{'text': normalize(text), 'startMs': 10, 'endMs': 700}]
        self.assertEqual(mapping.map_words_to_original(text, words)[0]['text'], text)

    def test_actual_missing_or_changed_words_are_rejected(self):
        for original, acoustic in [('hello world', 'hello'), ('hello world', 'hello there')]:
            with self.subTest(original=original, acoustic=acoustic):
                with self.assertRaisesRegex(ValueError, 'changed or omitted wording'):
                    mapping.map_words_to_original(original, [{'text': acoustic, 'startMs': 0, 'endMs': 100}])

    def test_grouped_normalized_spans_reuse_whole_acoustic_boundaries(self):
        # The first word ends inside a cluster; only the whole span is stable.
        def expanded(value):
            return value.replace('X', 'ab')
        words = [{'text': 'a', 'startMs': 0, 'endMs': 100},
                 {'text': 'b', 'startMs': 100, 'endMs': 200}]
        rows = mapping.map_words_to_original('X', words, expanded)
        self.assertEqual(rows[0]['text'], 'X')
        self.assertEqual((rows[0]['startMs'], rows[0]['endMs']), (0, 200))
        self.assertEqual(rows[0]['mergedAcousticWords'], 2)
        with self.assertRaisesRegex(RuntimeError, 'cancelled'):
            mapping.map_words_to_original('X', words, expanded, cancelled=lambda: True)


if __name__ == '__main__':
    unittest.main()
