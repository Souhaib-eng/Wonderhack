#!/usr/bin/env python3
"""
Export every valid WonderHack account to VALID_ACCOUNTS.txt.

This file is a debugging aid requested by the organizer. It contains plaintext
credentials for the built-in accounts, so do not publish or commit it.

Regenerate after changing seeded accounts or registering new players:
    python3 db/export_accounts.py
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wonderhack.db')
OUT_PATH = os.path.join(ROOT_DIR, 'VALID_ACCOUNTS.txt')
SRC_OUT_PATH = os.path.join(ROOT_DIR, 'src', 'VALID_ACCOUNTS.txt')

# Passwords for the built-in seeded accounts. Accounts registered through the
# web form are hashed and cannot be recovered, so they are marked unknown.
KNOWN_PASSWORDS = {
    'admin': 'WonderAdmin2026!',
    'hearts_queen': 'hearts_and_tarts_2026',
}


def main():
    if not os.path.exists(DB_PATH):
        print(f'Database not found at {DB_PATH}. Run server.py or db/init_db.py first.')
        return 1

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        '''SELECT username, display_name, role, character, points,
                  points_easy, points_medium, points_hard, email,
                  password_hash, solved_puzzles, purchased_hints
           FROM users
           ORDER BY id ASC'''
    ).fetchall()
    conn.close()

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    lines = []
    lines.append('=' * 86)
    lines.append('WONDERHACK — VALID ACCOUNT REGISTRY (DEBUG COPY)')
    lines.append('=' * 86)
    lines.append(f'Generated: {now}')
    lines.append(f'Database:  db/wonderhack.db')
    lines.append(f'Accounts:  {len(rows)}')
    lines.append('')
    lines.append('!! DEBUG FILE — CONTAINS PLAINTEXT PASSWORDS. DO NOT PUBLISH OR COMMIT. !!')
    lines.append('')
    lines.append('Login accepts either the Username or the Display Name (case-insensitive).')
    lines.append('')
    lines.append('-' * 86)
    lines.append(f'{"USERNAME":<18} {"DISPLAY NAME":<24} {"COINS":>7}  PASSWORD')
    lines.append('-' * 86)

    for row in rows:
        username = row['username']
        password = KNOWN_PASSWORDS.get(username.lower())
        if password is None:
            password = '(unknown — PBKDF2 hash stored)'

        lines.append(
            f'{username:<18} {(row["display_name"] or "")[:24]:<24} '
            f'{int(row["points"] or 0):>7}  {password}'
        )

    lines.append('-' * 86)
    lines.append('')
    lines.append('ACCOUNT DETAILS')
    lines.append('-' * 86)
    for row in rows:
        try:
            solved = json.loads(row['solved_puzzles'] or '[]')
        except Exception:
            solved = []
        try:
            hints = json.loads(row['purchased_hints'] or '[]')
        except Exception:
            hints = []

        lines.append(f'Username:       {row["username"]}')
        lines.append(f'Display name:   {row["display_name"]}')
        lines.append(f'Role:           {row["role"]}')
        lines.append(f'Character:      {row["character"]}')
        lines.append(f'Coins (Total):  {int(row["points"] or 0)}')
        lines.append(f'  - Easy:       {int(row["points_easy"] or 0)}')
        lines.append(f'  - Medium:     {int(row["points_medium"] or 0)}')
        lines.append(f'  - Hard:       {int(row["points_hard"] or 0)}')
        lines.append(f'Email:          {row["email"] or "(none)"}')
        lines.append(f'Solved puzzles: {len(solved)}')
        lines.append(f'Purchased hints:{len(hints)}')
        lines.append(f'Password:       {KNOWN_PASSWORDS.get(row["username"].lower(), "(unknown — PBKDF2 hash stored)")}')
        lines.append('')

    lines.append('Newly registered players have salted PBKDF2 hashes only; their plaintext')
    lines.append('passwords are not stored and cannot be listed here.')
    lines.append('Re-run: python3 db/export_accounts.py')
    lines.append('=' * 86)
    lines.append('')

    with open(OUT_PATH, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines))
    if os.path.exists(os.path.dirname(SRC_OUT_PATH)):
        with open(SRC_OUT_PATH, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(lines))

    print(f'Exported {len(rows)} accounts to {OUT_PATH}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
