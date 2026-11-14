#!/usr/bin/env python3
"""
Server-side puzzle catalogue.

The browser receives only the question/hints; answers and coin values live here
so the score is awarded by the server, not by client-side JavaScript.
The Queen's private answer scroll reads the same authoritative catalogue.
"""

from db.chamber_data import CHAMBER_META

# The Queen seals the final trial of every chamber. These puzzles are rendered
# with the corrupted-riddle UI and POST /api/solve refuses every answer for
# them, so no player can ever solve them — not even by calling the API directly
# or editing client-side state. The flag is obtained through the intentionally
# vulnerable checkIsSolved() helper instead.
QUEEN_SEALED_PUZZLE_IDS = frozenset({15, 110, 205})

# Display order across the 20 retained trials. IDs stay stable for saved progress.
PUZZLE_ORDINALS = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    10: 15,
    11: 101,
    12: 102,
    13: 103,
    14: 104,
    15: 110,
    16: 201,
    17: 202,
    18: 203,
    19: 204,
    20: 205,
}

PUZZLES = {
    # ── Easy Chamber (9 riddles + sealed trial 15) ────────────────────────────────────────────────
    1: {
        'title': "The White Rabbit's Clock",
        'question': 'I have hands but cannot clap. I have a face but cannot smile. What am I?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['clock', 'a clock'],
    },
    2: {
        'title': "The Cheshire Cat's Grin",
        'question': 'The more you take away from me, the bigger I become. What am I?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['hole', 'a hole'],
    },
    3: {
        'title': "The Mad Hatter's Tea",
        'question': 'What gets wetter the more it dries?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['towel', 'a towel'],
    },
    4: {
        'title': 'The Locked Garden',
        'question': 'I have keys but no locks. I have space but no room. You can enter, but you cannot go outside. What am I?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['keyboard', 'a keyboard'],
    },
    5: {
        'title': "The Queen's Cards",
        'question': 'I can travel around the world while staying in one corner. What am I?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['stamp', 'a stamp'],
    },
    6: {
        'title': "The Teapot's Letter",
        'question': 'What begins with T, ends with T, and has T in it?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['teapot', 'a teapot'],
    },
    7: {
        'title': "The White Rabbit's Glove",
        'question': 'What has a thumb and four fingers but is not alive?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['glove', 'a glove'],
    },
    8: {
        'title': "The Needle's Eye",
        'question': 'What has one eye but cannot see?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['needle', 'a needle'],
    },
    9: {
        'title': 'The Silent Book',
        'question': 'What has words but never speaks?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['book', 'a book'],
    },
    15: {
        'title': "The Kettle's Beak",
        'question': 'What has a beak but no bird?',
        'difficulty': 'Easy',
        'points': 50,
        'answers': ['kettle', 'a kettle'],
    },

    # ── Medium Chamber (4 riddles + sealed trial 110) ─────────────────────────────────────────
    101: {
        'title': 'Down the Rabbit Hole',
        'question': 'What has a neck but no head?',
        'difficulty': 'Medium',
        'points': 100,
        'answers': ['bottle', 'a bottle'],
    },
    102: {
        'title': 'The Disappearing Cat',
        'question': 'What belongs to you, but other people use it more than you do?',
        'difficulty': 'Medium',
        'points': 100,
        'answers': ['your name', 'name'],
    },
    103: {
        'title': 'The Crooked Signpost',
        'question': 'What has cities but no houses, forests but no trees, and rivers but no water?',
        'difficulty': 'Medium',
        'points': 100,
        'answers': ['map', 'a map'],
    },
    104: {
        'title': 'The Talking Door',
        'question': 'I speak without a mouth and hear without ears. I have no body, but I come alive with sound. What am I?',
        'difficulty': 'Medium',
        'points': 100,
        'answers': ['echo', 'an echo'],
    },
    110: {
        'title': 'The Right Elbow',
        'question': 'What can you hold in your left hand but not in your right hand?',
        'difficulty': 'Medium',
        'points': 100,
        'answers': ['right elbow', 'your right elbow', 'elbow'],
    },

    # ── Hard Chamber (IDs 201–205) ────────────────────────────────────────────
    201: {
        'title': 'The Potion Bottle',
        'question': 'What goes up but never comes down?',
        'difficulty': 'Hard',
        'points': 200,
        'answers': ['your age', 'age'],
    },
    202: {
        'title': 'The Two Doors',
        'question': 'A farmer has 10 rabbits. All but 3 run away. How many rabbits remain?',
        'difficulty': 'Hard',
        'points': 200,
        'answers': ['3', 'three'],
    },
    203: {
        'title': 'The Mirror Room',
        'question': 'What can you catch but cannot throw?',
        'difficulty': 'Hard',
        'points': 200,
        'answers': ['a cold', 'cold'],
    },
    204: {
        'title': "The Caterpillar's Question",
        'question': 'What comes once in a minute, twice in a moment, but never in a thousand years?',
        'difficulty': 'Hard',
        'points': 200,
        'answers': ['m', 'the letter m', 'letter m'],
    },
    205: {
        'title': 'The Final Gate',
        'question': 'I am always in front of you, but you can never see me. What am I?',
        'difficulty': 'Hard',
        'points': 200,
        'answers': ['the future', 'future'],
    },
}


