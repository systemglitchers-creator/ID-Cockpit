import subprocess
import pytest

import ai_engine as ae


def fake_runner(result):
    def run(cmd, **kw):
        return result
    return run


def test_draft_returns_stdout_and_passes_prompt():
    seen = {}
    def run(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="[]", stderr="")
    out = ae.draft("PROMPT", claude_path="/bin/claude", runner=run)
    assert out == "[]"
    assert "/bin/claude" in seen["cmd"] and "-p" in seen["cmd"] and "PROMPT" in seen["cmd"]


def test_draft_adds_model_only_when_set():
    seen = {}
    def run(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="[]", stderr="")
    ae.draft("P", claude_path="/bin/claude", model="claude-x", runner=run)
    assert "--model" in seen["cmd"] and "claude-x" in seen["cmd"]


def test_draft_missing_binary_raises_not_configured():
    with pytest.raises(ae.EngineNotConfigured):
        ae.draft("P", claude_path=None, runner=fake_runner(None))


def test_draft_nonzero_exit_raises_failed():
    r = subprocess.CompletedProcess(["c"], 1, stdout="", stderr="boom")
    with pytest.raises(ae.EngineFailed):
        ae.draft("P", claude_path="/bin/claude", runner=fake_runner(r))


def test_draft_timeout_raises_engine_timeout():
    def run(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 1)
    with pytest.raises(ae.EngineTimeout):
        ae.draft("P", claude_path="/bin/claude", runner=run)


def test_parse_cards_plain_array():
    raw = '[{"Text":"a","Extra":""},{"Text":"b","Extra":"x"}]'
    assert ae.parse_cards(raw) == [{"Text": "a", "Extra": ""}, {"Text": "b", "Extra": "x"}]


def test_parse_cards_strips_code_fence_and_prose():
    raw = 'Here you go:\n```json\n[{"Text":"a","Extra":""}]\n```\nDone.'
    assert ae.parse_cards(raw) == [{"Text": "a", "Extra": ""}]


def test_parse_cards_bad_output_raises():
    with pytest.raises(ae.BadDraftOutput):
        ae.parse_cards("no json here")


def test_parse_cards_coerces_missing_extra():
    assert ae.parse_cards('[{"Text":"a"}]') == [{"Text": "a", "Extra": ""}]
