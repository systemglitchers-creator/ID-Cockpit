"""Pure logic for the ID Study Platform cockpit. No HTTP here."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

_CHAPTER_RE = re.compile(r"(?:Chapter\s+)?(\d+)")


def parse_chapter_num(title):
    """Return the chapter number as a string, or None if the title has none.

    Matches 'Chapter 20 — ...' and '20 - ...'. Returns the first integer that
    appears at, or right after an optional 'Chapter ' prefix at, the start.
    """
    m = _CHAPTER_RE.match(title.strip())
    return m.group(1) if m else None
