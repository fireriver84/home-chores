"""PIN hashing and recovery-code helpers for Home Chores."""

from __future__ import annotations

import hashlib
import hmac
import secrets

PBKDF2_ITERATIONS = 200_000


def new_salt() -> str:
    """Create a random salt suitable for persisted PIN hashes."""
    return secrets.token_hex(16)


def hash_secret(secret: str, salt: str) -> str:
    """Hash a PIN or recovery code using a deliberately slow KDF."""
    return hashlib.pbkdf2_hmac(
        "sha256", secret.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    ).hex()


def verify_secret(secret: str, salt: str, expected: str) -> bool:
    """Compare a supplied secret with a persisted hash."""
    return hmac.compare_digest(hash_secret(secret, salt), expected)


def new_recovery_code() -> str:
    """Create a readable, high-entropy recovery code."""
    raw = secrets.token_hex(8).upper()
    return "-".join(raw[index : index + 4] for index in range(0, 16, 4))

