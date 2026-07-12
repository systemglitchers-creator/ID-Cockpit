"""Headless-Claude drafting service. Shared by cards and (later) questions."""
from __future__ import annotations

import json
import re
import subprocess


class EngineNotConfigured(Exception):
    pass


class EngineTimeout(Exception):
    pass


class EngineFailed(Exception):
    pass


class BadDraftOutput(Exception):
    def __init__(self, message, raw=None):
        super().__init__(message)
        self.raw = raw


def draft(prompt, *, claude_path, model=None, timeout=240, runner=subprocess.run):
    """Run `claude -p <prompt>` and return stdout. No tools granted (text-only)."""
    if not claude_path:
        raise EngineNotConfigured("claude CLI path not configured")
    cmd = [claude_path, "-p", prompt]
    if model:
        cmd += ["--model", model]
    try:
        result = runner(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise EngineTimeout(str(e))
    except OSError as e:
        raise EngineNotConfigured(str(e))
    if result.returncode != 0:
        raise EngineFailed((result.stderr or "claude failed").strip())
    return result.stdout


def parse_cards(raw):
    """Pull a JSON array of {Text, Extra} from Claude's output, tolerantly."""
    if raw is None:
        raise BadDraftOutput("empty output", raw=raw)
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = text.find("[")
    if start == -1:
        raise BadDraftOutput("no JSON array found", raw=raw)
    try:
        arr, _ = json.JSONDecoder().raw_decode(text[start:])
    except ValueError as e:
        raise BadDraftOutput(str(e), raw=raw)
    if not isinstance(arr, list):
        raise BadDraftOutput("not a list", raw=raw)
    cards = []
    for item in arr:
        if isinstance(item, dict) and "Text" in item:
            cards.append({"Text": item["Text"], "Extra": item.get("Extra", "") or ""})
    if not cards:
        raise BadDraftOutput("no valid cards", raw=raw)
    return cards
