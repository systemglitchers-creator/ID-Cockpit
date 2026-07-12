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
    pass


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
    except FileNotFoundError as e:
        raise EngineNotConfigured(str(e))
    if result.returncode != 0:
        raise EngineFailed((result.stderr or "claude failed").strip())
    return result.stdout


def parse_cards(raw):
    """Pull a JSON array of {Text, Extra} from Claude's output, tolerantly."""
    if raw is None:
        raise BadDraftOutput("empty output")
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise BadDraftOutput("no JSON array found")
    try:
        arr = json.loads(text[start:end + 1])
    except ValueError as e:
        raise BadDraftOutput(str(e))
    if not isinstance(arr, list):
        raise BadDraftOutput("not a list")
    cards = []
    for item in arr:
        if isinstance(item, dict) and "Text" in item:
            cards.append({"Text": item["Text"], "Extra": item.get("Extra", "") or ""})
    if not cards:
        raise BadDraftOutput("no valid cards")
    return cards
