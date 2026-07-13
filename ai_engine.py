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
    arr = _extract_array(raw)
    cards = []
    for item in arr:
        if isinstance(item, dict) and "Text" in item:
            cards.append({"Text": item["Text"], "Extra": item.get("Extra", "") or ""})
    if not cards:
        raise BadDraftOutput("no valid cards", raw=raw)
    return cards


def _extract_array(raw):
    """Shared: pull the first JSON array from Claude output, tolerant of fences/prose."""
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
    return arr


def parse_questions(raw):
    """Parse RC questions; enforce count == len(answer) per sub-question."""
    arr = _extract_array(raw)
    out = []
    for item in arr:
        if not isinstance(item, dict) or "stem" not in item:
            continue
        subs = []
        for sq in item.get("subquestions", []) or []:
            if not isinstance(sq, dict):
                continue
            ans = sq.get("answer") or []
            if not isinstance(ans, list):
                ans = [str(ans)]
            try:                              # tolerate "3", 3.0, etc.; garbage -> no trim
                count = int(sq.get("count"))
            except (TypeError, ValueError):
                count = None
            if count is not None and 0 <= count < len(ans):
                ans = ans[:count]            # trim over-long answer to stated count
            count = len(ans)                 # count always mirrors the final answer list
            try:
                marks = float(sq.get("marks", 0))
            except (TypeError, ValueError):
                marks = 0
            subs.append({"prompt": str(sq.get("prompt", "")), "count": count,
                         "marks": marks, "answer": [str(a) for a in ans]})
        out.append({"stem": str(item.get("stem", "")),
                    "archetype": str(item.get("archetype", "")), "subquestions": subs})
    if not out:
        raise BadDraftOutput("no valid questions", raw=raw)
    return out
