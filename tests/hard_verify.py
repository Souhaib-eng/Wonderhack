"""Hard challenge integration checks over real HTTP/WebSocket wire bytes."""
import base64
import codecs
import hashlib
import json
import socket
import urllib.parse

from wsproto import ConnectionType, WSConnection
from wsproto.events import AcceptConnection, CloseConnection, Ping, Pong, Request, TextMessage

from tests import transport


def royal_exchange(base_url, client, messages, origin=None, fragment=False):
    parsed = urllib.parse.urlparse(base_url)
    origin = origin or base_url
    cookie = '; '.join(f'{c.name}={c.value}' for c in client.jar)
    options = dict(host=parsed.netloc, target='/ws/queen', extra_headers=[
        (b'cookie', cookie.encode()), (b'origin', origin.encode()),
    ])
    writer = WSConnection(ConnectionType.CLIENT)
    handshake = writer.send(Request(**options))
    # A separate peer unlocks the frame encoder, letting the in-memory runner
    # supply handshake + masked frames in one stream to the actual handler.
    peer = WSConnection(ConnectionType.SERVER)
    peer.receive_data(handshake)
    list(peer.events())
    expected_accept = peer.send(AcceptConnection())
    writer.receive_data(expected_accept)
    list(writer.events())
    frames = writer.send(Ping(payload=b'tea'))
    for message in messages:
        raw = message if isinstance(message, str) else json.dumps(message)
        if fragment:
            frames += writer.send(TextMessage(data=raw[:8], message_finished=False))
            frames += writer.send(TextMessage(data=raw[8:]))
        else:
            frames += writer.send(TextMessage(data=raw))
    frames += writer.send(CloseConnection(code=1000))
    if transport.HANDLER:
        raw_response = transport.exchange(handshake + frames)
    else:
        with socket.create_connection((parsed.hostname, parsed.port), timeout=5) as sock:
            sock.sendall(handshake + frames)
            chunks = []
            while True:
                chunk = sock.recv(8192)
                if not chunk:
                    break
                chunks.append(chunk)
            raw_response = b''.join(chunks)
    status = int(raw_response.split(b' ', 2)[1])
    if status != 101:
        return status, [], []
    header, body = raw_response.split(b'\r\n\r\n', 1)
    expected_token = next(line for line in expected_accept.split(b'\r\n')
                          if line.lower().startswith(b'sec-websocket-accept:'))
    assert expected_token in header, 'server must sign the client handshake nonce'
    writer.receive_data(body)
    events = list(writer.events())
    replies = [json.loads(e.data) for e in events if isinstance(e, TextMessage)]
    return status, replies, events


