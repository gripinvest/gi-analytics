"""Tests for backend/routers/projects.py — specifically the defensive
JSON reader that prevents 500s when a manifest file is half-written
mid-cron. Real incident 2026-05-28 (D-26).
"""
from __future__ import annotations
import sys
from pathlib import Path

# Make the backend package importable from /grip-analytics/.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from routers.projects import _read_json_safe  # noqa: E402


def test_read_json_safe_returns_default_when_missing(tmp_path):
    """The file doesn't exist — return the default."""
    assert _read_json_safe(tmp_path / "absent.json", default={}) == {}
    assert _read_json_safe(tmp_path / "absent.json", default=None) is None


def test_read_json_safe_returns_parsed_json_when_valid(tmp_path):
    """Valid JSON — return the parsed object."""
    p = tmp_path / "ok.json"
    p.write_text('{"refreshed_at": "2026-05-28", "tables": {}}')
    result = _read_json_safe(p, default=None)
    assert result == {"refreshed_at": "2026-05-28", "tables": {}}


def test_read_json_safe_returns_default_on_malformed_json(tmp_path):
    """A half-written file (truncated JSON) — return the default rather
    than raising. This is the regression for 2026-05-28 D-26."""
    p = tmp_path / "broken.json"
    p.write_text('{"refreshed_at": "2026-05-28", "tables":')  # truncated
    assert _read_json_safe(p, default=None) is None
    assert _read_json_safe(p, default={}) == {}


def test_read_json_safe_returns_default_on_empty_file(tmp_path):
    """A completely empty file — return the default."""
    p = tmp_path / "empty.json"
    p.write_text("")
    assert _read_json_safe(p, default=None) is None


def test_read_json_safe_returns_default_on_partial_unicode(tmp_path):
    """Truncated mid-multibyte-char (binary corruption). Don't crash."""
    p = tmp_path / "partial_unicode.json"
    # Write half a valid 4-byte UTF-8 sequence
    p.write_bytes(b'{"label": "P\xe2\x89')  # truncated mid-codepoint
    assert _read_json_safe(p, default={}) == {}
