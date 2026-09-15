"""Tests for parent PIN and recovery-code primitives."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

SPEC = spec_from_file_location(
    "home_chores_security",
    Path(__file__).parents[1] / "custom_components" / "home_chores" / "security.py",
)
assert SPEC and SPEC.loader
security = module_from_spec(SPEC)
SPEC.loader.exec_module(security)


def test_hash_round_trip() -> None:
    salt = security.new_salt()
    hashed = security.hash_secret("2468", salt)
    assert security.verify_secret("2468", salt, hashed)
    assert not security.verify_secret("2469", salt, hashed)


def test_recovery_code_format_and_entropy() -> None:
    first = security.new_recovery_code()
    second = security.new_recovery_code()
    assert len(first) == 19
    assert first.count("-") == 3
    assert first != second