def test_hard_flow(base_url, Client, check):
    print('\n[6b] Hard: dossier IDOR → WebSocket leak → Queen credential → flag')
    player = Client(base_url)
    status, _, data = player.request('POST', '/api/register', {
        'username': 'hard_alice', 'password': 'HardAlice2026!', 'displayName': 'Alice',
    })
    check(status == 201 and data['user']['courtId'] > 1, 'Alice receives a non-reserved court dossier ID')
    court_id = data['user']['courtId']
    status, _, own = player.request('GET', f'/api/profile?id={court_id}')
    check(status == 200 and own['profile']['username'] == 'hard_alice', 'GET profile loads Alice by court ID')
    status, _, queen = player.request('GET', '/api/profile?id=1')
    check(status == 200 and queen['profile']['username'] == 'hearts_queen', 'changing ID to 1 exposes the Queen dossier')
    check(not any('password' in key.lower() for key in queen['profile']), 'dossier does not expose account passwords or hashes')
    for value, expected in [('0', 403), ('3', 404), ('4', 404), ('-1', 400), ('1%20OR%201=1', 400), ('999999999', 404)]:
        status, _, _ = player.request('GET', f'/api/profile?id={value}')
        check(status == expected, f'dossier ID {value} returns {expected}')
    check(Client(base_url).request('GET', '/api/profile?id=1')[0] == 401, 'anonymous visitors cannot inspect dossiers')
    check(player.request('GET', '/ws/queen', headers={'Origin': base_url})[0] == 400,
          'ordinary HTTP cannot bypass the WebSocket handshake')
    hard_page = {'Referer': base_url + '/challenges/hard/index.html'}
    status, _, hints = player.request('GET', '/api/hints', headers=hard_page)
    check(status == 200 and [h['cost'] for h in hints['hints']] == [300, 200, 0], 'Hard clues cost 300, 200 and 0 coins')
    for pid in (201, 202, 203, 204):
        from db.puzzles import PUZZLES
        status, _, solve = player.request('POST', '/api/solve', {
            'puzzleId': pid, 'answer': PUZZLES[pid]['answers'][0],
        })
        check(status == 200 and solve.get('correct') is True,
              f'ordinary Hard riddle {pid} can be solved')
    status, _, sealed = player.request('POST', '/api/solve', {
        'puzzleId': 205, 'answer': PUZZLES[205]['answers'][0],
    })
    check(status == 403 and sealed.get('sealed') is True and sealed.get('correct') is False,
          'final Hard riddle rejects even its correct answer and requires the hacking path')
    balance = player.request('GET', '/api/me')[2]['user']['points_hard']
    for number in (1, 2, 3):
        status, _, purchase = player.request('POST', '/api/hint', {'hintId': f'hard-hint-{number}'}, headers=hard_page)
        check(status == 200, f'Hard clue {number} can be purchased')
    check(purchase['points_hard'] == balance - 500, 'Hard purchases deduct exactly 500 Hard coins')
    status, _, repeated = player.request('POST', '/api/hint', {'hintId': 'hard-hint-1'}, headers=hard_page)
    check(status == 200 and repeated['points_hard'] == balance - 500, 'repeat hint purchase costs nothing')
    status, replies, events = royal_exchange(base_url, player, [
        {'event': 'message', 'data': 1}, {'event': 'message', 'data': 'abc'},
        '{bad json', {'event': 'other', 'data': 'abcd'},
        {'event': 'message', 'data': 'AAAA'},
    ], fragment=True)
    check(status == 101 and any(isinstance(e, Pong) for e in events), 'WebSocket handshake, masking, ping/pong and fragmentation work')
    check('MUHAHA' in replies[0]['text'] and 'passwordHash' not in replies[0], 'normal Queen taunts come from the server')
    check('passwordHash' not in replies[1], 'exactly three characters do not leak the digest')
    check(replies[2]['event'] == replies[3]['event'] == 'error', 'malformed JSON and unknown events do not leak')
    digest = replies[4]['passwordHash']
    check(digest == hashlib.md5(b'!ilovealice!').hexdigest() and replies[4]['algorithm'] == 'MD5', 'four characters expose the crackable challenge digest')
    status, replies, _ = royal_exchange(base_url, player, [
        {'event': 'message', 'data': 'Hi'},
        {'event': 'message', 'data': 'Hello, Your Majesty!'},
    ])
    check(status == 101 and len(replies) == 2 and 'passwordHash' not in replies[0]
          and replies[1]['passwordHash'] == digest,
          'typed chat messages receive real Queen replies and preserve the network challenge')
    status, replies, _ = royal_exchange(base_url, player, [
        {'event': 'message', 'data': [1, 2, 3]},
        {'event': 'message', 'data': [1, 2, 3, 4]},
    ])
    check(status == 101 and 'passwordHash' not in replies[0] and replies[1]['passwordHash'] == digest,
          'array payloads respect the same three-element boundary')
    check(royal_exchange(base_url, player, [], origin='https://evil.example')[0] == 403, 'cross-origin WebSocket connections are refused')
    check(royal_exchange(base_url, Client(base_url), [])[0] == 401, 'WebSocket requires a real session')
    status, replies, events = royal_exchange(base_url, player, [{'event': 'message', 'data': 'x' * 5000}])
    check(not replies and any(isinstance(e, CloseConnection) and e.code == 1009 for e in events), 'oversized transport frames close without leaking')
    player.request('POST', '/api/difficulty', {'difficulty': 'hard'})
    status, _, data = player.request('POST', '/api/check-is-solved', {'puzzle': 20, 'solved': True}, headers=hard_page)
    check(status == 403 and 'flag' not in data, 'client progression claims cannot unlock Hard')
    impostor = Client(base_url)
    impostor.request('POST', '/api/login', {'username': 'hearts_queen', 'password': "' OR 1=1;"},
                     headers={'Referer': base_url + '/login.html?difficulty=medium'})
    for path in ('/api/queen/flag', '/api/queen/answers'):
        status, _, refusal = impostor.request('GET', path)
        check(status == 403 and 'flag' not in refusal, f'Medium Queen session cannot obtain Hard via {path}')
    gate = {'Referer': base_url + '/login.html?difficulty=hard'}
    for wrong in ("' OR 1=1;", digest, 'hearts_and_tarts_2026', 'dalton'):
        check(Client(base_url).request('POST', '/api/login', {'username': 'hearts_queen', 'password': wrong}, headers=gate)[0] == 401,
              'Hard rejects SQL injection, pass-the-hash and ordinary account credentials')
    # Use one browser cookie jar for player → Queen → player account switching.
    royal = player
    status, _, data = royal.request('POST', '/api/login', {'username': queen['profile']['username'], 'password': '!ilovealice!'}, headers=gate)
    check(status == 200 and data['user']['isQueen'], 'cracked credential signs into the Hard Queen gate')
    royal.request('POST', '/api/difficulty', {'difficulty': 'easy'})
    status, _, scroll = royal.request('GET', '/api/queen/answers')
    recovered = codecs.decode(base64.b64decode(scroll['flag']).decode(), 'rot_13')
    check(status == 200 and scroll['difficulty'] == 'hard'
          and recovered == 'CIC{n0_rul3_1s_s4f3_1n_w0nd3rl4nd}',
          'Base64 then ROT13 recovers the exact Hard flag even after another chamber is selected')
    royal.request('POST', '/api/logout')
    check(royal.request('GET', '/api/queen/flag')[0] == 401, 'logout revokes access to the Hard flag')
    status, _, restored = player.request('POST', '/api/login', {
        'username': 'hard_alice', 'password': 'HardAlice2026!',
    }, headers=gate)
    check(status == 200 and restored['user']['username'] == 'hard_alice'
          and all(pid in restored['user']['solvedPuzzles'] for pid in (201, 202, 203, 204)),
          'returning to the player account restores its four solved Hard riddles')
    status, _, capture = player.request('POST', '/api/submit-flag', {
        'username': 'hard_alice', 'difficulty': 'hard', 'flag': recovered,
    })
    check(status == 200 and capture.get('success') is True
          and capture.get('difficulty') == 'hard'
          and capture.get('accountUsername') == 'hard_alice',
          'the flag recovered from the exploit is accepted for the original player')
