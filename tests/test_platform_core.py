import json
from pathlib import Path

PLATFORM_DIR = Path(__file__).resolve().parent.parent


def test_prompts_json_has_both_templates():
    data = json.loads((PLATFORM_DIR / "prompts.json").read_text())
    assert "cards" in data and "questions" in data
    assert "{NN}" in data["cards"] and "{title}" in data["cards"]
    assert "{NN}" in data["questions"] and "{title}" in data["questions"]
