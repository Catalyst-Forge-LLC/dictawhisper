"""Timestamp integrity tests require no GPU, model or third-party dependencies."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('bark', Path(__file__).resolve().parents[1] / 'scripts/transcribe_bark.py')
bark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bark)


class TimingTests(unittest.TestCase):
    def test_subwords_punctuation_padding_and_window_offset(self):
        tokens = [{'token':'Hel','start':.25,'end':.5}, {'token':'lo','start':.5,'end':.7},
                  {'token':',','start':.7,'end':.7}, {'token':' um.','start':.8,'end':1.1},
                  {'token':' No','start':1.2,'end':1.4}, {'token':'.','start':1.4,'end':1.4}]
        result = bark.timed_segments('Hello, um. No.', tokens, 60, 2)
        self.assertEqual([row['text'] for row in result], ['Hello, um.', 'No.'])
        self.assertEqual(result[0]['start'], 60)
        self.assertEqual(result[0]['words'][0]['word'], 'Hello,')
        self.assertAlmostEqual(result[-1]['end'], 61.15)

    def test_never_guess_missing_or_invalid_timing(self):
        for tokens in [[], [{'token':'different','start':.25,'end':1}],
                       [{'token':'word','start':float('nan'),'end':1}],
                       [{'token':'word','start':.25,'end':100}],
                       [{'token':'word','start':2,'end':1}]]:
            with self.subTest(tokens=tokens), self.assertRaises(ValueError):
                bark.timed_segments('word', tokens, 0, 3)
        with self.assertRaises(ValueError):
            bark.timed_segments('one two', [{'token':'one','start':2,'end':2.1},{'token':' two','start':.3,'end':.4}],0,3)

    def test_passage_size_does_not_change_words_or_add_punctuation(self):
        tokens = [{'token':(' ' if i else '')+'word','start':i*.1+.25,'end':i*.1+.35} for i in range(100)]
        text = ' '.join(['word']*100)
        result = bark.timed_segments(text,tokens,0,11)
        self.assertEqual(len(result),3)
        self.assertEqual(' '.join(row['text'] for row in result),text)


if __name__ == '__main__':
    unittest.main()
