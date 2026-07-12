import json
from pathlib import Path

import cards_core as cc


def test_ensure_queue_creates_dirs(tmp_path):
    cc.ensure_queue(tmp_path)
    for sub in ("incoming", "pending", "drafts", "done"):
        assert (tmp_path / "queue" / sub).is_dir()


def test_load_config_missing_is_unconfigured(tmp_path):
    cfg = cc.load_config(tmp_path)
    assert cfg["claudePath"] is None
    assert cc.is_configured(tmp_path) is False


def test_load_config_reads_file(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps(
        {"claudePath": "/usr/local/bin/claude", "model": None, "timeoutSec": 120}))
    cfg = cc.load_config(tmp_path)
    assert cfg["claudePath"] == "/usr/local/bin/claude"
    assert cfg["timeoutSec"] == 120
    assert cc.is_configured(tmp_path) is True
