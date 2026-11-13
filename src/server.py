#!/usr/bin/env python3
"""
WonderHack — HTTP server with SQLite-backed accounts, session cookies,
server-authoritative puzzle scoring, and a live leaderboard.

Endpoints:
  POST /api/register   → create an account + session cookie
  POST /api/login      → verify password + session cookie
  POST /api/logout     → destroy the server-side session + clear cookie
  GET  /api/me         → current player and saved progression
  GET  /api/puzzles    → public puzzle catalogue (questions/hints, no answers)
  POST /api/solve      → validate an answer and award coins (once per puzzle)
  POST /api/check-is-solved → Easy-only helper that returns the sealed flag cipher
  POST /api/profile    → update display name / email / character
  GET  /api/profile?id → court dossier (intentional Hard challenge IDOR)
  GET  /ws/queen       → authenticated Queen dialogue WebSocket (intentional leak)
  POST /api/progress   → sync hint purchases (points are never client-set)
  POST /api/reset      → wipe the current player's progression
  GET  /api/leaderboard→ players ranked by saved coins (Court Administrator only)
  GET  /api/queen/answers → every riddle and its accepted answers (Queen only)
  GET  /api/cheshire    → cat's Easy-only decoding instructions (no cipher values)
  POST /api/cheshire/unlock  → buy the Cheshire Cat's 200-coin Cipher Lab pass
  GET  /api/db-status  → small health check (no credentials exposed)
"""
import base64
import codecs
import errno
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

# Allow running this file from any working directory.
_SRC_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT_DIR = os.path.dirname(_SRC_DIR)
# The root must be importable for the application, but src/ must win for the
# ``db`` package so the maintained schema in src/db is the one Python loads.
# (The script directory already puts src/ on sys.path, so the paths are
# normalised explicitly rather than relying on the ``not in`` guard.)
for _path in (_SRC_DIR, _ROOT_DIR):
    while _path in sys.path:
        sys.path.remove(_path)
sys.path.insert(0, _ROOT_DIR)
sys.path.insert(0, _SRC_DIR)

from db.init_db import init_db
from db.puzzles import (
    PUZZLES,
    difficulty_for,
    is_correct,
    is_queen_sealed,
    points_for,
    public_puzzle,
    puzzle_id_for_ordinal,
)
from db.security import hash_password, hash_token, verify_password
from hard_challenge import serve_royal_socket, verify_royal_password

PORT = int(os.environ.get('PORT', 8080))
BASE_DIR = _ROOT_DIR
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
DB_PATH = os.environ.get('WONDERHACK_DB') or os.path.join(_SRC_DIR, 'db', 'wonderhack.db')

SESSION_COOKIE = 'wh_session'
SESSION_TTL_HOURS = int(os.environ.get('SESSION_TTL_HOURS', 24 * 7))
MAX_BODY_BYTES = 64 * 1024

USERNAME_RE = re.compile(r'^[A-Za-z0-9 _.\-]{3,24}$')
DISPLAY_NAME_RE = re.compile(r"^[A-Za-z0-9 _.@'\-]{2,32}$")
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

# Privileged built-in accounts. The leaderboard belongs to the administrator;
# the answer scroll belongs to The Heart's Queen. Both checks are by username,
# never by the cosmetic display name or character.
ADMIN_USERNAME = 'admin'
QUEEN_USERNAME = 'hearts_queen'

# The Medium chamber's login form is intentionally vulnerable. The password
# field is concatenated into the lookup query on that chamber, so the classic
# payload below (typed as the password) turns the WHERE clause into a tautology
# and logs the player into the Queen's account without knowing her password —
# but only when the username names the Queen. Only the Medium login path reaches
# ``build_queen_lookup``; every other query in the registry stays parameterised,
# so Easy and Hard are immune.
MEDIUM_SQLI_PAYLOAD = re.compile(
    r"^\s*'\s*or\s+1\s*=\s*1\s*;?\s*(?:--.*)?$", re.IGNORECASE
)


# ── Hint catalogue (server-authoritative) ──────────────────────────────────
# The Mad Hatter's shop asks for the hints of the chamber the *request* came
# from (the browser's Referer), so a page can never display another chamber's
# clues. Prices are paid from that chamber's coin purse by /api/hint.
HINT_CATALOGUE = {
    'easy': {
        'openingDialogue': (
            'You say the Queen forbids you? How terribly impolite of her! '
            'But tell me, Alice… who checks the claim when the browser makes it?'
        ),
        'hints': [
            {
                'id': 'easy-hint-1',
                'number': 1,
                'title': 'The First Page',
                'cost': 0,
                'text': (
                    'Stay inside the Easy Chamber. Its page loads a small helper '
                    'the Queen forgot to guard. Inspect the page source and find '
                    'the script she trusts.'
                ),
            },
            {
                'id': 'easy-hint-2',
                'number': 2,
                'title': 'Open the Looking Glass',
                'cost': 10,
                'text': (
                    'Open the browser\'s Developer Tools and inspect the scripts '
                    'loaded by the Easy Chamber. Find where the queen checks if we '
                    'solved the puzzle or not'
                ),
            },
            {
                'id': 'easy-hint-3',
                'number': 3,
                'title': 'No Arguments Needed',
                'cost': 20,
                'text': (
                    'have you ever tried the web console? I heard it\'s pretty '
                    'fun! ;)'
                ),
            },
            {
                'id': 'easy-hint-4',
                'number': 4,
                'title': 'A Rule Written in Sand',
                'cost': 30,
                'text': (
                    'The queen trusts her functions, sometimes she doesn\'t even '
                    'use arguments!'
                ),
            },
            {
                'id': 'easy-hint-5',
                'number': 5,
                'title': 'The Sealed Flag',
                'cost': 40,
                'text': (
                    'Run isSolved() in the console while you are inside the Easy '
                    'Chamber. It returns the flag sealed behind four layers — take '
                    'that cipher to the Cheshire Cat\'s Cipher Lab and let him '
                    'guide your paws through the decoders.'
                ),
            },
        ],
    },
    'medium': {
        'openingDialogue': (
            '“Ah, the Royal Court! The Queen\'s secrets are steeped stronger '
            'than my tea, Alice.”'
        ),
        'hints': [
            {
                'id': 'medium-hint-1',
                'number': 1,
                'title': "The Queen's Account",
                'cost': 200,
                'text': (
                    'I heard from the Cheshire Cat that the flag is in the '
                    'queen\'s account.'
                ),
            },
            {
                'id': 'medium-hint-2',
                'number': 2,
                'title': 'Cold Soft Quiet Nights',
                'cost': 300,
                'text': (
                    'I really like the cold Soft Quiet nights, the moon and its '
                    'Light really helps me relax!'
                ),
            },
            {
                'id': 'medium-hint-3',
                'number': 3,
                'title': "The Queen's Username",
                'cost': 0,
                'text': "The Queen's username is 'hearts_queen'.",
            },
        ],
    },
    'hard': {
        'openingDialogue': (
            'The Queen has sewn her lips shut with a silver thread. '
            'Perhaps you should listen to the thread, Alice. Tea?'
        ),
        'hints': [
            {'id': 'hard-hint-1', 'number': 1, 'title': 'Through the Looking Proxy',
             'cost': 300, 'text': "If I were you, I'd definitely use Burp Suite! "
             "What do I know though? I'm just a Mad Hatter!"},
            {'id': 'hard-hint-2', 'number': 2, 'title': 'A Different Kind of Whisper',
             'cost': 200, 'text': 'Have you ever heard of WebSockets?'},
            {'id': 'hard-hint-3', 'number': 3, 'title': 'A Very Small Matter',
             'cost': 0, 'text': 'Who developed the modern atomic theory?'},
        ],
    },
}

# The chamber a shop / login request came from. ``easy`` is returned for the
# landing page because that is the Easy gateway; the Medium and Hard chambers
# are only recognised through their own page path.
CHAMBER_REFERER_RE = re.compile(r'/challenges/(easy|medium|hard)(?:/|$)', re.IGNORECASE)

# One flag per difficulty. The Easy flag is the one returned by the intentional
# isSolved() trust flaw; the Queen's answer scroll displays the flag for the
# chamber the players have most recently chosen.
DIFFICULTY_FLAGS = {
    'easy': 'CIC{cur10us_4l1c3}',
    'medium': 'CIC{th3_qu33n_4lw4ys_w4tch3s}',
    'hard': 'CIC{n0_rul3_1s_s4f3_1n_w0nd3rl4nd}',
}
DEFAULT_DIFFICULTY = 'easy'
ACTIVE_DIFFICULTY_KEY = 'active_difficulty'
CURRENT_SEASON_KEY = 'current_season'

# OAuth 2.0 (provider-agnostic). The sign-in button stays hidden unless every
# required variable is present, so a stock install remains username/password
# only. Nothing here trusts an unverified email or an external role claim.
OAUTH_PROVIDER_NAME = os.environ.get('OAUTH_PROVIDER_NAME', 'Wonderland SSO').strip()
OAUTH_CLIENT_ID = os.environ.get('OAUTH_CLIENT_ID', '').strip()
OAUTH_CLIENT_SECRET = os.environ.get('OAUTH_CLIENT_SECRET', '').strip()
OAUTH_AUTHORIZE_URL = os.environ.get('OAUTH_AUTHORIZE_URL', '').strip()
OAUTH_TOKEN_URL = os.environ.get('OAUTH_TOKEN_URL', '').strip()
OAUTH_USERINFO_URL = os.environ.get('OAUTH_USERINFO_URL', '').strip()
OAUTH_SCOPE = os.environ.get('OAUTH_SCOPE', 'openid email profile').strip()
OAUTH_REDIRECT_URI = os.environ.get('OAUTH_REDIRECT_URI', '').strip()
OAUTH_STATE_COOKIE = 'wh_oauth_state'
OAUTH_STATE_TTL_SECONDS = 10 * 60


def flag_for_difficulty(difficulty):
    key = (difficulty or '').strip().lower()
    return DIFFICULTY_FLAGS.get(key, DIFFICULTY_FLAGS[DEFAULT_DIFFICULTY])


def get_setting(key, default=None):
    with db_conn() as conn:
        row = conn.execute('SELECT value FROM settings WHERE key = ?', (key,)).fetchone()
    return row['value'] if row else default


def set_setting(key, value):
    with db_conn() as conn:
        conn.execute(
            'INSERT INTO settings (key, value) VALUES (?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            (key, str(value))
        )


def get_active_difficulty():
    difficulty = (get_setting(ACTIVE_DIFFICULTY_KEY, DEFAULT_DIFFICULTY) or '').strip().lower()
    return difficulty if difficulty in DIFFICULTY_FLAGS else DEFAULT_DIFFICULTY


def get_current_season():
    """The season new solves are recorded in. Older seasons stay archived."""
    try:
        return max(1, int(get_setting(CURRENT_SEASON_KEY, '1') or 1))
    except (TypeError, ValueError):
        return 1


def oauth_configured():
    return all((
        OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET,
        OAUTH_AUTHORIZE_URL,
        OAUTH_TOKEN_URL,
        OAUTH_USERINFO_URL,
    ))


def progress_by_difficulty(conn, user_id, season=None):
    """
    Count solved trials per chamber for one account.

    ``season=None`` means the current season. Totals come from the server-side
    puzzle catalogue, so the browser never has to guess them.
    """
    season = get_current_season() if season is None else int(season)
    totals = {'easy': 0, 'medium': 0, 'hard': 0}
    for puzzle_id in PUZZLES:
        totals[difficulty_for(puzzle_id)] += 1

    solved = {'easy': 0, 'medium': 0, 'hard': 0}
    rows = conn.execute(
        'SELECT puzzle_id FROM solves WHERE user_id = ? AND season = ?',
        (user_id, season)
    ).fetchall()
    for row in rows:
        difficulty = difficulty_for(row['puzzle_id'])
        if difficulty in solved:
            solved[difficulty] += 1

    return {
        key: {'solved': solved[key], 'total': totals[key]}
        for key in ('easy', 'medium', 'hard')
    }


