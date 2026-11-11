#!/usr/bin/env python3
"""
Password and session-token helpers for WonderHack.

Passwords are stored as PBKDF2-HMAC-SHA256 hashes with a per-user random salt.
Session tokens are stored only as SHA-256 digests, so a database leak does not
expose usable login cookies.
"""
import hashlib
import hmac
import secrets

PBKDF2_ITERATIONS = 260_000
HASH_PREFIX = 'pbkdf2_sha256'


def hash_password(password: str) -> str:
    """Return a salted PBKDF2 hash string suitable for the users table."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), salt, PBKDF2_ITERATIONS
    )
    return f'{HASH_PREFIX}${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}'


def verify_password(stored: str, password: str) -> bool:
    """Constant-time verification of a stored password hash."""
    if not stored or password is None:
        return False

    # Legacy plaintext value (migrated on the next successful login).
    if not stored.startswith(f'{HASH_PREFIX}$'):
        return hmac.compare_digest(stored, password)

    try:
        _prefix, iterations, salt_hex, digest_hex = stored.split('$', 3)
        digest = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            bytes.fromhex(salt_hex),
            int(iterations),
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


def hash_token(token: str) -> str:
    """Session cookie values are stored as digests, never in plaintext."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()
