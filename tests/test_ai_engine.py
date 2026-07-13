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


def test_bad_draft_output_carries_raw():
    try:
        ae.parse_cards("totally not json")
    except ae.BadDraftOutput as e:
        assert e.raw == "totally not json"
    else:
        assert False, "should have raised"


def test_parse_questions_basic():
    raw = ('[{"stem":"A patient...","archetype":"clinical","subquestions":'
           '[{"prompt":"Name 2 causes","count":2,"marks":1,"answer":["a","b"]}]}]')
    qs = ae.parse_questions(raw)
    assert len(qs) == 1
    assert qs[0]["stem"].startswith("A patient")
    assert qs[0]["subquestions"][0]["count"] == 2
    assert qs[0]["subquestions"][0]["answer"] == ["a", "b"]


def test_parse_questions_trims_answer_to_count():
    raw = ('[{"stem":"s","archetype":"micro","subquestions":'
           '[{"prompt":"Name 2","count":2,"marks":1,"answer":["a","b","c"]}]}]')
    qs = ae.parse_questions(raw)
    assert qs[0]["subquestions"][0]["answer"] == ["a", "b"]  # trimmed to count


def test_parse_questions_fixes_count_when_fewer_answers():
    raw = ('[{"stem":"s","archetype":"micro","subquestions":'
           '[{"prompt":"Name 3","count":3,"marks":1.5,"answer":["a","b"]}]}]')
    qs = ae.parse_questions(raw)
    sq = qs[0]["subquestions"][0]
    assert sq["count"] == 2 and sq["answer"] == ["a", "b"]  # count follows actual answers


def test_parse_questions_code_fence_and_prose():
    raw = 'Sure:\n```json\n[{"stem":"s","subquestions":[]}]\n```\n'
    assert ae.parse_questions(raw)[0]["stem"] == "s"


def test_parse_questions_bad_raises_with_raw():
    try:
        ae.parse_questions("nope")
    except ae.BadDraftOutput as e:
        assert e.raw == "nope"
    else:
        assert False


def test_parse_questions_float_count_trims():
    raw = '[{"stem":"s","subquestions":[{"prompt":"Name 2","count":2.0,"marks":1,"answer":["a","b","c"]}]}]'
    assert ae.parse_questions(raw)[0]["subquestions"][0]["answer"] == ["a", "b"]


def test_parse_questions_string_count_trims():
    raw = '[{"stem":"s","subquestions":[{"prompt":"Name 2","count":"2","marks":1,"answer":["a","b","c"]}]}]'
    assert ae.parse_questions(raw)[0]["subquestions"][0]["answer"] == ["a", "b"]


def test_parse_questions_negative_count_does_not_corrupt():
    raw = '[{"stem":"s","subquestions":[{"prompt":"x","count":-1,"marks":1,"answer":["a","b","c"]}]}]'
    sq = ae.parse_questions(raw)[0]["subquestions"][0]
    assert sq["answer"] == ["a", "b", "c"] and sq["count"] == 3


def test_parse_questions_marks_coerced_to_number():
    raw = '[{"stem":"s","subquestions":[{"prompt":"x","count":1,"marks":"1.5","answer":["a"]}]}]'
    assert ae.parse_questions(raw)[0]["subquestions"][0]["marks"] == 1.5
