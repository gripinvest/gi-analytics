from services.integrations.fra_youtube import build_layer1
from tests.fra_fixture import CHANNEL, VIDEOS


def test_build_layer1_shapes_rows():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")

    chan = layer1["channel_snapshots"]
    assert len(chan) == 1
    assert chan[0]["snapshot_date"] == "2026-05-18"
    assert chan[0]["channel_handle"] == "@fixedreturnsacademy"
    assert chan[0]["subscribers"] == 1300

    vids = layer1["video_snapshots"]
    assert len(vids) == 5
    a = next(v for v in vids if v["video_id"] == "a")
    assert a["snapshot_date"] == "2026-05-18"
    assert a["channel_handle"] == "@fixedreturnsacademy"
    assert a["views"] == 8000
    assert a["category"] == "Taxation"
    assert a["is_question_title"] is True
    assert a["tags"] == "taxation"          # list joined for CSV storage
