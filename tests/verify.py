"""WonderHack regression suite.

Run from the repository root:

    python3 -m tests.verify

The suite boots a throwaway copy of the server against a temporary SQLite
database, so it never touches the real ``src/db/wonderhack.db``.
"""

import base64
import codecs
import http.cookiejar
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from db.puzzles import PUZZLES, difficulty_for, points_for  # noqa: E402

EASY_FLAG = 'CIC{cur10us_4l1c3}'
MEDIUM_FLAG = 'CIC{th3_qu33n_4lw4ys_w4tch3s}'
HARD_FLAG = 'CIC{n0_rul3_1s_s4f3_1n_w0nd3rl4nd}'
FLAGS = (EASY_FLAG, MEDIUM_FLAG, HARD_FLAG)

PASSED = 0


def check(condition, message):
    global PASSED
    if not condition:
        raise AssertionError(message)
    PASSED += 1
    print(f'  ✓ {message}')


class Client:
    def __init__(self, base_url):
        self.base_url = base_url
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )
        self.no_redirect = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            NoRedirect(),
        )

    def request(self, method, path, body=None, headers=None, follow=True):
        data = None
        request_headers = {'Accept': 'application/json'}
        if body is not None:
            data = json.dumps(body).encode('utf-8')
            request_headers['Content-Type'] = 'application/json'
        request_headers.update(headers or {})
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers=request_headers,
        )
        opener = self.opener if follow else self.no_redirect
        try:
            with opener.open(request, timeout=10) as response:
                raw = response.read()
                return response.status, response.headers, _maybe_json(raw)
        except urllib.error.HTTPError as error:
            raw = error.read()
            return error.code, error.headers, _maybe_json(raw)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _maybe_json(raw):
    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:
        return raw.decode('utf-8', 'replace')


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def _wait_for_server(base_url, process, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ''
            raise RuntimeError(f'Server exited early:\n{output}')
        try:
            with urllib.request.urlopen(base_url + '/api/db-status', timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError('Server did not become ready in time.')


def _answer_for(puzzle_id):
    answer = PUZZLES[puzzle_id]['answers'][0]
    return answer


def _unseal(sealed, difficulty):
    """Undo the chamber's seal exactly as the Cipher Lab tools would."""
    if difficulty == 'easy':
        value = base64.b64decode(sealed).decode('ascii')
        pairs = [value[i:i + 2] for i in range(len(value) - 2, -1, -2)]
        value = ''.join(chr(int(pair, 16)) for pair in pairs)
        value = codecs.encode(value, 'rot_13')
        return urllib.parse.unquote(value)
    return codecs.encode(base64.b64decode(sealed).decode('ascii'), 'rot_13')


def test_public_assets_have_no_flags():
    print('\n[1] Public assets never contain a plaintext flag')
    offenders = []
    for path in (ROOT / 'public').rglob('*'):
        if not path.is_file():
            continue
        if path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf', '.ico'}:
            continue
        try:
            text = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for flag in FLAGS:
            if flag in text:
                offenders.append(f'{path.relative_to(ROOT)} → {flag}')
    check(not offenders, 'no public file contains a plaintext flag')
    if offenders:
        print('      ' + '\n      '.join(offenders))


def test_shop_markup_has_medium_hints():
    print('\n[1b] The Medium shop ships the Medium clues')
    shop_js = (ROOT / 'public' / 'js' / 'mad-hatter.js').read_text(encoding='utf-8')
    for hint_id, cost in (('medium-hint-1', 200), ('medium-hint-2', 300),
                          ('medium-hint-3', 0)):
        check(f"id: '{hint_id}'" in shop_js,
              f'the shop bundle defines {hint_id}')
    check('medium-hint-1' in shop_js and 'cost: 200' in shop_js,
          'the first Medium clue costs 200 Sovereigns')
    check("'hearts_queen'" in shop_js,
          'the last Medium clue names the Queen account')
    easy_js = (ROOT / 'public' / 'js' / 'wonderhack-easy-hints.js').read_text(encoding='utf-8')
    for hint_id in ('easy-hint-1', 'easy-hint-2', 'easy-hint-3',
                    'easy-hint-4', 'easy-hint-5'):
        check(hint_id in easy_js, f'the Easy catalogue keeps {hint_id}')


def test_health(base_url):
    print('\n[2] Server and database health')
    client = Client(base_url)
    status, _, data = client.request('GET', '/api/db-status')
    check(status == 200 and data.get('status') == 'connected', 'db-status reports a connected SQLite registry')


def test_player_flow(base_url):
    print('\n[3] Registration, server scoring and per-chamber progress')
    client = Client(base_url)
    status, _, data = client.request('POST', '/api/register', {
        'username': 'verify_player',
        'password': 'VerifyPass2026!',
        'displayName': 'Verify Player',
    })
    check(status == 201 and data.get('success') is True, 'player account is created')
    check(data['user']['progressByDifficulty']['easy']['total'] == 15,
          'Easy chamber reports 15 trials in progress totals')

    status, _, data = client.request('GET', '/api/puzzles')
    check(status == 200 and data.get('puzzles'), 'public puzzle catalogue loads')
    check(all('answers' not in puzzle for puzzle in data['puzzles']),
          'catalogue never exposes accepted answers')

    puzzle_id = 1
    difficulty = difficulty_for(puzzle_id)
    status, _, data = client.request('POST', '/api/solve', {
        'puzzleId': puzzle_id,
        'answer': _answer_for(puzzle_id),
    })
    check(status == 200 and data.get('correct') is True, 'server validates a correct answer')
    check(data.get('awardedPoints') == points_for(puzzle_id), 'server awards the catalogue point value')
    check(difficulty in data.get('progressByDifficulty', {}), 'solve response includes chamber progress')
    check(data['progressByDifficulty'][difficulty]['solved'] >= 1,
          'solve response increments the matching chamber')

    status, _, duplicate = client.request('POST', '/api/solve', {
        'puzzleId': puzzle_id,
        'answer': _answer_for(puzzle_id),
    })
    check(status == 200 and duplicate.get('alreadySolved') is True,
          'a repeated solve is recorded only once')
    check(duplicate.get('awardedPoints') == 0, 'a repeated solve awards no extra coins')

    status, _, me = client.request('GET', '/api/me')
    check(status == 200 and me['user']['progressByDifficulty']['easy']['solved'] == 1,
          '/api/me restores per-chamber progress')

    status, _, data = client.request('GET', '/api/leaderboard')
    check(status == 403 and data.get('success') is False,
          'non-administrators are refused the leaderboard')

    status, _, data = client.request('GET', '/api/queen/answers')
    check(status == 403, "non-Queen accounts cannot read the Queen's answer scroll")

    return client


def test_cheshire_unlock(base_url):
    print('\n[3b] Cipher Lab pass: hints first, exact 200-coin deduction, idempotent')
    client = Client(base_url)
    status, _, _ = client.request('POST', '/api/register', {
        'username': 'verify_lab',
        'password': 'VerifyLab2026!',
        'displayName': 'Verify Lab',
    })
    check(status == 201, 'Cipher Lab tester registers')

    status, _, data = client.request('POST', '/api/cheshire/unlock')
    check(status == 403 and data.get('locked') is True,
          'Cipher Lab pass is locked until every Easy hint is owned')

    for puzzle_id in (1, 2, 3):
        client.request('POST', '/api/solve', {
            'puzzleId': puzzle_id,
            'answer': _answer_for(puzzle_id),
        })

    for hint_id in ('easy-hint-1', 'easy-hint-2', 'easy-hint-3',
                    'easy-hint-4', 'easy-hint-5'):
        status, _, data = client.request('POST', '/api/hint', {'hintId': hint_id})
        check(status == 200 and data.get('success') is True,
              f'{hint_id} is purchased before the Cipher Lab pass')

    status, _, data = client.request('POST', '/api/cheshire/unlock')
    check(status == 400 and data.get('needed') == 200,
          'Cipher Lab pass refuses an insufficient Easy balance')

    for puzzle_id in (4, 5, 6):
        client.request('POST', '/api/solve', {
            'puzzleId': puzzle_id,
            'answer': _answer_for(puzzle_id),
        })

    status, _, data = client.request('POST', '/api/cheshire/unlock')
    check(status == 200 and data.get('success') is True,
          'Cipher Lab pass unlocks with enough Easy coins')
    check(data.get('points_easy') == 0, 'the pass deducts exactly 200 Easy Sovereigns')
    check('cheshire-cat-pass' in data.get('purchasedHints', []),
          'the paid pass is recorded in purchased hints')

    status, _, data = client.request('POST', '/api/cheshire/unlock')
    check(status == 200 and data.get('alreadyUnlocked') is True,
          'a second Cipher Lab purchase is idempotent and free')
    check(data.get('cost') == 0, 'the idempotent pass costs nothing extra')


def test_easy_exploit(base_url):
    print('\n[4] The Easy flag is sealed by isSolved() and decoded by the player')
    client = Client(base_url)
    easy_referer = {'Referer': base_url + '/challenges/easy/index.html'}

    status, _, cipher_lab = client.request(
        'GET', '/api/cheshire',
        headers=easy_referer,
    )
    check(status == 200 and cipher_lab.get('success') is True,
          'the cat helps the Easy chamber with decoding instructions')
    operations = [entry['operation'] for entry in cipher_lab.get('steps', [])]
    check(operations == ['base64-decode', 'reverse-hex', 'rot13', 'url-decode'],
          'the cat guides Base64 → Reverse Hex → ROT13 → URL Decode')
    check('encoded' not in cipher_lab,
          'the cat never hands out the sealed cipher value')
    check(EASY_FLAG not in json.dumps(cipher_lab),
          'the cat instructions never contain the plaintext flag')

    for referer_path, label in (
        ('/challenges/medium/index.html', 'Medium'),
        ('/challenges/hard/index.html', 'Hard'),
    ):
        status, _, cat_refusal = client.request(
            'GET', '/api/cheshire',
            headers={'Referer': base_url + referer_path},
        )
        check(status == 403 and cat_refusal.get('immune') is True,
              f'the cat gives no instructions in the {label} chamber')
        check(EASY_FLAG not in json.dumps(cat_refusal),
              f'the {label} cat refusal never leaks the flag')

    status, _, data = client.request('POST', '/api/check-is-solved', {
        'puzzle': 30,
        'solved': True,
    }, headers=easy_referer)
    sealed = data.get('flag')
    check(status == 200 and bool(sealed),
          'Easy isSolved() returns a sealed flag cipher')
    check(data.get('sealed') is True and EASY_FLAG not in (sealed or ''),
          'isSolved() never returns the plaintext Easy flag')
    check(data.get('title') == 'The Final Trial', 'ordinal 30 is labelled The Final Trial')
    check(data.get('difficulty') == 'Easy', 'ordinal 30 reports the Easy chamber label')

    for referer_path, label in (
        ('/challenges/medium/index.html', 'Medium'),
        ('/challenges/hard/index.html', 'Hard'),
    ):
        status, _, data = client.request('POST', '/api/check-is-solved', {
            'puzzle': 30,
            'solved': True,
        }, headers={'Referer': base_url + referer_path})
        check(status == 403 and data.get('flag') is None,
              f'{label} referer is immune and receives no flag')
        check(data.get('immune') is True, f'{label} response is marked immune')

    status, _, data = client.request('POST', '/api/check-is-solved', {
        'puzzle': 30,
        'solved': True,
    })
    check(status == 403 and data.get('flag') is None,
          'a request without a trusted Referer receives no flag')

    status, _, _ = client.request('POST', '/api/cheshire/advance', {
        'step': 0, 'operation': 'base64-decode', 'input': 'x',
    })
    check(status == 404, 'the automatic cipher-advance endpoint is gone')

    # The player performs the four operations themselves, exactly as the lab
    # buttons do. The server never returns the plaintext or intermediate values.
    current = base64.b64decode(sealed).decode('ascii')
    pairs = [current[i:i + 2] for i in range(len(current) - 2, -1, -2)]
    current = ''.join(chr(int(pair, 16)) for pair in pairs)
    current = codecs.encode(current, 'rot_13')
    current = urllib.parse.unquote(current)
    check(current == EASY_FLAG,
          'the player can recover the plaintext easy flag with the lab tools')

    status, _, data = client.request('POST', '/api/flag', {'flag': EASY_FLAG})
    check(status == 404, 'the legacy /api/flag endpoint is gone')


def test_medium_flow(base_url):
    print('\n[4b] Medium SQL-injection login, Queen flag and hint shop')
    # The chamber selector is global; put the realm in Medium first.
    Client(base_url).request('POST', '/api/difficulty', {'difficulty': 'medium'})

    medium_referer = {'Referer': base_url + '/challenges/medium/index.html'}

    # The classic payload authenticates as the Queen without her password.
    client = Client(base_url)
    status, _, data = client.request('POST', '/api/login', {
        'username': "' OR 1=1;",
        'password': 'not-the-queens-password',
    }, headers=medium_referer)
    check(status == 200 and data.get('success') is True,
          "Medium login is vulnerable to ' OR 1=1;")
    check(data['user']['username'] == 'hearts_queen' and data['user'].get('isQueen') is True,
          'the injection resolves to the Queen account only')

    status, _, answers = client.request('GET', '/api/queen/answers')
    check(status == 200 and answers.get('sealed') is True
          and MEDIUM_FLAG not in json.dumps(answers),
          'the injected Queen session receives the Medium flag sealed')
    check(_unseal(answers.get('flag'), 'medium') == MEDIUM_FLAG,
          'Base64 then ROT13 unseals the Medium flag for the injected Queen')

    # The very same payload is inert in Easy and Hard: the form there is not the
    # Medium login page, so the concatenated lookup is never reached.
    for referer_path, label in (
        ('/challenges/easy/index.html', 'Easy'),
        ('/challenges/hard/index.html', 'Hard'),
    ):
        Client(base_url).request('POST', '/api/difficulty', {'difficulty': label.lower()})
        probe = Client(base_url)
        status, _, data = probe.request('POST', '/api/login', {
            'username': "' OR 1=1;",
            'password': 'still-not-the-queens-password',
        }, headers={'Referer': base_url + referer_path})
        check(status == 401 and data.get('success') is False,
              f'the SQL injection is rejected in the {label} chamber')

    # The live Medium form is served by login.html?difficulty=medium, so the
    # payload must work from that page too.
    status, _, data = Client(base_url).request('POST', '/api/login', {
        'username': "' OR 1=1;",
        'password': 'still-not-the-queens-password',
    }, headers={'Referer': base_url + '/login.html?difficulty=medium'})
    check(status == 200 and data.get('user', {}).get('username') == 'hearts_queen',
          'the Medium login page resolves the injection to the Queen')

    # The same login page opened for Easy or Hard stays immune.
    for label in ('easy', 'hard'):
        status, _, data = Client(base_url).request('POST', '/api/login', {
            'username': "' OR 1=1;",
            'password': 'still-not-the-queens-password',
        }, headers={'Referer': base_url + f'/login.html?difficulty={label}'})
        check(status == 401 and data.get('success') is False,
              f'the {label.title()} login page rejects the injection')

    # Even without any chamber context the payload cannot be used.
    status, _, data = Client(base_url).request('POST', '/api/login', {
        'username': "' OR 1=1;",
        'password': 'still-not-the-queens-password',
    })
    check(status == 401 and data.get('success') is False,
          'the SQL injection is rejected without a chamber referer')

    # Medium hints cost 200 / 300 / 0 Medium Sovereigns, and the shop catalogue
    # is the Medium one for a request coming from the Medium chamber.
    Client(base_url).request('POST', '/api/difficulty', {'difficulty': 'medium'})
    shop = Client(base_url)
    status, _, _ = shop.request('POST', '/api/register', {
        'username': 'verify_medium_shop',
        'password': 'VerifyMedium2026!',
        'displayName': 'Verify Medium Shop',
    })
    check(status == 201, 'Medium hint shopper registers')

    status, _, catalogue = shop.request('GET', '/api/hints', headers=medium_referer)
    check(status == 200 and catalogue.get('difficulty') == 'medium',
          'the Medium chamber is served the Medium hint catalogue')
    check([hint['id'] for hint in catalogue.get('hints', [])] == [
        'medium-hint-1', 'medium-hint-2', 'medium-hint-3'
    ], 'the Medium catalogue lists the three paid clues')
    check(all('answer' not in hint for hint in catalogue.get('hints', [])),
          'the hint catalogue never leaks an accepted answer')

    # The shop page is opened from the chamber with ?from=<chamber>, so that
    # page's Referer must resolve to the same catalogue.
    status, _, from_shop = shop.request('GET', '/api/hints', headers={
        'Referer': base_url + '/mad-hatter.html?from=medium'
    })
    check(status == 200 and from_shop.get('difficulty') == 'medium',
          'the shop page opened from the Medium chamber gets the Medium clues')

    easy_referer = {'Referer': base_url + '/challenges/easy/index.html'}
    status, _, easy_catalogue = shop.request('GET', '/api/hints', headers=easy_referer)
    check(status == 200 and easy_catalogue.get('difficulty') == 'easy',
          'the Easy chamber is served the Easy hint catalogue')
    check([hint['id'] for hint in easy_catalogue.get('hints', [])][0] == 'easy-hint-1',
          'the Easy catalogue lists the Easy clues, not the Medium ones')

    status, _, data = shop.request('POST', '/api/hint', {'hintId': 'medium-hint-1'})
    check(status == 400 and data.get('needed') == 200,
          'medium-hint-1 refuses a purse below 200 Medium Sovereigns')

    for puzzle_id in (101, 102):
        shop.request('POST', '/api/solve', {
            'puzzleId': puzzle_id,
            'answer': _answer_for(puzzle_id),
        })

    status, _, data = shop.request('POST', '/api/hint', {'hintId': 'medium-hint-1'})
    check(status == 200 and data.get('success') is True and data.get('cost') == 200,
          'medium-hint-1 costs exactly 200 Medium Sovereigns')
    check(data.get('points_medium') == 0, 'the purchase leaves the Medium purse empty')
    check(data.get('points_easy') == 0, 'the Medium purchase never touches Easy coins')

    status, _, data = shop.request('POST', '/api/hint', {'hintId': 'medium-hint-2'})
    check(status == 400 and data.get('needed') == 300,
          'medium-hint-2 requires 300 Medium Sovereigns')

    for puzzle_id in (103, 104, 105):
        shop.request('POST', '/api/solve', {
            'puzzleId': puzzle_id,
            'answer': _answer_for(puzzle_id),
        })

    status, _, data = shop.request('POST', '/api/hint', {'hintId': 'medium-hint-2'})
    check(status == 200 and data.get('cost') == 300,
          'medium-hint-2 costs exactly 300 Medium Sovereigns')

    status, _, data = shop.request('POST', '/api/hint', {'hintId': 'medium-hint-3'})
    check(status == 200 and data.get('cost') == 0,
          'medium-hint-3 is free once the earlier clues are bought')

    # Restore a neutral chamber for the next suite.
    Client(base_url).request('POST', '/api/difficulty', {'difficulty': 'easy'})


def test_flag_submissions(base_url):
    print('\n[6b] Flag submission from the first page claims flags per account')
    client = Client(base_url)

    status, _, data = client.request('POST', '/api/register', {
        'username': 'verify_flagman',
        'password': 'VerifyFlag2026!',
        'displayName': 'Verify Flagman',
    })
    check(status == 201, 'the flag submitter registers')

    status, _, data = client.request('POST', '/api/submit-flag', {
        'username': 'verify_flagman', 'difficulty': 'easy', 'flag': '',
    })
    check(status == 400, 'an empty flag is refused')

    status, _, data = client.request('POST', '/api/submit-flag', {
        'username': 'verify_flagman', 'difficulty': 'medium',
        'flag': 'CIC{not_the_real_flag}',
    })
    check(status == 400 and data.get('correct') is False,
          'a wrong flag is refused and logged as incorrect')

    status, _, data = client.request('POST', '/api/submit-flag', {
        'username': 'ghost_account', 'difficulty': 'easy', 'flag': EASY_FLAG,
    })
    check(status == 404, 'a submission for an unknown account is refused')

    status, _, data = client.request('POST', '/api/submit-flag', {
        'username': 'verify_flagman', 'difficulty': 'medium', 'flag': MEDIUM_FLAG,
    })
    check(status == 200 and data.get('success') is True
          and data.get('alreadyCaptured') is False,
          'the Medium flag is claimed by the account')

    status, _, data = client.request('POST', '/api/submit-flag', {
        'username': 'Verify Flagman', 'difficulty': 'medium', 'flag': MEDIUM_FLAG,
    })
    check(status == 200 and data.get('alreadyCaptured') is True,
          'a repeat capture by display name is idempotent')

    status, _, data = client.request('POST', '/api/submit-flag', {
        'username': 'verify_flagman', 'difficulty': 'hard', 'flag': HARD_FLAG,
    })
    check(status == 200 and data.get('success') is True,
          'the Hard flag is claimed by the account')

    status, _, data = client.request('POST', '/api/submit-flag', {
        'username': 'verify_flagman', 'difficulty': 'easy', 'flag': EASY_FLAG,
    })
    check(status == 200 and data.get('success') is True,
          'the Easy flag is claimed by the account')


def test_admin_and_seasons(base_url):
    print('\n[5] Administrator monitoring, audit trail and season rollover')
    admin = Client(base_url)
    status, _, data = admin.request('POST', '/api/login', {
        'username': 'admin',
        'password': 'WonderAdmin2026!',
    })
    check(status == 200 and data.get('success') is True, 'administrator signs in')

    status, _, board = admin.request('GET', '/api/leaderboard?difficulty=easy&season=current')
    check(status == 200 and board.get('success') is True, 'leaderboard accepts chamber and season filters')
    check(board.get('difficulty') == 'easy' and board.get('seasonMode') == 'current',
          'leaderboard echoes the requested filters')
    check(any(entry['accountUsername'] == 'verify_player' for entry in board['leaderboard']),
          'leaderboard includes the registered player')

    status, _, players = admin.request('GET', '/api/admin/players?search=verify_player')
    check(status == 200 and players.get('total') == 1, 'admin player registry supports search')
    player_entry = players['players'][0]
    check(player_entry['solvedCount'] == 1, 'admin registry shows the solved count')

    status, _, solves = admin.request('GET', '/api/admin/solves')
    check(status == 200 and solves.get('total') >= 1, 'admin solve feed lists recorded solves')

    status, _, audit = admin.request('GET', '/api/admin/audit')
    check(status == 200 and isinstance(audit.get('audit'), list), 'admin audit trail is readable')

    status, _, rollover = admin.request('POST', '/api/admin/season/rollover', {'confirm': 'ROLLOVER'})
    check(status == 200 and rollover.get('season') == 2, 'season rollover starts season 2')

    player = Client(base_url)
    status, _, data = player.request('POST', '/api/login', {
        'username': 'verify_player',
        'password': 'VerifyPass2026!',
    })
    check(status == 200 and data.get('success') is True, 'player can sign in after rollover')
    check(data['user']['points'] == 0, 'rollover resets the player point balance')
    check(data['user']['solvedPuzzles'] == [], 'rollover clears the current-season solved cache')
    check(data['user']['progressByDifficulty']['easy']['solved'] == 0,
          'rollover resets per-chamber progress')

    status, _, all_time = admin.request('GET', '/api/leaderboard?difficulty=all&season=all')
    archived = next((entry for entry in all_time['leaderboard']
                     if entry['accountUsername'] == 'verify_player'), None)
    check(archived is not None and archived['points'] >= points_for(1),
          'season=all still aggregates the archived solve')

    status, _, current = admin.request('GET', '/api/leaderboard?difficulty=all&season=current')
    current_entry = next((entry for entry in current['leaderboard']
                          if entry['accountUsername'] == 'verify_player'), None)
    check(current_entry is not None and current_entry['points'] == 0,
          'season=current shows only the new season')

    status, _, result = admin.request('POST', '/api/admin/players/reset', {
        'userId': player_entry['id'],
        'confirm': 'RESET',
    })
    check(status == 200 and result.get('success') is True, 'administrator can reset a player')

    status, _, audit = admin.request('GET', '/api/admin/audit')
    actions = [entry['action'] for entry in audit['audit']]
    check('season-rollover' in actions and 'reset-player' in actions,
          'privileged actions are written to the audit trail')

    status, _, result = admin.request('POST', '/api/admin/players/reset', {
        'username': 'admin',
        'confirm': 'RESET',
    })
    check(status == 403, 'privileged accounts cannot be reset')

    return admin


def test_queen_flow(base_url):
    print("\n[6] The Queen's private answer scroll and flag")
    queen = Client(base_url)
    status, _, data = queen.request('POST', '/api/login', {
        'username': 'hearts_queen',
        'password': 'hearts_and_tarts_2026',
    })
    check(status == 200 and data.get('success') is True, "The Heart's Queen signs in")

    status, _, data = queen.request('POST', '/api/difficulty', {'difficulty': 'medium'})
    check(status == 200 and data.get('flag') is None,
          'the public difficulty endpoint never returns a flag')

    status, _, answers = queen.request('GET', '/api/queen/answers')
    check(status == 200 and answers.get('sealed') is True
          and MEDIUM_FLAG not in json.dumps(answers)
          and _unseal(answers.get('flag'), 'medium') == MEDIUM_FLAG,
          "the Queen's scroll shows the sealed active-chamber flag")
    check(len(answers.get('puzzles', [])) == len(PUZZLES),
          "the Queen's scroll contains every accepted answer")

    status, _, flag = queen.request('GET', '/api/queen/flag')
    check(status == 200 and flag.get('sealed') is True
          and _unseal(flag.get('flag'), 'medium') == MEDIUM_FLAG,
          'the lightweight Queen flag endpoint follows the active chamber')

    queen.request('POST', '/api/difficulty', {'difficulty': 'hard'})
    status, _, flag = queen.request('GET', '/api/queen/flag')
    check(_unseal(flag.get('flag'), 'hard') == HARD_FLAG,
          'switching to Hard updates the royal flag')

    queen.request('POST', '/api/difficulty', {'difficulty': 'easy'})
    status, _, flag = queen.request('GET', '/api/queen/flag')
    check(_unseal(flag.get('flag'), 'easy') == EASY_FLAG,
          'switching back to Easy restores the Easy flag')


def test_oauth_disabled(base_url):
    print('\n[7] OAuth stays hidden and disabled without a provider')
    client = Client(base_url)
    status, _, data = client.request('GET', '/api/oauth/status')
    check(status == 200 and data.get('enabled') is False,
          'OAuth status reports disabled on a stock install')
    status, headers, _ = client.request('GET', '/api/oauth/start', follow=False)
    check(status == 302 and headers.get('Location', '').endswith('/login.html?oauth=disabled'),
          'OAuth start redirects to the disabled notice')


def main():
    temp_dir = Path(tempfile.mkdtemp(prefix='wonderhack-verify-'))
    db_path = temp_dir / 'verify.db'
    port = _free_port()
    base_url = f'http://127.0.0.1:{port}'

    env = os.environ.copy()
    env['WONDERHACK_DB'] = str(db_path)
    env['PORT'] = str(port)
    env['PYTHONUNBUFFERED'] = '1'

    process = subprocess.Popen(
        [sys.executable, str(SRC / 'server.py')],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        _wait_for_server(base_url, process)
        print(f'WonderHack regression suite → {base_url} (temporary DB: {db_path})')
        test_public_assets_have_no_flags()
        test_shop_markup_has_medium_hints()
        test_health(base_url)
        test_player_flow(base_url)
        test_cheshire_unlock(base_url)
        test_easy_exploit(base_url)
        test_medium_flow(base_url)
        test_flag_submissions(base_url)
        test_admin_and_seasons(base_url)
        test_queen_flow(base_url)
        test_oauth_disabled(base_url)
        print(f'\n✅ All {PASSED} checks passed.')
        return 0
    except Exception as exc:
        print(f'\n❌ Regression suite failed: {exc}', file=sys.stderr)
        return 1
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
