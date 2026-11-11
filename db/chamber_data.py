#!/usr/bin/env python3
"""
Public-friendly puzzle metadata for the chamber UI.

This module intentionally contains NO accepted answers. The browser is allowed
to know each riddle's question, hints and flavour text so it can render the
chamber, but every answer is validated by the backend against
``db.puzzles.PUZZLES``.
"""

CHAMBER_META = {
    # ── Easy Chamber (IDs 1–15) ───────────────────────────────────────────────
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
    10: {
        'number': 'X',
        'category': 'Riddle',
        'rabbitHints': [
            'It flows toward the sea.',
            'Its bed is made of earth, not blankets.',
        ],
        'queenTaunt': '“My kingdom has one, and it still moves faster than you!”',
        'queenCorrupted': False,
    },
    11: {
        'number': 'XI',
        'category': 'Riddle',
        'rabbitHints': [
            'You wear it on your foot.',
            'It has laces and a sole.',
        ],
        'queenTaunt': '“One of these has a tongue, and still says more sense than you!”',
        'queenCorrupted': False,
    },
    12: {
        'number': 'XII',
        'category': 'Riddle',
        'rabbitHints': [
            'It has black and white keys.',
            'You press its keys to make music.',
        ],
        'queenTaunt': '“My court musicians play one — you merely plonk at it!”',
        'queenCorrupted': False,
    },
    13: {
        'number': 'XIII',
        'category': 'Riddle',
        'rabbitHints': [
            'You find it inside a mouth.',
            'It has a crown and a root.',
        ],
        'queenTaunt': '“OFF WITH YOUR — oh, you need that one to chew!”',
        'queenCorrupted': False,
    },
    14: {
        'number': 'XIV',
        'category': 'Riddle',
        'rabbitHints': [
            'It sails on the sea.',
            'Its deck is a floor, not a pack of cards.',
        ],
        'queenTaunt': '“My royal fleet has dozens — and still none can catch you!”',
        'queenCorrupted': False,
    },
    15: {
        'number': 'XV',
        'category': 'Riddle',
        'rabbitHints': [
            'Oh dear! The Queen has corrupted the final trial of the Easy Chamber!',
            'Her seal cannot be broken — no answer will ever be accepted here.',
        ],
        'queenTaunt': '“This last riddle is MINE, forever! You shall never answer it!”',
        'queenCorrupted': True,
    },

    # ── Medium Chamber (IDs 101–110) ─────────────────────────────────────────
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
    105: {
        'number': 'V',
        'category': 'Riddle',
        'rabbitHints': [
            'You might use it to tidy your hair.',
            'Its teeth are close together, but they don’t chew.',
        ],
        'queenTaunt': '“My royal hairdresser uses one on me daily!”',
        'queenCorrupted': False,
    },
    106: {
        'number': 'VI',
        'category': 'Riddle',
        'rabbitHints': [
            'You write with it.',
            'It sits inside a wooden case, far from the mine now.',
        ],
        'queenTaunt': '“My scribes wear theirs down to nothing — as I shall do to you!”',
        'queenCorrupted': False,
    },
    107: {
        'number': 'VII',
        'category': 'Riddle',
        'rabbitHints': [
            'A whisper can break it.',
            'It is the absence of sound.',
        ],
        'queenTaunt': '“My court is never silent — mostly because you keep talking!”',
        'queenCorrupted': False,
    },
    108: {
        'number': 'VIII',
        'category': 'Riddle',
        'rabbitHints': [
            'Flip a switch and it fills the room.',
            'It casts shadows but occupies no space.',
        ],
        'queenTaunt': '“Even my darkest dungeon cannot keep this out!”',
        'queenCorrupted': False,
    },
    109: {
        'number': 'IX',
        'category': 'Riddle',
        'rabbitHints': [
            'It grows when the sun sets.',
            'It is the absence of light.',
        ],
        'queenTaunt': '“The more of it there is, the less I wish to see you!”',
        'queenCorrupted': False,
    },
    110: {
        'number': 'X',
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
