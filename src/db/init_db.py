#!/usr/bin/env python3
"""
Initialize / migrate the WonderHack SQLite database.

Tables:
  users    — accounts, hashed passwords, coin balance, JSON progress caches
  sessions — server-side session store (cookie value is stored as a hash)
  solves   — one row per (player, puzzle), the source of truth for scoring
"""
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timezone

# Allow both `python3 server.py` and `python3 db/init_db.py` / `python3 src/db/init_db.py`.
if __package__ in (None, ''):
    _this_dir = os.path.dirname(os.path.abspath(__file__))
    _src_dir = os.path.dirname(_this_dir)
    _root_dir = os.path.dirname(_src_dir)
    for _d in (_this_dir, _src_dir, _root_dir):
        if _d not in sys.path:
            sys.path.insert(0, _d)

from db.security import hash_password
from db.puzzles import PUZZLES, points_for


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _columns(cursor, table):
    cursor.execute(f'PRAGMA table_info({table})')
    return {row[1] for row in cursor.fetchall()}


def init_db():
    db_path = os.environ.get('WONDERHACK_DB') or os.path.join(
        os.path.dirname(__file__), 'wonderhack.db'
    )
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    c = conn.cursor()

    # ------------------------------------------------------------------ users
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        username        TEXT UNIQUE NOT NULL,
        display_name    TEXT NOT NULL,
        password        TEXT NOT NULL DEFAULT '',
        password_hash   TEXT NOT NULL DEFAULT '',
        email           TEXT NOT NULL DEFAULT '',
        role            TEXT NOT NULL DEFAULT 'Royal Voyager of the Keyhole',
        character       TEXT NOT NULL DEFAULT 'alice',
        points          INTEGER NOT NULL DEFAULT 0,
        points_easy     INTEGER NOT NULL DEFAULT 0,
        points_medium   INTEGER NOT NULL DEFAULT 0,
        points_hard     INTEGER NOT NULL DEFAULT 0,
        solved_puzzles  TEXT NOT NULL DEFAULT '[]',
        purchased_hints TEXT NOT NULL DEFAULT '[]',
        oauth_subject   TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT '',
        updated_at      TEXT NOT NULL DEFAULT '',
        last_login_at   TEXT NOT NULL DEFAULT ''
    )''')

    # Idempotent migrations for databases created by older versions.
    existing = _columns(c, 'users')
    migrations = [
        ('password_hash', "TEXT NOT NULL DEFAULT ''"),
        ('email', "TEXT NOT NULL DEFAULT ''"),
        ('solved_puzzles', "TEXT NOT NULL DEFAULT '[]'"),
        ('purchased_hints', "TEXT NOT NULL DEFAULT '[]'"),
        ('oauth_subject', "TEXT NOT NULL DEFAULT ''"),
        ('created_at', "TEXT NOT NULL DEFAULT ''"),
        ('updated_at', "TEXT NOT NULL DEFAULT ''"),
        ('last_login_at', "TEXT NOT NULL DEFAULT ''"),
        ('points', 'INTEGER NOT NULL DEFAULT 0'),
        ('points_easy', 'INTEGER NOT NULL DEFAULT 0'),
        ('points_medium', 'INTEGER NOT NULL DEFAULT 0'),
        ('points_hard', 'INTEGER NOT NULL DEFAULT 0'),
    ]
    for name, definition in migrations:
        if name not in existing:
            c.execute(f'ALTER TABLE users ADD COLUMN {name} {definition}')

    # Case-insensitive unique handles (ignore failures on legacy duplicates).
    try:
        c.execute('''CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase
                     ON users(LOWER(username))''')
    except sqlite3.IntegrityError:
        print('Warning: duplicate usernames found; case-insensitive index skipped.')

    # ------------------------------------------------------- flag submissions
    # Every flag attempt from the first page is logged here and tied to the
    # submitting account, so the court can audit who captured which chamber.
    c.execute('''CREATE TABLE IF NOT EXISTS flag_submissions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        difficulty      TEXT NOT NULL,
        submitted_flag  TEXT NOT NULL DEFAULT '',
        correct         INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT ''
    )''')
    c.execute('''CREATE INDEX IF NOT EXISTS idx_flag_submissions_user
                 ON flag_submissions(user_id, difficulty)''')

    # An external identity provider maps one subject to one account. Local
    # accounts keep an empty subject, so the partial index ignores them.
    try:
        c.execute('''CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_subject
                     ON users(oauth_subject) WHERE oauth_subject <> '' ''')
    except sqlite3.IntegrityError:
        print('Warning: duplicate OAuth subjects found; unique index skipped.')
    # ---------------------------------------------------------------- sessions
    # Older builds stored raw session ids. Detected and replaced so only hashed
    # session tokens are ever persisted.
    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
    if c.fetchone():
        session_cols = _columns(c, 'sessions')
        if 'session_hash' not in session_cols:
            c.execute('DROP TABLE sessions')

    c.execute('''CREATE TABLE IF NOT EXISTS sessions (
        session_hash  TEXT PRIMARY KEY,
        user_id       INTEGER NOT NULL,
        created_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL DEFAULT '',
        user_agent    TEXT NOT NULL DEFAULT '',
        ip_address    TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )''')

    # ------------------------------------------------------------------ solves
    c.execute('''CREATE TABLE IF NOT EXISTS solves (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        puzzle_id   INTEGER NOT NULL,
        points      INTEGER NOT NULL,
        solved_at   TEXT NOT NULL,
        season      INTEGER NOT NULL DEFAULT 1,
        UNIQUE (user_id, puzzle_id, season),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )''')

    # Older solves tables only had one row per (user, puzzle). The unique
    # constraint must include the season so a new season can be replayed.
    solve_cols = _columns(c, 'solves')
    if 'season' not in solve_cols:
        # SQLite cannot drop an auto-index created by a UNIQUE constraint, so
        # rebuild the table with the new schema and copy the old rows into
        # season 1.
        c.execute('ALTER TABLE solves RENAME TO solves_legacy')
        c.execute('''CREATE TABLE solves (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            puzzle_id   INTEGER NOT NULL,
            points      INTEGER NOT NULL,
            solved_at   TEXT NOT NULL,
            season      INTEGER NOT NULL DEFAULT 1,
            UNIQUE (user_id, puzzle_id, season),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )''')
        c.execute('''INSERT INTO solves (id, user_id, puzzle_id, points, solved_at, season)
                     SELECT id, user_id, puzzle_id, points, solved_at, 1
                     FROM solves_legacy''')
        c.execute('DROP TABLE solves_legacy')

    c.execute('CREATE INDEX IF NOT EXISTS idx_solves_user ON solves(user_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_solves_season ON solves(season)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_users_points ON users(points DESC)')

    # ---------------------------------------------------------------- settings
    # Small key/value store used for shared game state such as the difficulty
    # the players selected most recently (shown on the Queen's answer scroll).
    c.execute('''CREATE TABLE IF NOT EXISTS settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL DEFAULT ''
    )''')
    c.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('active_difficulty', 'easy')"
    )
    c.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('current_season', '1')"
    )
    # Used to sign the OAuth state cookie when a provider is configured. The
    # value is generated once and survives restarts.
    c.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('oauth_state_secret', ?)",
        (secrets.token_urlsafe(48),)
    )

    # ------------------------------------------------------------ admin audit
    # Every privileged mutation (player reset, season rollover) leaves a row
    # here so the administrator view can show an audit trail.
    c.execute('''CREATE TABLE IF NOT EXISTS admin_audit (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id        INTEGER NOT NULL,
        admin_username  TEXT NOT NULL DEFAULT '',
        action          TEXT NOT NULL,
        target_user_id  INTEGER,
        target_username TEXT NOT NULL DEFAULT '',
        detail          TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC)')

    # ---------------------------------------------------------------- seed users
    # Only the two privileged accounts are seeded. The former Alice and Red
    # Queen demo accounts have been removed from the registry.
    demo_users = [
        # Admin / organizer account.
        ('admin', 'The Court Administrator', 'WonderAdmin2026!',
         'Court Administrator (Admin)', 'admin', 'admin@wonderhack.local', 0),
        # The Queen of Hearts' court account.
        ('hearts_queen', "The Heart's Queen", 'hearts_and_tarts_2026',
         "The Heart's Queen — Sovereign of the Rose Court", 'queen',
         'heartsqueen@court.hearts.gov', 0),
    ]

    now = _now_iso()
    for username, display, password, role, character, email, points in demo_users:
        c.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', (username,))
        if c.fetchone():
            continue
        c.execute('''INSERT INTO users
                     (username, display_name, password, password_hash, email, role,
                      character, points, points_easy, points_medium, points_hard,
                      solved_puzzles, purchased_hints,
                      created_at, updated_at)
                     VALUES (?, ?, '', ?, ?, ?, ?, ?, 0, 0, 0, '[]', '[]', ?, ?)''',
                  (username, display, hash_password(password), email, role,
                   character, points, now, now))

    # ------------------------------------------------- hash legacy passwords
    c.execute("SELECT id, password, password_hash FROM users")
    for row in c.fetchall():
        if not row['password_hash'] and row['password']:
            c.execute(
                'UPDATE users SET password_hash = ?, password = ? WHERE id = ?',
                (hash_password(row['password']), '', row['id'])
            )

    # ------------------------------------- migrate JSON solved list -> solves
    current_season = int(
        (c.execute("SELECT value FROM settings WHERE key = 'current_season'").fetchone() or ['1'])[0]
        or 1
    )
    c.execute("SELECT id, solved_puzzles FROM users")
    for row in c.fetchall():
        try:
            solved_ids = json.loads(row['solved_puzzles'] or '[]')
        except Exception:
            solved_ids = []
        for puzzle_id in solved_ids:
            try:
                puzzle_id = int(puzzle_id)
            except (TypeError, ValueError):
                continue
            if puzzle_id not in PUZZLES:
                continue
            c.execute(
                '''INSERT OR IGNORE INTO solves
                   (user_id, puzzle_id, points, solved_at, season)
                   VALUES (?, ?, ?, ?, ?)''',
                (row['id'], puzzle_id, points_for(puzzle_id), now, current_season)
            )

    # Keep cached JSON in sync for older clients. The cache only reflects the
    # current season; past seasons remain available to the admin view.
    c.execute('SELECT id FROM users')
    for row in c.fetchall():
        c.execute(
            'SELECT puzzle_id FROM solves WHERE user_id = ? AND season = ? ORDER BY puzzle_id',
            (row['id'], current_season)
        )
        solved = [r['puzzle_id'] for r in c.fetchall()]
        c.execute('UPDATE users SET solved_puzzles = ? WHERE id = ?',
                  (json.dumps(solved), row['id']))

    # Backfill difficulty-specific points from the current season's solves.
    c.execute('''
        UPDATE users
        SET points_easy = COALESCE((
            SELECT SUM(s.points) FROM solves s
            WHERE s.user_id = users.id AND s.season = ? AND s.puzzle_id BETWEEN 1 AND 99
        ), 0),
        points_medium = COALESCE((
            SELECT SUM(s.points) FROM solves s
            WHERE s.user_id = users.id AND s.season = ? AND s.puzzle_id BETWEEN 100 AND 199
        ), 0),
        points_hard = COALESCE((
            SELECT SUM(s.points) FROM solves s
            WHERE s.user_id = users.id AND s.season = ? AND s.puzzle_id >= 200
        ), 0)
    ''', (current_season, current_season, current_season))
    c.execute('''
        UPDATE users
        SET points = points_easy + points_medium + points_hard
    ''')

    c.execute('DELETE FROM sessions WHERE expires_at < ?', (now,))
    conn.commit()
    conn.close()
    print(f"WonderHack DB initialized at {db_path}")


if __name__ == '__main__':
    init_db()