def _record_audit(conn, admin, action, target_user=None, detail=''):
    """Append a privileged action to the administrator audit trail."""
    target_id = None
    target_name = ''
    if target_user is not None:
        target_id = target_user['id']
        target_name = target_user['username']
    conn.execute(
        '''INSERT INTO admin_audit
           (admin_id, admin_username, action, target_user_id, target_username,
            detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (admin['id'], admin.get('username', ''), action, target_id,
         target_name, detail, _now_iso())
    )


# ── Cheshire Cat's Easy cipher trail ────────────────────────────────────────
# isSolved() returns the Easy flag *sealed* behind the same four operations the
# Cipher Lab offers (Base64 Decode → Reverse Hex → ROT13 → URL Decode). The
# player takes that sealed value to the Cipher Lab, where the Cheshire Cat
# guides the Easy chamber through the layers to recover the plaintext flag.
# The plaintext flag never appears in public/; it is produced at runtime by the
# Cipher Lab decoders (and, for the Queen only, by her answer scroll).
EASY_CIPHER_PLAINTEXT = DIFFICULTY_FLAGS['easy']

# The Cheshire Cat demands every Mad Hatter hint before he will even discuss
# his laboratory, then 200 Gold Sovereigns for the key.
EASY_HINT_IDS = (
    'easy-hint-1',
    'easy-hint-2',
    'easy-hint-3',
    'easy-hint-4',
    'easy-hint-5',
)
MEDIUM_HINT_IDS = (
    'medium-hint-1',
    'medium-hint-2',
    'medium-hint-3',
)
CHESHIRE_PASS_ID = 'cheshire-cat-pass'
CHESHIRE_PASS_COST = 200

# The cat teaches the four-step operation order — but only to the Easy chamber.
# A player who opens the lab from Medium or Hard gets no instructions at all.
CHESHIRE_STEPS = [
    {
        'operation': 'base64-decode',
        'tool': 'Base64 Decode',
        'instruction': (
            'Paste the sealed flag you carried out of the Easy Chamber into the '
            'Cipher Input and choose Base64 Decode, meow!'
        ),
    },
    {
        'operation': 'reverse-hex',
        'tool': 'Reverse Hex',
        'instruction': (
            'Purr-fect! Copy the output, paste it back into the Cipher Input, '
            'and apply Reverse Hex.'
        ),
    },
    {
        'operation': 'rot13',
        'tool': 'ROT13',
        'instruction': (
            'Wonderful! Copy that result and spin it through ROT13, little Alice.'
        ),
    },
    {
        'operation': 'url-decode',
        'tool': 'URL Decode',
        'instruction': (
            'Last paw! Copy it once more and apply URL Decode. The plaintext '
            'flag will appear in your Decoded Output — read it yourself.'
        ),
    },
]


def easy_cipher_stages():
    """
    Build the four cipher layers from the Easy flag.

    stages[0] is the sealed value isSolved() returns to the player.
    stages[1..3] are the intermediate results, and stages[4] is the plaintext
    flag. The player peels the layers back in the Cipher Lab; the Cheshire Cat
    guides the Easy chamber through the operation order.
    """
    message = EASY_CIPHER_PLAINTEXT
    url_encoded = urllib.parse.quote(message, safe='')
    rot13_value = codecs.encode(url_encoded, 'rot_13')
    hex_value = rot13_value.encode('utf-8').hex()
    reversed_hex = ''.join(
        reversed([hex_value[i:i + 2] for i in range(0, len(hex_value), 2)])
    )
    sealed = base64.b64encode(reversed_hex.encode('utf-8')).decode('ascii')
    return [sealed, reversed_hex, rot13_value, url_encoded, message]


def seal_flag_for_difficulty(difficulty):
    """
    Seal a chamber's flag the way the players must undo it.

    Easy keeps its four-layer trail (Base64 → Reverse Hex → ROT13 → URL
    Decode) that the Cheshire Cat guides. Medium and Hard are sealed with just
    two layers — Base64 then ROT13 — that the player must peel off alone.

    Returns [sealed, ...intermediates..., plaintext], or None for an unknown
    chamber.
    """
    key = (difficulty or '').strip().lower()
    if key not in DIFFICULTY_FLAGS:
        return None
    if key == 'easy':
        return easy_cipher_stages()
    message = DIFFICULTY_FLAGS[key]
    rot13_value = codecs.encode(message, 'rot_13')
    sealed = base64.b64encode(rot13_value.encode('utf-8')).decode('ascii')
    return [sealed, rot13_value, message]


def is_admin_user(user):
    if not user:
        return False
    username = (user.get('username') or '').strip().lower()
    role = (user.get('role') or '').strip().lower()
    return username == ADMIN_USERNAME or 'administrator' in role


def is_queen_user(user):
    if not user:
        return False
    return (user.get('username') or '').strip().lower() == QUEEN_USERNAME


# ─────────────────────────── DB helpers ────────────────────────────────────

@contextmanager
def db_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


def _expires_iso():
    return (_now() + timedelta(hours=SESSION_TTL_HOURS)).isoformat()


def _is_expired(expires_at_str):
    try:
        return _now() > datetime.fromisoformat(expires_at_str)
    except Exception:
        return True


def _clean_username(value):
    return ' '.join((value or '').strip().split())


def _solved_ids(conn, user_id, season=None):
    season = get_current_season() if season is None else int(season)
    rows = conn.execute(
        'SELECT puzzle_id FROM solves WHERE user_id = ? AND season = ? ORDER BY puzzle_id',
        (user_id, season)
    ).fetchall()
    return [row['puzzle_id'] for row in rows]


def _json_list(raw, fallback=None):
    try:
        value = json.loads(raw or '[]')
        return value if isinstance(value, list) else (fallback or [])
    except Exception:
        return fallback or []


def user_to_public(user, conn=None, solved=None):
    """Strip secrets and expose progress in the shapes the frontend expects."""
    public = {k: v for k, v in dict(user).items()
              if k not in ('password', 'password_hash')}

    if solved is None:
        solved = _solved_ids(conn, user['id']) if conn is not None else _json_list(
            public.get('solved_puzzles')
        )

    public['solved_puzzles'] = solved
    public['solvedPuzzles'] = solved
    public['solvedCount'] = len(solved)
    public['purchased_hints'] = _json_list(public.get('purchased_hints'))
    public['purchasedHints'] = public['purchased_hints']
    public['points_easy'] = int(public.get('points_easy') or 0)
    public['points_medium'] = int(public.get('points_medium') or 0)
    public['points_hard'] = int(public.get('points_hard') or 0)
    public['pointsByDifficulty'] = {
        'easy': public['points_easy'],
        'medium': public['points_medium'],
        'hard': public['points_hard'],
    }
    public['points'] = int(public.get('points') or 0)
    public['displayName'] = public.get('display_name') or public.get('username')
    public['isAdmin'] = is_admin_user(public)
    public['isQueen'] = is_queen_user(public)
    public['courtId'] = 0 if public['isAdmin'] else (1 if public['isQueen'] else user['id'] + 2)
    public['progressByDifficulty'] = (
        progress_by_difficulty(conn, user['id']) if conn is not None else {
            'easy': {'solved': len([p for p in solved if difficulty_for(p) == 'easy']),
                     'total': sum(1 for p in PUZZLES if difficulty_for(p) == 'easy')},
            'medium': {'solved': len([p for p in solved if difficulty_for(p) == 'medium']),
                       'total': sum(1 for p in PUZZLES if difficulty_for(p) == 'medium')},
            'hard': {'solved': len([p for p in solved if difficulty_for(p) == 'hard']),
                     'total': sum(1 for p in PUZZLES if difficulty_for(p) == 'hard')},
        }
    )
    public['season'] = get_current_season()
    return public


def medium_sqli_queen_login(username_input, password_input):
    """
    Intentionally vulnerable login for the Medium chamber only.

    In Medium, the Queen's login query is built by string concatenation:

        SELECT * FROM users WHERE username = '<username>' AND password = '<password>'

    The player types the Queen's username, ``hearts_queen``, and puts the
    payload ``' OR 1=1;`` in the password field. The payload closes the password
    literal and turns the rest of the WHERE clause into a tautology, so the
    password comparison is bypassed and the Queen's account is matched without
    knowing her real passphrase.

    The injection is only reached from ``_handle_login`` when the request came
    from the Medium chamber, and it only resolves to the Queen: any other
    username falls back to the safe parameterised lookup, and Easy and Hard
    never execute this path at all.

    Returns the Queen's user row, or None when the payload was not used or the
    username is not the Queen's.
    """
    return build_queen_lookup(username_input, password_input)


def build_queen_lookup(username_input, password_input):
    """
    Execute the Medium chamber's concatenated lookup.

    This is the literal query the vulnerable login builds when the player
    enters ``hearts_queen`` / ``' OR 1=1;``:

        SELECT * FROM users WHERE username = 'hearts_queen' AND password = '' OR 1=1

    The payload is supplied by the player in the password field and the rows it
    returns decide which account the login resolves to. The injection is only
    reached from ``_handle_login`` when the request came from the Medium chamber
    AND the username names the Queen, so no other account and no other chamber
    can be reached.

    A read-only connection is used so the injection cannot mutate the registry.
    """
    payload = _clean_username(password_input)
    if not MEDIUM_SQLI_PAYLOAD.match(payload):
        return None

    # The Queen's account is the only one the injection works against. Any
    # other username never reaches the concatenated query.
    if _clean_username(username_input).lower() != QUEEN_USERNAME:
        return None

    # The payload already closes the string literal, so it is concatenated as
    # the password value; a trailing ``;`` / ``--`` terminator is removed
    # because the login's query runner only executes the first complete
    # statement.
    tail = payload.strip()
    while True:
        stripped = tail.rstrip()
        if stripped.endswith(';'):
            tail = stripped[:-1].rstrip()
        elif stripped.endswith('--'):
            tail = stripped[:-2].rstrip()
        else:
            tail = stripped
            break

    # The Queen's lookup query, built exactly as the vulnerable chamber does.
    # The username value is the validated Queen's name; the password value is
    # the raw payload.
    query = (
        "SELECT * FROM users WHERE username = '" + QUEEN_USERNAME
        + "' AND password = '" + tail
    )

    uri_path = f'file:{DB_PATH}?mode=ro'
    conn = sqlite3.connect(uri_path, uri=True, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        rows = [dict(row) for row in conn.execute(query).fetchall()]
    finally:
        conn.close()

    # The tautology matches every row; the login resolves to the Queen's
    # account, whose password comparison is bypassed.
    for row in rows:
        if (row.get('username') or '').strip().lower() == QUEEN_USERNAME:
            return row
    return rows[0] if rows else None


def record_queen_login(user_id):
    """Update the Queen's login timestamp after a successful injection."""
    now = _now_iso()
    with db_conn() as conn:
        conn.execute(
            'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?',
            (now, now, user_id)
        )


def find_user_by_credentials(username_input, password_input):
    clean_user = _clean_username(username_input).lower()
    password = password_input or ''
    if not clean_user or not password:
        return None

    with db_conn() as conn:
        row = conn.execute(
            'SELECT * FROM users WHERE LOWER(username) = ?',
            (clean_user,)
        ).fetchone()
        if not row:
            # Convenience: allow logging in with the display name shown on the
            # leaderboard, but always prefer the unique username column.
            row = conn.execute(
                'SELECT * FROM users WHERE LOWER(display_name) = ?',
                (clean_user,)
            ).fetchone()
        if not row:
            return None

        user = dict(row)
        stored_hash = user.get('password_hash') or ''
        valid = verify_password(stored_hash, password)

        # Upgrade a legacy plaintext password on successful login.
        if valid and not stored_hash and user.get('password'):
            conn.execute(
                'UPDATE users SET password_hash = ?, password = ?, updated_at = ? WHERE id = ?',
                (hash_password(password), '', _now_iso(), user['id'])
            )
            user['password_hash'] = 'migrated'

        if not valid:
            return None

        conn.execute(
            'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?',
            (_now_iso(), _now_iso(), user['id'])
        )
        return user


def create_session(user_id, user_agent='', ip_address='', hard_queen_access=False):
    token = secrets.token_urlsafe(32)
    session_hash = hash_token(token)
    with db_conn() as conn:
        conn.execute(
            '''INSERT INTO sessions
               (session_hash, user_id, created_at, expires_at, last_seen_at,
                user_agent, ip_address, hard_queen_access)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (session_hash, user_id, _now_iso(), _expires_iso(), _now_iso(),
             (user_agent or '')[:255], (ip_address or '')[:64], int(hard_queen_access))
        )
    return token


