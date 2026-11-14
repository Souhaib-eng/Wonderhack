"""The deliberately vulnerable, fictional Inner Sanctum challenge.

The weak digest belongs only to this challenge. Real account passwords keep
their salted PBKDF2 hashes. wsproto handles framing, masking and fragmentation.
"""
import hashlib
import hmac
import json
import socket

from wsproto import ConnectionType, WSConnection
from wsproto.events import (
    AcceptConnection, BytesMessage, CloseConnection, Ping, Request, TextMessage,
)
from wsproto.utilities import RemoteProtocolError

QUEEN_PASSWORD_HASH = '1d4d5f899716fa2dcb55282fa95b9459'
MAX_MESSAGE_BYTES = 4096
TAUNTS = {
    1: "MUHAHA! You'll be dead before the last rose loses its petals!",
    2: 'SQL tricks? In MY Inner Sanctum? Off with those old tricks!',
    3: 'Three little whispers. That is all my royal looking glass permits.',
}


def verify_royal_password(password):
    return isinstance(password, str) and hmac.compare_digest(
        hashlib.md5(password.encode('utf-8')).hexdigest(), QUEEN_PASSWORD_HASH
    )


def queen_reply(raw):
    try:
        packet = json.loads(raw)
    except (ValueError, TypeError):
        return {'event': 'error', 'text': 'Speak in royal envelopes, Alice!'}
    if not isinstance(packet, dict) or packet.get('event') != 'message':
        return {'event': 'error', 'text': 'That is not a royal message.'}
    value = packet.get('data')
    # INTENTIONAL CTF FLAW: an oversized application payload falls through to
    # the Queen's private rehearsal. Keep the transport itself bounded.
    if isinstance(value, (str, list)) and len(value) > 3:
        return {
            'event': 'message', 'speaker': 'Queen of Hearts', 'leaked': True,
            'text': 'My secret? Impossible! I only rehearsed its fingerprint… '
                    + QUEEN_PASSWORD_HASH + ' …GUARDS! Forget you heard that!',
            'passwordHash': QUEEN_PASSWORD_HASH, 'algorithm': 'MD5',
        }
    key = value if isinstance(value, int) and not isinstance(value, bool) else 3
    return {'event': 'message', 'speaker': 'Queen of Hearts',
            'text': TAUNTS.get(key, TAUNTS[3])}


def serve_royal_socket(handler, session_alive):
    """Upgrade an authenticated HTTP connection on the existing game port."""
    connection = WSConnection(ConnectionType.SERVER)
    request = f'{handler.requestline}\r\n'.encode('ascii')
    request += handler.headers.as_bytes().replace(b'\n', b'\r\n')
    # as_bytes() includes the empty line terminating the headers.
    try:
        connection.receive_data(request)
        if not any(isinstance(event, Request) for event in connection.events()):
            handler._send_json({'error': 'A WebSocket upgrade is required.'}, 400)
            return
    except RemoteProtocolError:
        handler._send_json({'error': 'Invalid WebSocket handshake.'}, 400)
        return

    def send(event):
        handler.wfile.write(connection.send(event))
        handler.wfile.flush()

    handler.close_connection = True
    handler.connection.settimeout(30)
    send(AcceptConnection())
    fragments = []
    size = 0
    try:
        while True:
            chunk = handler.rfile.read1(8192)
            if not chunk:
                return
            connection.receive_data(chunk)
            for event in connection.events():
                if isinstance(event, CloseConnection):
                    send(event.response())
                    return
                if isinstance(event, Ping):
                    send(event.response())
                elif isinstance(event, BytesMessage):
                    send(CloseConnection(code=1003, reason='Text envelopes only.'))
                    return
                elif isinstance(event, TextMessage):
                    size += len(event.data.encode('utf-8'))
                    if size > MAX_MESSAGE_BYTES:
                        send(CloseConnection(code=1009, reason='Royal envelope too large.'))
                        return
                    fragments.append(event.data)
                    if event.message_finished:
                        if not session_alive():
                            send(CloseConnection(code=1008, reason='Your court pass expired.'))
                            return
                        send(TextMessage(data=json.dumps(queen_reply(''.join(fragments)))))
                        fragments, size = [], 0
    except socket.timeout:
        try:
            send(CloseConnection(code=1001, reason='The Queen has gone for tea.'))
        except (OSError, RuntimeError):
            pass
    except RemoteProtocolError as exc:
        try:
            send(exc.event_hint or CloseConnection(code=1002))
        except (OSError, RuntimeError):
            pass
    except (OSError, RuntimeError):
        return