def normalize_answer(value: str) -> str:
    return ' '.join((value or '').strip().lower().split())


def is_correct(puzzle_id: int, answer: str) -> bool:
    puzzle = PUZZLES.get(int(puzzle_id))
    if not puzzle:
        return False
    candidate = normalize_answer(answer)
    return any(candidate == normalize_answer(a) for a in puzzle['answers'])


def points_for(puzzle_id: int) -> int:
    puzzle = PUZZLES.get(int(puzzle_id))
    return int(puzzle['points']) if puzzle else 0


def difficulty_for(puzzle_id: int) -> str:
    puzzle = PUZZLES.get(int(puzzle_id))
    if not puzzle:
        try:
            pid = int(puzzle_id)
            if pid >= 200:
                return 'hard'
            if pid >= 100:
                return 'medium'
            return 'easy'
        except (TypeError, ValueError):
            return 'easy'
    return str(puzzle.get('difficulty', 'easy')).lower()


def public_puzzle(puzzle_id: int) -> dict:
    """
    Return the part of a puzzle the browser is allowed to see.

    Accepted answers are deliberately excluded. Questions, hints and flavour
    text are safe to render; correctness is only ever decided by ``is_correct``
    on the server.
    """
    puzzle = PUZZLES[int(puzzle_id)]
    meta = CHAMBER_META.get(int(puzzle_id), {})
    return {
        'id': int(puzzle_id),
        'number': meta.get('number', ''),
        'title': puzzle['title'],
        'question': puzzle.get('question', ''),
        'difficulty': puzzle['difficulty'],
        'points': int(puzzle['points']),
        'category': meta.get('category', 'Riddle'),
        'rabbitHints': list(meta.get('rabbitHints', [])),
        'queenTaunt': meta.get('queenTaunt', ''),
        'queenCorrupted': (
            int(puzzle_id) in QUEEN_SEALED_PUZZLE_IDS
            or bool(meta.get('queenCorrupted', False))
        ),
    }


def is_queen_sealed(puzzle_id: int) -> bool:
    """True when the Queen has permanently sealed this final trial."""
    try:
        return int(puzzle_id) in QUEEN_SEALED_PUZZLE_IDS
    except (TypeError, ValueError):
        return False


def puzzle_id_for_ordinal(ordinal: int):
    """Map the public 1–20 puzzle number to the internal puzzle ID."""
    try:
        return PUZZLE_ORDINALS.get(int(ordinal))
    except (TypeError, ValueError):
        return None