def get_session_user(token):
    if not token:
        return None
    session_hash = hash_token(token)
    with db_conn() as conn:
        row = conn.execute(
            '''SELECT u.*, s.expires_at AS _sess_exp, s.hard_queen_access AS _hard_queen_access
               FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.session_hash = ?''',
            (session_hash,)
        ).fetchone()
        if not row:
            return None

        user = dict(row)
        if _is_expired(user.pop('_sess_exp', '')):
            conn.execute('DELETE FROM sessions WHERE session_hash = ?', (session_hash,))
            return None

        conn.execute(
            'UPDATE sessions SET last_seen_at = ? WHERE session_hash = ?',
            (_now_iso(), session_hash)
        )
        user['_session_hash'] = session_hash
        return user


def delete_session(token):
    if not token:
        return
    with db_conn() as conn:
        conn.execute('DELETE FROM sessions WHERE session_hash = ?',
                     (hash_token(token),))


def purge_expired_sessions():
    with db_conn() as conn:
        conn.execute('DELETE FROM sessions WHERE expires_at < ?', (_now_iso(),))


# ─────────────────────────── Cookie helpers ────────────────────────────────

def parse_cookies(cookie_header):
    cookies = {}
    for part in (cookie_header or '').split(';'):
        if '=' in part:
            key, value = part.strip().split('=', 1)
            cookies[key.strip()] = value.strip()
    return cookies


def make_session_cookie(token, secure=False, clear=False):
    cookie = f'{SESSION_COOKIE}='
    if not clear and token:
        cookie += token
    cookie += '; Path=/; HttpOnly; SameSite=Lax'
    if secure:
        cookie += '; Secure'
    cookie += '; Max-Age=0' if clear else f'; Max-Age={SESSION_TTL_HOURS * 3600}'
    return cookie


# ─────────────────────────── Request Handler ───────────────────────────────

