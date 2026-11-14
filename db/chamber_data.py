#!/usr/bin/env python3
"""
Public-friendly puzzle metadata for the chamber UI.

This module intentionally contains NO accepted answers. The browser is allowed
to know each riddle's question, hints and flavour text so it can render the
chamber, but every answer is validated by the backend against
``db.puzzles.PUZZLES``.
"""

CHAMBER_META = {
    # ── Easy Chamber (9 riddles + sealed trial 15) ───────────────────────────────────────────────
    1: {
        'number': 'I',
        'category': 'Riddle',
        'rabbitHints': [
            'Think of something that tells you the time.',
            'Its hands point, but they never touch.',
        ],
        'queenTaunt': '“Tick tock, fool! Even my roses know the answer!”',
        'queenCorrupted': False,
    },
    2: {
        'number': 'II',
        'category': 'Riddle',
        'rabbitHints': [
            'Imagine digging into the ground.',
            'Removing more material makes the empty space larger.',
        ],
        'queenTaunt': '“Even my dungeon pit knows this one!”',
        'queenCorrupted': False,
    },
    3: {
        'number': 'III',
        'category': 'Riddle',
        'rabbitHints': [
            'You use it after a shower.',
            'It absorbs water from your skin.',
        ],
        'queenTaunt': '“A sopping riddle — even my teapot knows!”',
        'queenCorrupted': False,
    },
    4: {
        'number': 'IV',
        'category': 'Riddle',
        'rabbitHints': [
            'You probably use one to type this answer.',
            'It has letters, a space bar, and an Enter key.',
        ],
        'queenTaunt': '“You TYPE your answers on one, dimwit!”',
        'queenCorrupted': False,
    },
    5: {
        'number': 'V',
        'category': 'Riddle',
        'rabbitHints': [
            'Think of something placed on an envelope.',
            'It stays in the corner while the letter travels.',
        ],
        'queenTaunt': '“My royal mail knows every corner of this kingdom!”',
        'queenCorrupted': False,
    },
    6: {
        'number': 'VI',
        'category': 'Riddle',
        'rabbitHints': [
            'It is something you pour tea from.',
            'Its name starts and ends with the same letter.',
        ],
        'queenTaunt': '“My teapots are better company than you!”',
        'queenCorrupted': False,
    },
    7: {
        'number': 'VII',
        'category': 'Riddle',
        'rabbitHints': [
            'You wear it on your hand.',
            'It has fingers but no bones.',
        ],
        'queenTaunt': '“The White Rabbit lost his — perhaps you can find yours!”',
        'queenCorrupted': False,
    },
    8: {
        'number': 'VIII',
        'category': 'Riddle',
        'rabbitHints': [
            'It is used together with thread.',
            'Its eye is a hole for the thread to pass through.',
        ],
        'queenTaunt': '“Even my seamstresses see this answer more clearly than you!”',
        'queenCorrupted': False,
    },
    9: {
        'number': 'IX',
        'category': 'Riddle',
        'rabbitHints': [
            'You read it.',
            'It has pages and a cover.',
        ],
        'queenTaunt': '“A silent riddle for a noisy fool!”',
        'queenCorrupted': False,
    },
    15: {
        'number': 'X',
        'category': 'Riddle',
        'rabbitHints': [
            'Oh dear! The Queen has corrupted the final trial of the Easy Chamber!',
            'Her seal cannot be broken — no answer will ever be accepted here.',
        ],
        'queenTaunt': '“This last riddle is MINE, forever! You shall never answer it!”',
        'queenCorrupted': True,
    },

    # ── Medium Chamber (4 riddles + sealed trial 110) ─────────────────────────────────────────
    101: {
        'number': 'I',
        'category': 'Riddle',
        'rabbitHints': [
            'You might find one holding water or juice.',
            'It connects to a cap, not a head.',
        ],
        'queenTaunt': '“My court jesters know this — why don’t you?!”',
        'queenCorrupted': False,
    },
    102: {
        'number': 'II',
        'category': 'Riddle',
        'rabbitHints': [
            'People say it when they want your attention.',
            'It identifies you, even when you’re not there.',
        ],
        'queenTaunt': '“I know YOUR name, hacker — do you know the answer?!”',
        'queenCorrupted': False,
    },
    103: {
        'number': 'III',
        'category': 'Riddle',
        'rabbitHints': [
            'You might use one when you’re lost.',
            'It represents places without containing the real places.',
        ],
        'queenTaunt': '“Even my painted roses could navigate better than you!”',
        'queenCorrupted': False,
    },
    104: {
        'number': 'IV',
        'category': 'Riddle',
        'rabbitHints': [
            'Shout into a canyon and listen.',
            'It’s a sound that comes back to you.',
        ],
        'queenTaunt': '“ECHO! ECHO! Even my dungeon echoes the right answer!”',
        'queenCorrupted': False,
    },
    110: {
        'number': 'V',
        'category': 'Riddle',
        'rabbitHints': [
            'The Queen has corrupted the final trial of the Medium Chamber!',
            'No answer can undo her seal — this riddle was never meant to be solved.',
        ],
        'queenTaunt': '“Your final Medium trial is sealed. Bend your arm all you like — you cannot reach the answer!”',
        'queenCorrupted': True,
    },

    # ── Hard Chamber (IDs 201–205) ────────────────────────────────────────────
    201: {
        'number': 'I',
        'category': 'Riddle',
        'rabbitHints': [
            'It increases as the years pass.',
            'Think about how old you are.',
        ],
        'queenTaunt': '“Time is running out for you, hacker!”',
        'queenCorrupted': False,
    },
    202: {
        'number': 'II',
        'category': 'Logic',
        'rabbitHints': [
            'Pay attention to the words ‘all but 3’.',
            'If all except three run away, those three remain.',
        ],
        'queenTaunt': '“Even my card soldiers can count to three!”',
        'queenCorrupted': False,
    },
    203: {
        'number': 'III',
        'category': 'Riddle',
        'rabbitHints': [
            'People often say they ‘catch’ this when they get sick.',
            'It is a common illness, not an object.',
        ],
        'queenTaunt': '“I caught YOUR impertinence — that’s worse than any illness!”',
        'queenCorrupted': False,
    },
    204: {
        'number': 'IV',
        'category': 'Wordplay',
        'rabbitHints': [
            'Look carefully at the words ‘minute’ and ‘moment’.',
            'The answer is a letter found in those words, not a number.',
        ],
        'queenTaunt': '“My mushroom-smoking caterpillar friend already knows!”',
        'queenCorrupted': False,
    },
    205: {
        'number': 'V',
        'category': 'Riddle',
        'rabbitHints': [
            'The Queen has corrupted the final trial of the castle!',
            'No answer will ever pass this gate — but the flag may yet be found elsewhere.',
        ],
        'queenTaunt': '“This gate is sealed forever! Your FUTURE is OFF WITH YOUR HEAD!”',
        'queenCorrupted': True,
    },
}