class WonderHackHandler(http.server.SimpleHTTPRequestHandler):
    server_version = 'WonderHack/2.0'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        """
        Never let a browser (or a proxy) hold on to a page document.

        SimpleHTTPRequestHandler sends ``Last-Modified`` and honours conditional
        GETs, which lets Chrome/Edge restore an old DOM snapshot from the HTTP
        cache or the back/forward cache — the edit appears for a moment and then
        flips back to the previous markup. HTML documents therefore go out with
        ``no-store`` so every navigation is a fresh read from ``public/``.
        Static assets keep their normal caching (they are versioned with ?v=).
        """
        path = urllib.parse.urlparse(self.path).path.lower()
        if path.endswith(('.html', '.htm', '/')):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    # ── helpers ─────────────────────────────────────────────────────────────

    def _get_session_id(self):
        return parse_cookies(self.headers.get('Cookie', '')).get(SESSION_COOKIE)

    def _secure_cookie(self):
        proto = (self.headers.get('X-Forwarded-Proto') or '').split(',')[0].strip()
        return proto.lower() == 'https'

    def _client_ip(self):
        forwarded = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
        return forwarded or (self.client_address[0] if self.client_address else '')

    def _chamber_from_referer(self):
        """
        Which chamber page did this request come from?

        The browser sends the current page in the Referer header, and scripts
        cannot forge it. ``easy`` is returned for the landing page because that
        is the Easy gateway. Any other page — including the Medium and Hard
        chambers — is not allowed to use the isSolved() shortcut.
        """
        referer = self.headers.get('Referer')
        if not referer:
            return None
        path = urllib.parse.urlparse(referer).path.lower()
        match = CHAMBER_REFERER_RE.search(path)
        if match:
            return match.group(1).lower()
        if path in ('', '/', '/index.html'):
            return 'easy'
        return None

    def _get_body(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            length = 0
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode('utf-8'))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _send_json(self, data, status=200, extra_headers=None):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _optional_user(self):
        return get_session_user(self._get_session_id())

    def _require_session(self):
        user = self._optional_user()
        if not user:
            self._send_json(
                {'success': False, 'error': 'Not authenticated. Please log in.'},
                401
            )
        return user

    def _require_admin(self, message=None):
        user = self._require_session()
        if not user:
            return None
        if not is_admin_user(user):
            self._send_json({
                'success': False,
                'error': message or (
                    'By royal decree, this action is sealed to all but the '
                    'Court Administrator.'
                )
            }, 403)
            return None
        return user

    def _require_queen(self):
        user = self._require_session()
        if not user:
            return None
        if not is_queen_user(user):
            self._send_json({
                'success': False,
                'error': "The Queen's answer scroll is sealed to all but The Heart's Queen."
            }, 403)
            return None
        return user

    def _set_cookie_headers(self, token):
        return {'Set-Cookie': make_session_cookie(token, self._secure_cookie())}

    def _clear_cookie_headers(self):
        return {'Set-Cookie': make_session_cookie(None, self._secure_cookie(), clear=True)}

    # ── OAuth helpers (provider-agnostic, disabled unless configured) ──────

    def _base_url(self):
        host = (
            self.headers.get('X-Forwarded-Host')
            or self.headers.get('Host')
            or 'localhost:8080'
        ).split(',')[0].strip()
        proto = (self.headers.get('X-Forwarded-Proto') or '').split(',')[0].strip().lower()
        if proto not in ('http', 'https'):
            proto = 'https' if self._secure_cookie() else 'http'
        return f'{proto}://{host}'

    def _oauth_redirect_uri(self):
        return OAUTH_REDIRECT_URI or f'{self._base_url()}/api/oauth/callback'

    def _oauth_state_secret(self):
        return get_setting('oauth_state_secret', '') or ''

    def _sign_oauth_state(self, payload):
        secret = self._oauth_state_secret().encode('utf-8')
        return hmac.new(secret, payload.encode('utf-8'), hashlib.sha256).hexdigest()

    def _make_oauth_state(self):
        payload = f'{secrets.token_urlsafe(24)}.{int(time.time())}'
        return f'{payload}.{self._sign_oauth_state(payload)}'

    def _verify_oauth_state(self, value):
        try:
            nonce, issued, signature = (value or '').split('.', 2)
            issued = int(issued)
        except (TypeError, ValueError):
            return False
        if abs(time.time() - issued) > OAUTH_STATE_TTL_SECONDS:
            return False
        expected = self._sign_oauth_state(f'{nonce}.{issued}')
        return hmac.compare_digest(expected, signature)

    def _oauth_state_cookie(self, value, clear=False):
        cookie = f'{OAUTH_STATE_COOKIE}='
        if not clear and value:
            cookie += value
        cookie += '; Path=/; HttpOnly; SameSite=Lax'
        if self._secure_cookie():
            cookie += '; Secure'
        cookie += '; Max-Age=0' if clear else f'; Max-Age={OAUTH_STATE_TTL_SECONDS}'
        return cookie

    def _redirect(self, location, cookies=None):
        self.send_response(302)
        self.send_header('Location', location)
        self.send_header('Cache-Control', 'no-store')
        for cookie in (cookies or []):
            self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _oauth_exchange_code(self, code):
        body = urllib.parse.urlencode({
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': self._oauth_redirect_uri(),
            'client_id': OAUTH_CLIENT_ID,
            'client_secret': OAUTH_CLIENT_SECRET,
        }).encode('utf-8')
        request = urllib.request.Request(
            OAUTH_TOKEN_URL,
            data=body,
            method='POST',
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode('utf-8', 'replace')
            content_type = response.headers.get('Content-Type', '')
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = dict(urllib.parse.parse_qsl(raw))
        if not isinstance(payload, dict) or not payload.get('access_token'):
            raise ValueError('The identity provider did not return an access token.')
        return payload['access_token']

    def _oauth_fetch_profile(self, access_token):
        request = urllib.request.Request(
            OAUTH_USERINFO_URL,
            headers={
                'Authorization': f'Bearer {access_token}',
                'Accept': 'application/json',
            },
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode('utf-8', 'replace')
        try:
            payload = json.loads(raw)
        except ValueError as exc:
            raise ValueError('The identity provider returned an invalid profile.') from exc
        if not isinstance(payload, dict):
            raise ValueError('The identity provider returned an invalid profile.')
        return payload

    @staticmethod
    def _oauth_subject(profile):
        for key in ('sub', 'user_id', 'userId', 'id', 'login', 'username'):
            value = profile.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()[:191]
        return ''

    @staticmethod
    def _oauth_email_verified(profile):
        value = profile.get('email_verified', profile.get('verified_email'))
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ('true', '1', 'yes')
        return False

    def _oauth_find_or_create_user(self, subject, email, email_verified, display_name):
        """Map an external subject to a local account (create on first use)."""
        now = _now_iso()
        with db_conn() as conn:
            row = conn.execute(
                'SELECT * FROM users WHERE oauth_subject = ?', (subject,)
            ).fetchone()
            if row:
                conn.execute(
                    'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?',
                    (now, now, row['id'])
                )
                return dict(row)

            # Link an existing local account only when the provider confirms the
            # email address. An unverified email never gains access to an account.
            if email and email_verified:
                row = conn.execute(
                    '''SELECT * FROM users
                       WHERE LOWER(email) = LOWER(?) AND oauth_subject = '' ''',
                    (email,)
                ).fetchone()
                if row:
                    conn.execute(
                        '''UPDATE users
                           SET oauth_subject = ?, last_login_at = ?, updated_at = ?
                           WHERE id = ?''',
                        (subject, now, now, row['id'])
                    )
                    return dict(conn.execute(
                        'SELECT * FROM users WHERE id = ?', (row['id'],)
                    ).fetchone())

            base = re.sub(
                r'[^A-Za-z0-9_.\-]', '',
                (display_name or (email.split('@')[0] if email else '') or 'wanderer')
            )[:20]
            if len(base) < 3:
                base = f'{base or "wanderer"}-sso'
            base = base[:20]
            username = base
            suffix = 1
            while conn.execute(
                'SELECT id FROM users WHERE LOWER(username) = LOWER(?)', (username,)
            ).fetchone():
                suffix += 1
                username = f'{base[:24 - len(str(suffix)) - 1]}-{suffix}'

            display = (display_name or username).strip()[:32] or username
            conn.execute(
                '''INSERT INTO users
                   (username, display_name, password, password_hash, email, role,
                    character, points, points_easy, points_medium, points_hard,
                    solved_puzzles, purchased_hints, oauth_subject,
                    created_at, updated_at, last_login_at)
                   VALUES (?, ?, '', '', ?, ?, 'alice', 0, 0, 0, 0, '[]', '[]', ?, ?, ?, ?)''',
                (username, display, email, 'Royal Voyager of the Keyhole',
                 subject, now, now, now)
            )
            user_id = conn.execute(
                'SELECT last_insert_rowid() AS id'
            ).fetchone()['id']
            return dict(conn.execute(
                'SELECT * FROM users WHERE id = ?', (user_id,)
            ).fetchone())

    def _handle_oauth_status(self):
        enabled = oauth_configured()
        self._send_json({
            'success': True,
            'enabled': enabled,
            'provider': OAUTH_PROVIDER_NAME if enabled else '',
            'startUrl': '/api/oauth/start' if enabled else '',
        })

    def _handle_oauth_start(self):
        if not oauth_configured():
            self._redirect('/login.html?oauth=disabled')
            return
        state = self._make_oauth_state()
        separator = '&' if '?' in OAUTH_AUTHORIZE_URL else '?'
        location = OAUTH_AUTHORIZE_URL + separator + urllib.parse.urlencode({
            'response_type': 'code',
            'client_id': OAUTH_CLIENT_ID,
            'redirect_uri': self._oauth_redirect_uri(),
            'scope': OAUTH_SCOPE,
            'state': state,
        })
        self._redirect(location, [self._oauth_state_cookie(state)])

    def _handle_oauth_callback(self):
        clear_state = self._oauth_state_cookie(None, clear=True)
        if not oauth_configured():
            self._redirect('/login.html?oauth=disabled', [clear_state])
            return

        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        state = (query.get('state') or [''])[0]
        code = (query.get('code') or [''])[0]
        cookie_state = parse_cookies(self.headers.get('Cookie', '')).get(OAUTH_STATE_COOKIE, '')

        if query.get('error'):
            self._redirect('/login.html?oauth=denied', [clear_state])
            return
        if (not code or not state or state != cookie_state
                or not self._verify_oauth_state(state)):
            self._redirect('/login.html?oauth=invalid_state', [clear_state])
            return

        try:
            access_token = self._oauth_exchange_code(code)
            profile = self._oauth_fetch_profile(access_token)
        except Exception as exc:  # network / provider errors are not fatal
            print(f'[oauth] provider error: {exc}')
            self._redirect('/login.html?oauth=provider_error', [clear_state])
            return

        subject = self._oauth_subject(profile)
        if not subject:
            self._redirect('/login.html?oauth=invalid_profile', [clear_state])
            return

        email = str(profile.get('email') or '').strip()
        display_name = str(
            profile.get('name')
            or profile.get('display_name')
            or profile.get('preferred_username')
            or profile.get('login')
            or ''
        ).strip()

        try:
            user = self._oauth_find_or_create_user(
                subject, email, self._oauth_email_verified(profile), display_name
            )
        except sqlite3.IntegrityError as exc:
            print(f'[oauth] account link failed: {exc}')
            self._redirect('/login.html?oauth=account_error', [clear_state])
            return

        token = create_session(
            user['id'], self.headers.get('User-Agent', ''), self._client_ip()
        )
        self._redirect(
            '/puzzles.html?welcome=1',
            [clear_state, make_session_cookie(token, self._secure_cookie())],
        )


    # ── CORS / OPTIONS (same-origin app) ────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Allow', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # ── GET ─────────────────────────────────────────────────────────────────

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == '/ws/queen':
            self._handle_royal_socket()
        elif path == '/api/profile':
            self._handle_profile_lookup()
        elif path == '/api/me':
            self._handle_me()
        elif path == '/api/leaderboard':
            self._handle_leaderboard()
        elif path == '/api/puzzles':
            self._handle_puzzles()
        elif path == '/api/queen/answers':
            self._handle_queen_answers()
        elif path == '/api/queen/flag':
            self._handle_queen_flag()
        elif path == '/api/cheshire':
            self._handle_cheshire()
        elif path == '/api/hints':
            self._handle_hints()
        elif path == '/api/admin/players':
            self._handle_admin_players()
        elif path == '/api/admin/solves':
            self._handle_admin_solves()
        elif path == '/api/admin/audit':
            self._handle_admin_audit()
        elif path == '/api/oauth/status':
            self._handle_oauth_status()
        elif path == '/api/oauth/start':
            self._handle_oauth_start()
        elif path == '/api/oauth/callback':
            self._handle_oauth_callback()
        elif path == '/api/db-status':
            self._handle_db_status()
        elif path.startswith('/api/'):
            self._send_json({'success': False, 'error': 'Unknown endpoint.'}, 404)
        else:
            super().do_GET()

    def _handle_royal_socket(self):
        user = self._require_session()
        if not user:
            return
        origin = urllib.parse.urlparse(self.headers.get('Origin', ''))
        if origin.netloc != self.headers.get('Host') or origin.scheme not in ('http', 'https'):
            self._send_json({'error': 'This looking glass belongs to this court.'}, 403)
            return
        serve_royal_socket(self, lambda: get_session_user(self._get_session_id()))

    def _handle_profile_lookup(self):
        """INTENTIONAL IDOR: public court IDs expose another player's dossier.

        Court IDs reserve 0 for admin and 1 for Queen, independently of legacy
        SQLite IDs. Only safe dossier fields are returned; no login credentials.
        """
        viewer = self._require_session()
        if not viewer:
            return
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        raw_id = (query.get('id') or [''])[0]
        if not re.fullmatch(r'0|[1-9][0-9]{0,9}', raw_id):
            self._send_json({'error': 'The court requires a numeric dossier ID.'}, 400)
            return
        court_id = int(raw_id)
        if court_id == 0:
            self._send_json({'error': 'The Court Administrator dossier is sealed.'}, 403)
            return
        with db_conn() as conn:
            if court_id == 1:
                row = conn.execute('SELECT * FROM users WHERE username = ?', (QUEEN_USERNAME,)).fetchone()
            else:
                row = conn.execute('SELECT * FROM users WHERE id = ?', (court_id - 2,)).fetchone()
            if not row or is_admin_user(dict(row)):
                self._send_json({'error': 'No such court dossier.'}, 404)
                return
            if court_id != 1 and is_queen_user(dict(row)):
                self._send_json({'error': 'No such court dossier.'}, 404)
                return
            self._send_json({'success': True, 'profile': {
                'id': court_id, 'username': row['username'],
                'displayName': row['display_name'], 'email': row['email'],
                'role': row['role'], 'character': row['character'],
                'motto': 'Every whisper in this court belongs to ME!' if court_id == 1
                         else 'Curiouser and curiouser.',
            }})

    def _hard_scroll_allowed(self, user, difficulty):
        if difficulty != 'hard' or user.get('_hard_queen_access'):
            return True
        self._send_json({'success': False, 'error':
                         'The Inner Sanctum requires the Queen’s own hard-chamber password. '
                         'Return to the Hard login gate.'}, 403)
        return False

    def _handle_me(self):
        user = self._require_session()
        if not user:
            return
        with db_conn() as conn:
            fresh = conn.execute('SELECT * FROM users WHERE id = ?',
                                 (user['id'],)).fetchone()
            self._send_json({
                'success': True,
                'user': user_to_public(fresh, conn),
            })

    def _handle_puzzles(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        requested = (query.get('difficulty') or [''])[0].strip().lower()

        if requested in ('easy', 'medium', 'hard'):
            allowed = {pid for pid, p in PUZZLES.items()
                       if str(p.get('difficulty', '')).lower() == requested}
        else:
            allowed = set(PUZZLES)

        catalogue = [
            public_puzzle(puzzle_id)
            for puzzle_id in sorted(allowed)
        ]
        self._send_json({'success': True, 'puzzles': catalogue})

    def _handle_queen_answers(self):
        """Full answer key for The Heart's Queen. Never exposed publicly."""
        user = self._require_queen()
        if not user:
            return

        active_difficulty = 'hard' if user.get('_hard_queen_access') else get_active_difficulty()
        if not self._hard_scroll_allowed(user, active_difficulty):
            return
        answers = [
            {
                'id': puzzle_id,
                'title': puzzle['title'],
                'question': puzzle.get('question', ''),
                'difficulty': puzzle['difficulty'],
                'points': int(puzzle['points']),
                'answers': list(puzzle['answers']),
            }
            for puzzle_id, puzzle in sorted(PUZZLES.items())
        ]
        self._send_json({
            'success': True,
            # The scroll never shows a plaintext flag: every chamber's flag is
            # sealed and must be decoded in the Cipher Lab (Easy with the cat's
            # guidance; Medium and Hard alone).
            'flag': seal_flag_for_difficulty(active_difficulty)[0],
            'sealed': True,
            'difficulty': active_difficulty,
            'puzzles': answers,
        })

    def _handle_queen_flag(self):
        """
        Lightweight flag polling endpoint for the Queen's answer scroll.

        The value changes whenever a player selects a chamber, so the scroll can
        refresh the royal flag without re-downloading the whole answer key.
        """
        user = self._require_queen()
        if not user:
            return

        active_difficulty = 'hard' if user.get('_hard_queen_access') else get_active_difficulty()
        if not self._hard_scroll_allowed(user, active_difficulty):
            return
        self._send_json({
            'success': True,
            'difficulty': active_difficulty,
            'flag': seal_flag_for_difficulty(active_difficulty)[0],
            'sealed': True,
        })

    def _lab_chamber(self, query=None):
        """
        Which chamber is the Cipher Lab serving right now?

        The lab page is reached as ``challenge.html?from=<chamber>``. A chamber
        page Referer wins; otherwise the lab page's own ``from``/``difficulty``
        parameter decides, then the API request's own query. Returns the chamber
        or None when it cannot be told.
        """
        chamber = self._chamber_from_referer()
        if chamber in ('easy', 'medium', 'hard'):
            return chamber
        referer = self.headers.get('Referer') or ''
        parsed = urllib.parse.urlparse(referer)
        if parsed.path.lower().endswith('/challenge.html'):
            wanted = urllib.parse.parse_qs(parsed.query)
            wanted = (wanted.get('from') or wanted.get('difficulty') or [''])[0]
            wanted = wanted.strip().lower()
            if wanted in ('easy', 'medium', 'hard'):
                return wanted
        if query:
            wanted = (query.get('from') or query.get('difficulty') or [''])[0]
            wanted = wanted.strip().lower()
            return wanted if wanted in ('easy', 'medium', 'hard') else None
        return None

    def _handle_cheshire(self):
        """
        The Cheshire Cat's decoding instructions — Easy chamber only.

        The cat helps the Easy chamber peel the four layers off the sealed
        flag. A lab opened from Medium or Hard gets no instructions: the cat
        does not help there. The server never returns the plaintext flag or
        any intermediate result.
        """
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        chamber = self._lab_chamber(query)

        if chamber != 'easy':
            self._send_json({
                'success': False,
                'immune': chamber in ('medium', 'hard'),
                'chamber': chamber,
                'error': (
                    'The Cheshire Cat only helps the Easy chamber. This lab '
                    'gets no instructions.'
                ),
            }, 403)
            return

        self._send_json({
            'success': True,
            'difficulty': 'easy',
            'totalSteps': len(CHESHIRE_STEPS),
            'steps': [
                {'step': index, **meta}
                for index, meta in enumerate(CHESHIRE_STEPS)
            ],
        })

    def _handle_cheshire_unlock(self):
        """
        Sell the Cheshire Cat's pass to the Cipher Lab.

        Easy chamber: the cat only speaks after every Mad Hatter hint is
        bought, then charges a fixed 200 Easy Sovereigns for the key.

        Medium chamber: the cat speaks after every Medium hint is bought, and
        then asks for *the rest of the player's coins* — their whole remaining
        Medium balance, whatever the quantity (even an empty purse opens the
        door). The quantity does not matter; the remainder is the price.

        The pass is recorded in the account either way so it survives reloads,
        and the deduction happens server-side so the browser cannot simply
        claim it already paid.
        """
        user = self._require_session()
        if not user:
            return

        # Which chamber's cat was knocked on? The tea room / chamber page the
        # request came from decides; an unattributable request is Easy's.
        chamber = self._shop_chamber()
        if chamber not in ('easy', 'medium'):
            chamber = 'easy'
        required_hints = EASY_HINT_IDS if chamber == 'easy' else MEDIUM_HINT_IDS
        points_column = f'points_{chamber}'

        with db_conn() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT * FROM users WHERE id = ?', (user['id'],)).fetchone()
            if not row:
                self._send_json({'success': False, 'error': 'User not found.'}, 404)
                return

            purchased = _json_list(row['purchased_hints'])

            if CHESHIRE_PASS_ID in purchased:
                public = user_to_public(row, conn)
                self._send_json({
                    'success': True,
                    'alreadyUnlocked': True,
                    'unlocked': True,
                    'cost': 0,
                    'user': public,
                    'points': public['points'],
                    'points_easy': public['points_easy'],
                    'points_medium': public['points_medium'],
                    'pointsByDifficulty': public['pointsByDifficulty'],
                    'purchasedHints': public['purchasedHints'],
                })
                return

            missing = [hint_id for hint_id in required_hints
                       if hint_id not in purchased]
            if missing:
                self._send_json({
                    'success': False,
                    'locked': True,
                    'error': (
                        'The Cheshire Cat only speaks to an Alice who has '
                        'bought every '
                        + ('Mad Hatter' if chamber == 'easy' else 'Medium')
                        + ' hint first.'
                    ),
                    'missingHints': missing,
                }, 403)
                return

            user_points = int(row['points'] or 0)
            user_chamber_points = int(row[points_column] or 0)

            if chamber == 'easy':
                # Easy keeps its fixed 200-Sovereign key.
                cost = CHESHIRE_PASS_COST
                if user_points < cost or user_chamber_points < cost:
                    self._send_json({
                        'success': False,
                        'error': (
                            f'The Cheshire Cat wants {CHESHIRE_PASS_COST} Gold '
                            f'Sovereigns for the key. You have {user_chamber_points}.'
                        ),
                        'needed': cost,
                        'available': user_chamber_points,
                    }, 400)
                    return
            else:
                # Medium: the cat asks for the rest of the player's coins —
                # the whole remaining Medium purse, whatever it holds. The
                # quantity does not matter, so an empty purse still gets in.
                cost = user_chamber_points

            new_points = user_points - cost
            new_chamber_points = user_chamber_points - cost
            purchased.append(CHESHIRE_PASS_ID)

            conn.execute(
                f'''UPDATE users
                    SET points = ?, {points_column} = ?, purchased_hints = ?, updated_at = ?
                    WHERE id = ?''',
                (new_points, new_chamber_points, json.dumps(purchased),
                 _now_iso(), user['id'])
            )
            fresh = conn.execute('SELECT * FROM users WHERE id = ?',
                                 (user['id'],)).fetchone()
            public = user_to_public(fresh, conn)

        self._send_json({
            'success': True,
            'unlocked': True,
            'cost': cost,
            'user': public,
            'points': public['points'],
            'points_easy': public['points_easy'],
            'points_medium': public['points_medium'],
            'pointsByDifficulty': public['pointsByDifficulty'],
            'purchasedHints': public['purchasedHints'],
        })

    def _shop_chamber(self, query=None):
        """
        Which chamber's shop is this request for?

        The Mad Hatter page is reached from a chamber page (``?from=<chamber>``)
        or opened directly. A chamber page Referer wins; otherwise the shop
        page's own ``from`` parameter decides. ``query`` is the parsed query
        string of the API request itself, which is where the shop page passes
        the chamber it was opened for.
        """
        chamber = self._chamber_from_referer()
        if chamber in HINT_CATALOGUE:
            return chamber
        referer = self.headers.get('Referer') or ''
        parsed = urllib.parse.urlparse(referer)
        if parsed.path.lower().endswith('/mad-hatter.html'):
            wanted = (urllib.parse.parse_qs(parsed.query).get('from') or [''])[0]
            wanted = wanted.strip().lower()
            if wanted in HINT_CATALOGUE:
                return wanted
        if query:
            wanted = (query.get('from') or [''])[0].strip().lower()
            return wanted if wanted in HINT_CATALOGUE else None
        return None

    def _handle_hints(self):
        """
        Mad Hatter shop catalogue for the chamber the shop page belongs to.

        The chamber comes from the page the browser is on (a chamber page, or
        the shop page's ``from`` parameter), so the shop cannot be coaxed into
        showing another chamber's clues. Prices match ``POST /api/hint``.
        """
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        chamber = self._shop_chamber(query)
        if chamber not in HINT_CATALOGUE:
            self._send_json({
                'success': False,
                'error': 'The Mad Hatter could not tell which chamber you are in.',
            }, 403)
            return

        entry = HINT_CATALOGUE[chamber]
        self._send_json({
            'success': True,
            'difficulty': chamber,
            'openingDialogue': entry.get('openingDialogue', ''),
            'hints': entry.get('hints', []),
        })

    def _handle_submit_flag(self):
        """
        Public flag submission from the first page.

        The form asks for an account username, the chamber the flag belongs to,
        and the decoded flag itself. The server compares the submission with
        the real flag for that chamber (never shipped to the browser), logs the
        attempt in the flag_submissions table, and associates every correct
        capture with the user's account. No session is required: the username
        names the account that claims the capture.
        """
        data = self._get_body()
        username = _clean_username(data.get('username') or '')
        difficulty = (data.get('difficulty') or '').strip().lower()
        submitted = (data.get('flag') or '').strip()

        if not username:
            self._send_json({'success': False,
                             'error': 'Tell the court whose flag this is.'}, 400)
            return
        if difficulty not in DIFFICULTY_FLAGS:
            self._send_json({'success': False,
                             'error': 'Choose a chamber: easy, medium or hard.'}, 400)
            return
        if not submitted:
            self._send_json({'success': False,
                             'error': 'Paste the decoded flag before submitting.'}, 400)
            return

        expected = DIFFICULTY_FLAGS[difficulty]
        correct = hmac.compare_digest(submitted, expected)
        now = _now_iso()

        with db_conn() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute(
                'SELECT * FROM users WHERE LOWER(username) = ?',
                (username.lower(),)
            ).fetchone()
            if not row:
                row = conn.execute(
                    'SELECT * FROM users WHERE LOWER(display_name) = ?',
                    (username.lower(),)
                ).fetchone()
            if not row:
                self._send_json({
                    'success': False,
                    'error': f'No account named "{username}" exists in the royal registry.',
                }, 404)
                return

            already = False
            if correct:
                prior = conn.execute(
                    '''SELECT id FROM flag_submissions
                       WHERE user_id = ? AND difficulty = ? AND correct = 1''',
                    (row['id'], difficulty)
                ).fetchone()
                already = prior is not None

            conn.execute(
                '''INSERT INTO flag_submissions
                       (user_id, difficulty, submitted_flag, correct, created_at)
                   VALUES (?, ?, ?, ?, ?)''',
                (row['id'], difficulty, submitted[:200], 1 if correct else 0, now)
            )

            if not correct:
                self._send_json({
                    'success': False,
                    'error': f'That is not the flag of the {difficulty.title()} chamber.',
                    'correct': False,
                }, 400)
                return

            public = user_to_public(row, conn)
            self._send_json({
                'success': True,
                'alreadyCaptured': already,
                'difficulty': difficulty,
                'accountUsername': public['username'],
                'displayName': public['displayName'],
                'message': (
                    f'The {difficulty.title()} flag is already sealed to '
                    f'"{public["displayName"]}".' if already else
                    f'Flag captured! The {difficulty.title()} flag now belongs to '
                    f'"{public["displayName"]}".'
                ),
            })

    def _handle_difficulty(self):
        """
        Record the difficulty the player has just chosen.

        The Queen's answer scroll reads this shared value and shows the matching
        flag, so entering Easy/Medium/Hard updates the Queen's scroll directly.
        No account is required: the choice is made on the difficulty hub and
        login gate before a session exists.
        """
        data = self._get_body()
        difficulty = str(data.get('difficulty') or '').strip().lower()
        if difficulty not in DIFFICULTY_FLAGS:
            self._send_json({
                'success': False,
                'error': 'Difficulty must be easy, medium or hard.',
            }, 400)
            return

        set_setting(ACTIVE_DIFFICULTY_KEY, difficulty)
        # The flag is deliberately omitted here: this endpoint is public, and
        # only isSolved() (Easy) and the Queen's scroll may reveal a flag.
        self._send_json({
            'success': True,
            'difficulty': difficulty,
        })

    def _handle_leaderboard(self):
        current = self._require_admin()
        if not current:
            return
        current_id = current['id']

        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        requested = (query.get('difficulty') or ['all'])[0].strip().lower()
        difficulty = requested if requested in ('easy', 'medium', 'hard') else 'all'
        season_param = (query.get('season') or ['current'])[0].strip().lower()
        season_mode = 'all' if season_param == 'all' else 'current'
        season = get_current_season()

        season_join = '' if season_mode == 'all' else 'AND s.season = ?'
        params = () if season_mode == 'all' else (season,)

        with db_conn() as conn:
            rows = conn.execute(f'''
                SELECT u.id, u.username, u.display_name, u.role, u.character,
                       u.created_at,
                       COALESCE(SUM(s.points), 0) AS points_all,
                       COALESCE(SUM(CASE WHEN s.puzzle_id < 100 THEN s.points END), 0) AS points_easy,
                       COALESCE(SUM(CASE WHEN s.puzzle_id BETWEEN 100 AND 199 THEN s.points END), 0) AS points_medium,
                       COALESCE(SUM(CASE WHEN s.puzzle_id >= 200 THEN s.points END), 0) AS points_hard,
                       COUNT(s.id) AS solved_all,
                       COUNT(CASE WHEN s.puzzle_id < 100 THEN 1 END) AS solved_easy,
                       COUNT(CASE WHEN s.puzzle_id BETWEEN 100 AND 199 THEN 1 END) AS solved_medium,
                       COUNT(CASE WHEN s.puzzle_id >= 200 THEN 1 END) AS solved_hard
                FROM users u
                LEFT JOIN solves s ON s.user_id = u.id {season_join}
                GROUP BY u.id
            ''', params).fetchall()

            def metric(row):
                if difficulty == 'easy':
                    return (int(row['points_easy'] or 0), int(row['solved_easy'] or 0))
                if difficulty == 'medium':
                    return (int(row['points_medium'] or 0), int(row['solved_medium'] or 0))
                if difficulty == 'hard':
                    return (int(row['points_hard'] or 0), int(row['solved_hard'] or 0))
                return (int(row['points_all'] or 0), int(row['solved_all'] or 0))

            rows = sorted(
                rows,
                key=lambda row: (
                    metric(row)[0],
                    metric(row)[1],
                    int(row['points_all'] or 0),
                    row['created_at'] or '',
                    -int(row['id']),
                ),
                reverse=True,
            )

            board = []
            for rank, row in enumerate(rows, 1):
                points, solved_count = metric(row)
                board.append({
                    'rank': rank,
                    'username': row['display_name'] or row['username'],
                    'accountUsername': row['username'],
                    'character': row['character'],
                    'role': row['role'],
                    'points': points,
                    'pointsTotal': int(row['points_all'] or 0),
                    'pointsEasy': int(row['points_easy'] or 0),
                    'pointsMedium': int(row['points_medium'] or 0),
                    'pointsHard': int(row['points_hard'] or 0),
                    'pointsByDifficulty': {
                        'easy': int(row['points_easy'] or 0),
                        'medium': int(row['points_medium'] or 0),
                        'hard': int(row['points_hard'] or 0),
                    },
                    'solvedCount': solved_count,
                    'solvedTotal': int(row['solved_all'] or 0),
                    'solvedByDifficulty': {
                        'easy': int(row['solved_easy'] or 0),
                        'medium': int(row['solved_medium'] or 0),
                        'hard': int(row['solved_hard'] or 0),
                    },
                    'isYou': row['id'] == current_id,
                })

            your_entry = next((p for p in board if p['isYou']), None)

        self._send_json({
            'success': True,
            'leaderboard': board,
            'you': your_entry,
            'totalPlayers': len(board),
            'difficulty': difficulty,
            'season': season,
            'seasonMode': season_mode,
        })

    # ── Admin monitoring ─────────────────────────────────────────────────────

    def _handle_admin_players(self):
        """Paginated player registry for the Court Administrator."""
        current = self._require_admin()
        if not current:
            return

        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            page = max(1, int((query.get('page') or ['1'])[0]))
        except (TypeError, ValueError):
            page = 1
        try:
            per_page = min(100, max(5, int((query.get('perPage') or ['25'])[0])))
        except (TypeError, ValueError):
            per_page = 25
        sort = (query.get('sort') or ['points'])[0].strip().lower()
        if sort not in ('points', 'username', 'solved', 'last_login', 'created'):
            sort = 'points'
        order = (query.get('order') or ['desc'])[0].strip().lower()
        reverse = order != 'asc'
        search = (query.get('search') or [''])[0].strip().lower()
        season = get_current_season()

        with db_conn() as conn:
            rows = conn.execute('''
                SELECT u.*,
                       COUNT(s.id) AS solved_all,
                       COUNT(CASE WHEN s.puzzle_id < 100 THEN 1 END) AS solved_easy,
                       COUNT(CASE WHEN s.puzzle_id BETWEEN 100 AND 199 THEN 1 END) AS solved_medium,
                       COUNT(CASE WHEN s.puzzle_id >= 200 THEN 1 END) AS solved_hard
                FROM users u
                LEFT JOIN solves s ON s.user_id = u.id AND s.season = ?
                GROUP BY u.id
            ''', (season,)).fetchall()

            players = []
            for row in rows:
                if search and search not in (row['username'] or '').lower() \
                        and search not in (row['display_name'] or '').lower():
                    continue
                hints = _json_list(row['purchased_hints'])
                players.append({
                    'id': row['id'],
                    'username': row['username'],
                    'displayName': row['display_name'] or row['username'],
                    'role': row['role'],
                    'character': row['character'],
                    'email': row['email'],
                    'points': int(row['points'] or 0),
                    'pointsEasy': int(row['points_easy'] or 0),
                    'pointsMedium': int(row['points_medium'] or 0),
                    'pointsHard': int(row['points_hard'] or 0),
                    'solvedByDifficulty': {
                        'easy': int(row['solved_easy'] or 0),
                        'medium': int(row['solved_medium'] or 0),
                        'hard': int(row['solved_hard'] or 0),
                    },
                    'solvedCount': int(row['solved_all'] or 0),
                    'hintCount': len(hints),
                    'purchasedHints': hints,
                    'isAdmin': is_admin_user(dict(row)),
                    'isQueen': is_queen_user(dict(row)),
                    'createdAt': row['created_at'],
                    'lastLoginAt': row['last_login_at'],
                })

        sort_keys = {
            'points': lambda p: (p['points'], p['solvedCount']),
            'username': lambda p: (p['username'] or '').lower(),
            'solved': lambda p: p['solvedCount'],
            'last_login': lambda p: p['lastLoginAt'] or '',
            'created': lambda p: p['createdAt'] or '',
        }
        players.sort(key=sort_keys[sort], reverse=reverse)

        total = len(players)
        start = (page - 1) * per_page
        page_rows = players[start:start + per_page]

        self._send_json({
            'success': True,
            'players': page_rows,
            'total': total,
            'page': page,
            'perPage': per_page,
            'pages': max(1, (total + per_page - 1) // per_page),
            'sort': sort,
            'order': 'desc' if reverse else 'asc',
            'season': season,
        })

    def _handle_admin_solves(self):
        """Most recent solves across all players."""
        current = self._require_admin()
        if not current:
            return

        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            limit = min(200, max(1, int((query.get('limit') or ['50'])[0])))
        except (TypeError, ValueError):
            limit = 50
        try:
            offset = max(0, int((query.get('offset') or ['0'])[0]))
        except (TypeError, ValueError):
            offset = 0

        with db_conn() as conn:
            total = conn.execute('SELECT COUNT(*) AS n FROM solves').fetchone()['n']
            rows = conn.execute('''
                SELECT s.id, s.puzzle_id, s.points, s.solved_at, s.season,
                       u.username, u.display_name
                FROM solves s
                JOIN users u ON u.id = s.user_id
                ORDER BY s.solved_at DESC, s.id DESC
                LIMIT ? OFFSET ?
            ''', (limit, offset)).fetchall()

        solves = []
        for row in rows:
            puzzle = PUZZLES.get(row['puzzle_id'], {})
            solves.append({
                'id': row['id'],
                'puzzleId': row['puzzle_id'],
                'title': puzzle.get('title', 'Unknown Trial'),
                'difficulty': difficulty_for(row['puzzle_id']),
                'points': int(row['points'] or 0),
                'season': int(row['season'] or 1),
                'solvedAt': row['solved_at'],
                'username': row['username'],
                'displayName': row['display_name'] or row['username'],
            })

        self._send_json({
            'success': True,
            'solves': solves,
            'total': int(total or 0),
            'limit': limit,
            'offset': offset,
        })

    def _handle_admin_audit(self):
        current = self._require_admin()
        if not current:
            return

        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            limit = min(200, max(1, int((query.get('limit') or ['50'])[0])))
        except (TypeError, ValueError):
            limit = 50

        with db_conn() as conn:
            rows = conn.execute('''
                SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?
            ''', (limit,)).fetchall()

        self._send_json({
            'success': True,
            'audit': [{
                'id': row['id'],
                'adminUsername': row['admin_username'],
                'action': row['action'],
                'targetUser': row['target_username'],
                'detail': row['detail'],
                'createdAt': row['created_at'],
            } for row in rows],
        })

    def _handle_admin_reset_player(self):
        """Wipe one player's progression and record the action in the audit."""
        current = self._require_admin()
        if not current:
            return

        data = self._get_body()
        if data.get('confirm') != 'RESET':
            self._send_json({'success': False, 'error': 'Confirmation required.'}, 400)
            return

        target = None
        if data.get('userId') is not None:
            try:
                target_id = int(data.get('userId'))
            except (TypeError, ValueError):
                target_id = None
            if target_id is not None:
                with db_conn() as conn:
                    target = conn.execute(
                        'SELECT * FROM users WHERE id = ?', (target_id,)
                    ).fetchone()
        elif data.get('username'):
            with db_conn() as conn:
                target = conn.execute(
                    'SELECT * FROM users WHERE LOWER(username) = LOWER(?)',
                    (str(data.get('username')).strip(),)
                ).fetchone()

        if not target:
            self._send_json({'success': False, 'error': 'Player not found.'}, 404)
            return
        if is_admin_user(dict(target)) or is_queen_user(dict(target)):
            self._send_json({
                'success': False,
                'error': 'Privileged court accounts cannot be reset from this console.'
            }, 403)
            return

        with db_conn() as conn:
            conn.execute('DELETE FROM solves WHERE user_id = ?', (target['id'],))
            conn.execute(
                '''UPDATE users
                   SET points = 0, points_easy = 0, points_medium = 0, points_hard = 0,
                       solved_puzzles = '[]', purchased_hints = '[]', updated_at = ?
                   WHERE id = ?''',
                (_now_iso(), target['id'])
            )
            _record_audit(conn, current, 'reset-player', dict(target),
                          'Coins, solves and hint purchases cleared.')
            fresh = conn.execute('SELECT * FROM users WHERE id = ?',
                                 (target['id'],)).fetchone()
            public = user_to_public(fresh, conn)

        self._send_json({'success': True, 'player': public})

    def _handle_admin_season_rollover(self):
        """
        Start a new season.

        Solves from the old season are archived in the solves table (tagged with
        their season), while player-facing balances and the solved cache restart
        at zero. Purchased hints and the Cipher Lab pass carry over.
        """
        current = self._require_admin()
        if not current:
            return

        data = self._get_body()
        if data.get('confirm') != 'ROLLOVER':
            self._send_json({'success': False, 'error': 'Confirmation required.'}, 400)
            return

        old_season = get_current_season()
        new_season = old_season + 1
        with db_conn() as conn:
            conn.execute(
                '''UPDATE users
                   SET points = 0, points_easy = 0, points_medium = 0, points_hard = 0,
                       solved_puzzles = '[]', updated_at = ?''',
                (_now_iso(),)
            )
            conn.execute(
                'INSERT INTO settings (key, value) VALUES (?, ?) '
                'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                (CURRENT_SEASON_KEY, str(new_season))
            )
            _record_audit(conn, current, 'season-rollover', None,
                          f'Season {old_season} archived; season {new_season} began.')

        self._send_json({
            'success': True,
            'previousSeason': old_season,
            'season': new_season,
            'hintsPreserved': True,
        })

    def _handle_admin_skip(self):
        """
        Court Administrator shortcut: jump to a chamber's final trial.

        This never answers, solves or awards anything. It validates the admin's
        session, resolves the last puzzle of the chosen chamber and records the
        privileged action in the audit trail. The browser uses the returned
        puzzle id to open that trial; normal players remain bound by the
        sequential lock and receive 403 here.
        """
        current = self._require_admin(
            'By royal decree, only the Court Administrator may skip trials.'
        )
        if not current:
            return

        data = self._get_body()
        difficulty = str(data.get('difficulty') or '').strip().lower()
        if difficulty not in ('easy', 'medium', 'hard'):
            self._send_json({
                'success': False,
                'error': 'Difficulty must be easy, medium or hard.'
            }, 400)
            return

        puzzle_ids = sorted(
            puzzle_id for puzzle_id in PUZZLES
            if difficulty_for(puzzle_id) == difficulty
        )
        if not puzzle_ids:
            self._send_json({'success': False, 'error': 'Unknown chamber.'}, 404)
            return

        target_id = puzzle_ids[-1]
        target = PUZZLES[target_id]
        with db_conn() as conn:
            _record_audit(
                conn, current, 'skip-to-final', None,
                f'{difficulty} chamber: skipped {len(puzzle_ids) - 1} trials '
                f'to puzzle {target_id} ({target["title"]}).'
            )

        self._send_json({
            'success': True,
            'difficulty': difficulty,
            'puzzleId': target_id,
            'title': target['title'],
            'sealed': is_queen_sealed(target_id),
            'skipped': len(puzzle_ids) - 1,
            'total': len(puzzle_ids),
            'pointsAwarded': 0,
        })

    def _handle_db_status(self):
        with db_conn() as conn:
            users = conn.execute('SELECT COUNT(*) AS n FROM users').fetchone()['n']
            sessions = conn.execute(
                'SELECT COUNT(*) AS n FROM sessions WHERE expires_at >= ?',
                (_now_iso(),)
            ).fetchone()['n']
            solves = conn.execute('SELECT COUNT(*) AS n FROM solves').fetchone()['n']
        try:
            label = os.path.relpath(DB_PATH, BASE_DIR)
        except ValueError:  # e.g. different drive on Windows
            label = DB_PATH
        self._send_json({
            'status': 'connected',
            'database': f'SQLite ({label})',
            'usersCount': users,
            'activeSessions': sessions,
            'solvesRecorded': solves,
        })

    # ── POST ────────────────────────────────────────────────────────────────

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        routes = {
            '/api/register': self._handle_register,
            '/api/login': self._handle_login,
            '/api/logout': self._handle_logout,
            '/api/solve': self._handle_solve,
            '/api/hint': self._handle_hint,
            '/api/profile': self._handle_profile,
            '/api/progress': self._handle_progress,
            '/api/reset': self._handle_reset,
            '/api/difficulty': self._handle_difficulty,
            '/api/submit-flag': self._handle_submit_flag,
            '/api/cheshire/unlock': self._handle_cheshire_unlock,
            '/api/check-is-solved': self._handle_check_is_solved,
            '/api/is-solved': self._handle_check_is_solved,
            '/api/admin/players/reset': self._handle_admin_reset_player,
            '/api/admin/season/rollover': self._handle_admin_season_rollover,
            '/api/admin/skip': self._handle_admin_skip,
        }
        handler = routes.get(path)
        if handler:
            handler()
        elif path.startswith('/api/'):
            self._send_json({'success': False, 'error': 'Unknown endpoint.'}, 404)
        else:
            super().do_POST()

    def _handle_register(self):
        data = self._get_body()
        username = _clean_username(data.get('username'))
        password = data.get('password') or ''
        display_name = _clean_username(data.get('displayName') or data.get('display_name')
                                      or username)
        email = (data.get('email') or '').strip()

        if not USERNAME_RE.match(username):
            self._send_json({
                'success': False,
                'error': 'Username must be 3–24 characters (letters, numbers, spaces, . _ -).'
            }, 400)
            return
        if len(password) < 6:
            self._send_json({'success': False,
                             'error': 'Passphrase must be at least 6 characters.'}, 400)
            return
        if len(password) > 128:
            self._send_json({'success': False,
                             'error': 'Passphrase is too long.'}, 400)
            return
        if len(display_name) < 2 or len(display_name) > 32:
            self._send_json({'success': False,
                             'error': 'Display name must be 2–32 characters.'}, 400)
            return
        if not DISPLAY_NAME_RE.match(display_name):
            self._send_json({'success': False,
                             'error': 'Display name contains unsupported characters.'}, 400)
            return
        if email and not EMAIL_RE.match(email):
            self._send_json({'success': False, 'error': 'Invalid email address.'}, 400)
            return

        now = _now_iso()
        try:
            with db_conn() as conn:
                existing = conn.execute(
                    'SELECT id FROM users WHERE LOWER(username) = LOWER(?)',
                    (username,)
                ).fetchone()
                if existing:
                    self._send_json({'success': False,
                                     'error': 'That username is already registered.'}, 409)
                    return

                conn.execute(
                    '''INSERT INTO users
                       (username, display_name, password, password_hash, email, role,
                        character, points, points_easy, points_medium, points_hard,
                        solved_puzzles, purchased_hints,
                        created_at, updated_at, last_login_at)
                       VALUES (?, ?, '', ?, ?, ?, 'alice', 0, 0, 0, 0, '[]', '[]', ?, ?, ?)''',
                    (username, display_name, hash_password(password), email,
                     'Royal Voyager of the Keyhole', now, now, now)
                )
                user_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
                user = conn.execute('SELECT * FROM users WHERE id = ?',
                                    (user_id,)).fetchone()
                public = user_to_public(user, conn)
        except sqlite3.IntegrityError:
            self._send_json({'success': False,
                             'error': 'That username is already registered.'}, 409)
            return

        token = create_session(
            public['id'], self.headers.get('User-Agent', ''), self._client_ip()
        )
        self._send_json({'success': True, 'user': public}, 201,
                        self._set_cookie_headers(token))

    def _login_chamber(self, body):
        """
        Which chamber is the login form for?

        The form is served by ``login.html?difficulty=<chamber>``, so the
        Referer path is the login page and the chamber travels in its query.
        A request from a chamber page (or any other trusted page) wins, which
        keeps the rule "the chamber is decided by the page, not the payload".
        """
        chamber = self._chamber_from_referer()
        if chamber in HINT_CATALOGUE:
            return chamber
        try:
            referer = urllib.parse.urlparse(self.headers.get('Referer') or '')
        except ValueError:
            return None
        if referer.path.lower().endswith('/login.html'):
            query = urllib.parse.parse_qs(referer.query)
            wanted = (query.get('difficulty') or [''])[0].strip().lower()
            return wanted if wanted in HINT_CATALOGUE else None
        return None

    def _handle_login(self):
        data = self._get_body()
        username = data.get('username') or ''
        password = data.get('password') or ''

        # Medium-only, Queen-only SQL injection. The player types the Queen's
        # username (hearts_queen) and puts the payload in the password field;
        # on the Medium chamber page the concatenated lookup turns the payload
        # into a tautology, so the Queen's password check is bypassed.
        #
        # The chamber comes from the login page the player submitted, so a
        # Medium form only works from Medium, and only the Queen's account can
        # be reached. Easy and Hard never reach the concatenation below.
        injected = False
        chamber = self._login_chamber(data)
        hard_access = False
        if chamber == 'hard' and str(username).strip().lower() == QUEEN_USERNAME:
            # This fictional credential is independent of the real Queen account.
            # In particular, neither Medium SQLi nor the normal account password
            # grants the hard flag capability.
            with db_conn() as conn:
                row = conn.execute('SELECT * FROM users WHERE username = ?', (QUEEN_USERNAME,)).fetchone()
            hard_access = bool(row) and verify_royal_password(password)
            user = dict(row) if hard_access else None
        elif chamber == 'medium':
            user = medium_sqli_queen_login(username, password)
            injected = user is not None
        else:
            user = None
        if user is None and not (chamber == 'hard' and str(username).strip().lower() == QUEEN_USERNAME):
            user = find_user_by_credentials(username, password)
        if not user:
            self._send_json({
                'success': False,
                'error': f'Invalid credentials for "{username}".'
            }, 401)
            return

        if injected:
            record_queen_login(user['id'])

        with db_conn() as conn:
            fresh = conn.execute('SELECT * FROM users WHERE id = ?',
                                 (user['id'],)).fetchone()
            public = user_to_public(fresh, conn)

        token = create_session(
            user['id'], self.headers.get('User-Agent', ''), self._client_ip(),
            hard_queen_access=hard_access
        )
        self._send_json({'success': True, 'user': public},
                        extra_headers=self._set_cookie_headers(token))

    def _handle_logout(self):
        delete_session(self._get_session_id())
        self._send_json({'success': True},
                        extra_headers=self._clear_cookie_headers())

    def _handle_solve(self):
        user = self._require_session()
        if not user:
            return

        # The Queen's account is for reviewing answers, not playing the trials.
        if is_queen_user(user):
            self._send_json({
                'success': False,
                'error': "The Heart's Queen does not play the trials. Her scroll already holds every answer."
            }, 403)
            return

        data = self._get_body()
        try:
            puzzle_id = int(data.get('puzzleId'))
        except (TypeError, ValueError):
            self._send_json({'success': False, 'error': 'Invalid puzzle id.'}, 400)
            return

        if puzzle_id not in PUZZLES:
            self._send_json({'success': False, 'error': 'Unknown puzzle.'}, 404)
            return

        # The Queen has sealed the final trial of every chamber. Refuse the
        # answer server-side so the corruption cannot be bypassed by editing
        # the page or posting directly to this endpoint.
        if is_queen_sealed(puzzle_id):
            self._send_json({
                'success': False,
                'sealed': True,
                'correct': False,
                'error': (
                    'The Queen has corrupted this final trial. '
                    'No answer will ever be accepted — the seal cannot be broken.'
                ),
            }, 403)
            return

        answer = data.get('answer') or ''
        if not is_correct(puzzle_id, answer):
            self._send_json({
                'success': True,
                'correct': False,
                'error': 'That answer does not fit the royal riddle.',
            })
            return

        points = points_for(puzzle_id)
        difficulty = difficulty_for(puzzle_id)
        now = _now_iso()
        season = get_current_season()

        with db_conn() as conn:
            conn.execute('BEGIN IMMEDIATE')
            existing = conn.execute(
                'SELECT points FROM solves WHERE user_id = ? AND puzzle_id = ? AND season = ?',
                (user['id'], puzzle_id, season)
            ).fetchone()

            already_solved = existing is not None
            awarded = 0

            if not already_solved:
                conn.execute(
                    '''INSERT INTO solves (user_id, puzzle_id, points, solved_at, season)
                       VALUES (?, ?, ?, ?, ?)''',
                    (user['id'], puzzle_id, points, now, season)
                )
                solved = _solved_ids(conn, user['id'])
                diff_col = f'points_{difficulty}'
                conn.execute(
                    f'''UPDATE users
                       SET points = points + ?, {diff_col} = {diff_col} + ?, solved_puzzles = ?, updated_at = ?
                       WHERE id = ?''',
                    (points, points, json.dumps(solved), now, user['id'])
                )
                awarded = points

            row = conn.execute(
                'SELECT points, points_easy, points_medium, points_hard FROM users WHERE id = ?', (user['id'],)
            ).fetchone()
            solved = _solved_ids(conn, user['id'])
            progress = progress_by_difficulty(conn, user['id'])

        self._send_json({
            'success': True,
            'correct': True,
            'alreadySolved': already_solved,
            'awardedPoints': awarded,
            'difficulty': difficulty,
            'season': season,
            'points_easy': int(row['points_easy']) if row else 0,
            'points_medium': int(row['points_medium']) if row else 0,
            'points_hard': int(row['points_hard']) if row else 0,
            'pointsByDifficulty': {
                'easy': int(row['points_easy']) if row else 0,
                'medium': int(row['points_medium']) if row else 0,
                'hard': int(row['points_hard']) if row else 0,
            },
            'totalPoints': int(row['points']) if row else 0,
            'solvedPuzzles': solved,
            'solvedCount': len(solved),
            'progressByDifficulty': progress,
        })

    def _handle_profile(self):
        user = self._require_session()
        if not user:
            return

        data = self._get_body()
        updates = []
        params = []

        if 'displayName' in data or 'display_name' in data:
            display_name = _clean_username(
                data.get('displayName') or data.get('display_name')
            )
            if len(display_name) < 2 or len(display_name) > 32:
                self._send_json({'success': False,
                                 'error': 'Display name must be 2–32 characters.'}, 400)
                return
            if not DISPLAY_NAME_RE.match(display_name):
                self._send_json({'success': False,
                                 'error': 'Display name contains unsupported characters.'}, 400)
                return
            updates.append('display_name = ?')
            params.append(display_name)

        if 'email' in data:
            email = (data.get('email') or '').strip()
            if email and not EMAIL_RE.match(email):
                self._send_json({'success': False,
                                 'error': 'Invalid email address.'}, 400)
                return
            updates.append('email = ?')
            params.append(email)

        if 'character' in data:
            character = (data.get('character') or '').strip().lower()
            if character not in ('alice', 'queen', 'admin'):
                self._send_json({'success': False,
                                 'error': 'Unknown character.'}, 400)
                return
            updates.append('character = ?')
            params.append(character)

        if not updates:
            self._send_json({'success': False, 'error': 'Nothing to update.'}, 400)
            return

        updates.append('updated_at = ?')
        params.append(_now_iso())
        params.append(user['id'])

        with db_conn() as conn:
            conn.execute(f'UPDATE users SET {", ".join(updates)} WHERE id = ?', params)
            fresh = conn.execute('SELECT * FROM users WHERE id = ?',
                                 (user['id'],)).fetchone()
            public = user_to_public(fresh, conn)

        self._send_json({'success': True, 'user': public})

    def _handle_hint(self):
        """Authoritatively purchase a hint, deducting coins and recording the purchase in SQLite."""
        user = self._require_session()
        if not user:
            return

        data = self._get_body()
        hint_id = str(data.get('hintId') or '').strip()
        if not hint_id:
            self._send_json({'success': False, 'error': 'Missing hintId.'}, 400)
            return

        # Hint catalogue prices, with the chamber whose coin purse pays for it.
        # Kept in sync with the server-side HINT_CATALOGUE above.
        HINT_PRICES = {
            hint['id']: (int(hint['cost']), difficulty)
            for difficulty, entry in HINT_CATALOGUE.items()
            for hint in entry['hints']
        }

        if hint_id not in HINT_PRICES:
            known = sorted(
                hid for hid, (_cost, diff) in HINT_PRICES.items()
                if diff == self._shop_chamber()
            )
            self._send_json({
                'success': False,
                'error': (
                    f'Unknown hint "{hint_id}" for this chamber.'
                    + (f' Expected one of: {", ".join(known)}.' if known else '')
                ),
                'unknownHint': hint_id,
                'expected': known,
            }, 404)
            return

        cost, hint_difficulty = HINT_PRICES[hint_id]
        points_column = f'points_{hint_difficulty}'
        now = _now_iso()

        with db_conn() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT * FROM users WHERE id = ?', (user['id'],)).fetchone()
            if not row:
                self._send_json({'success': False, 'error': 'User not found.'}, 404)
                return

            purchased = _json_list(row['purchased_hints'])
            if hint_id in purchased:
                public = user_to_public(row, conn)
                self._send_json({
                    'success': True,
                    'alreadyPurchased': True,
                    'hintId': hint_id,
                    'user': public,
                    'points': public['points'],
                    'points_easy': public['points_easy'],
                    'points_medium': public['points_medium'],
                    'points_hard': public['points_hard'],
                    'pointsByDifficulty': public['pointsByDifficulty'],
                    'totalPoints': public['points'],
                    'purchasedHints': public['purchasedHints'],
                })
                return

            user_points = int(row['points'] or 0)
            user_chamber_points = int(row[points_column] or 0)

            # Player must be able to afford the hint from that chamber's purse.
            if user_points < cost or user_chamber_points < cost:
                self._send_json({
                    'success': False,
                    'error': f'Not enough Gold Sovereigns! Hint costs {cost} coins.',
                    'needed': cost,
                    'available': user_chamber_points
                }, 400)
                return

            new_points = user_points - cost
            new_chamber_points = user_chamber_points - cost
            purchased.append(hint_id)

            conn.execute(
                f'''UPDATE users
                    SET points = ?, {points_column} = ?, purchased_hints = ?, updated_at = ?
                    WHERE id = ?''',
                (new_points, new_chamber_points, json.dumps(purchased), now, user['id'])
            )
            fresh = conn.execute('SELECT * FROM users WHERE id = ?', (user['id'],)).fetchone()
            public = user_to_public(fresh, conn)

        self._send_json({
            'success': True,
            'hintId': hint_id,
            'cost': cost,
            'user': public,
            'points': public['points'],
            'points_easy': public['points_easy'],
            'points_medium': public['points_medium'],
            'points_hard': public['points_hard'],
            'pointsByDifficulty': public['pointsByDifficulty'],
            'totalPoints': public['points'],
            'purchasedHints': public['purchasedHints'],
        })

    def _handle_progress(self):
        """Sync hint purchases only. Coin totals are never accepted from clients."""
        user = self._require_session()
        if not user:
            return

        data = self._get_body()
        hints = data.get('purchasedHints')
        if not isinstance(hints, list):
            self._send_json({'success': False, 'error': 'Nothing to update.'}, 400)
            return

        clean_hints = [str(h)[:80] for h in hints[:200]]
        with db_conn() as conn:
            conn.execute(
                'UPDATE users SET purchased_hints = ?, updated_at = ? WHERE id = ?',
                (json.dumps(clean_hints), _now_iso(), user['id'])
            )
            fresh = conn.execute('SELECT * FROM users WHERE id = ?',
                                 (user['id'],)).fetchone()
            public = user_to_public(fresh, conn)

        self._send_json({
            'success': True,
            'user': public,
            'pointsByDifficulty': public['pointsByDifficulty'],
            'points_easy': public['points_easy'],
            'points_medium': public['points_medium'],
            'points_hard': public['points_hard'],
            'totalPoints': public['points'],
            'solvedCount': public['solvedCount'],
            'progressByDifficulty': public['progressByDifficulty'],
        })

    def _handle_check_is_solved(self):
        """
        Public helper endpoint for ``isSolved()`` / ``checkIsSolved(number, solved)``.

        INTENTIONALLY TRUSTS THE CLIENT-SUBMITTED ``solved`` FLAG, but ONLY for
        requests that come from the Easy Chamber or the landing page. This is
        what makes the Easy difficulty vulnerable while Medium and Hard stay
        immune: the browser cannot forge the Referer header, so a Medium/Hard
        console call is rejected before the claim is even read.

        Calling ``isSolved()`` from the Easy Chamber is therefore enough to make
        the server return the *sealed* Easy flag. The player then takes that
        cipher to the Cipher Lab, where the Cheshire Cat guides the Easy chamber
        through the two decoding layers. No coin balance is changed here.
        """
        chamber = self._chamber_from_referer()

        if chamber in ('medium', 'hard'):
            self._send_json({
                'success': False,
                'immune': True,
                'chamber': chamber,
                'error': (
                    f"The Queen's {chamber.title()} Chamber is immune to isSolved(). "
                    'Its trials must be solved, not claimed.'
                ),
            }, 403)
            return

        if chamber != 'easy':
            self._send_json({
                'success': False,
                'immune': True,
                'error': (
                    'The royal registry could not verify an Easy Chamber or '
                    'landing-page request. isSolved() only works in Easy.'
                ),
            }, 403)
            return

        data = self._get_body()
        raw_number = data.get('puzzle', data.get('puzzleNumber'))
        try:
            ordinal = int(raw_number)
        except (TypeError, ValueError):
            self._send_json({
                'success': False,
                'error': 'Puzzle number must be an integer between 1 and 30.',
            }, 400)
            return

        puzzle_id = puzzle_id_for_ordinal(ordinal)
        if puzzle_id is None:
            self._send_json({
                'success': False,
                'error': 'Puzzle number must be an integer between 1 and 30.',
            }, 400)
            return

        claim = data.get('solved')
        solved = claim is True or (
            isinstance(claim, str) and claim.strip().lower() in ('true', '1', 'yes')
        ) or (isinstance(claim, (int, float)) and claim == 1)

        puzzle = PUZZLES[puzzle_id]
        prize = points_for(puzzle_id) if solved else 0
        final_trial = ordinal == 30

        result = {
            'success': True,
            'puzzle': ordinal,
            'puzzleId': puzzle_id,
            # Ordinal 30 is the public "final trial" alias. Without this label
            # the console would print the Hard puzzle 205 title even though the
            # request came from the Easy chamber and returns the Easy flag.
            'title': 'The Final Trial' if final_trial else puzzle['title'],
            'difficulty': 'Easy' if final_trial else puzzle['difficulty'],
            'solved': solved,
            'prize': prize,
            'points': prize,
        }

        if not solved:
            result['message'] = 'That trial is not marked as solved, so no prize is awarded.'
        elif final_trial:
            # The Easy gateway is the only chamber allowed through the Referer
            # gate above, so this is always the Easy flag. Return it *sealed*
            # with the same four layers the Cipher Lab can undo; the player takes
            # it to the lab, where the cat helps in Easy only.
            result['flag'] = easy_cipher_stages()[0]
            result['sealed'] = True
            result['message'] = (
                "The final trial is complete. The Queen's flag is sealed — "
                'take this cipher to the Cipher Lab and let the Cheshire Cat '
                'help you unseal it.'
            )
        else:
            result['message'] = f'Prize awarded: {prize} Gold Sovereigns.'

        self._send_json(result)

    def _handle_reset(self):
        user = self._require_session()
        if not user:
            return
        # Resetting game progress is a Court Administrator power. Regular
        # players keep their progression; the admin console manages resets.
        if not is_admin_user(user):
            self._send_json({'success': False,
                             'error': 'Only the Court Administrator may reset game progress.'},
                            403)
            return
        if self._get_body().get('confirm') != 'RESET':
            self._send_json({'success': False,
                             'error': 'Confirmation required.'}, 400)
            return

        with db_conn() as conn:
            conn.execute('DELETE FROM solves WHERE user_id = ?', (user['id'],))
            conn.execute(
                '''UPDATE users
                   SET points = 0, points_easy = 0, points_medium = 0, points_hard = 0,
                       solved_puzzles = '[]',
                       purchased_hints = '[]', updated_at = ?
                   WHERE id = ?''',
                (_now_iso(), user['id'])
            )
            fresh = conn.execute('SELECT * FROM users WHERE id = ?',
                                 (user['id'],)).fetchone()
            public = user_to_public(fresh, conn)

        self._send_json({'success': True, 'user': public})

    # ── logging ─────────────────────────────────────────────────────────────

    def log_message(self, fmt, *args):
        msg = fmt % args
        if '/api/' in msg or 'Error' in msg:
            print(f'[{self.log_date_time_string()}] {self.address_string()} - {msg}')


# ─────────────────────────── Entry point ───────────────────────────────────

class WonderHackServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def _wonderhack_running_on(port):
    """True when the service already listening on this port is WonderHack."""
    try:
        request = urllib.request.Request(
            f'http://127.0.0.1:{port}/api/db-status',
            headers={'User-Agent': 'WonderHack/startup-check'},
        )
        with urllib.request.urlopen(request, timeout=0.6) as response:
            data = json.loads(response.read().decode('utf-8'))
        return data.get('status') == 'connected'
    except Exception:
        return False


def _open_server(preferred_port):
    """
    Bind the HTTP server without ever dumping an 'Address already in use'
    traceback. If WonderHack is already running on the requested port, say so
    and exit cleanly; if another program owns the port, try the next few ports.
    """
    candidates = [preferred_port]
    candidates += [p for p in range(preferred_port + 1, preferred_port + 11) if p <= 65535]

    for index, port in enumerate(candidates):
        try:
            return WonderHackServer(('', port), WonderHackHandler), port
        except OSError as exc:
            if getattr(exc, 'errno', None) != errno.EADDRINUSE:
                raise

            if _wonderhack_running_on(port):
                print(f'🃏 WonderHack is already running at http://localhost:{port}')
                print('   Open that address, or stop the running server before starting another.')
                return None, port

            if index + 1 < len(candidates):
                print(f'⚠️  Port {port} is already in use; trying {candidates[index + 1]}…')
            else:
                print(f'❌ Ports {candidates[0]}–{candidates[-1]} are all in use.')
                print('   Stop one of the programs using them, then run python3 server.py again.')
                return None, None

    return None, None


def main():
    init_db()
    purge_expired_sessions()

    server, port = _open_server(PORT)
    if server is None:
        sys.exit(0 if port else 1)

    with server as httpd:
        print(f'🃏 WonderHack Server → http://localhost:{port}')
        print('   Accounts, session cookies, score saves and leaderboard are online.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nShutting down server.')


if __name__ == '__main__':
    main()
