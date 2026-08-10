"""Lee el mismo fixture que packages/plugin-contract/src/sidecarProtocol.test.ts
(TS) — si alguien cambia un campo de un lado sin el otro, uno de los dos
tests rompe. Ver comentario en sidecarProtocol.ts sobre esta decisión.
"""

import json
from pathlib import Path

from kan_plugin_sdk_py import protocol

FIXTURES_PATH = (
    Path(__file__).resolve().parents[2] / "plugin-contract" / "src" / "sidecarProtocolFixtures.json"
)


def _load_fixtures() -> dict:
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def test_fixture_file_existe():
    assert FIXTURES_PATH.is_file(), f"No se encontró el fixture compartido en {FIXTURES_PATH}"


def test_protocol_version_coincide_con_el_fixture():
    fixtures = _load_fixtures()
    assert fixtures["sidecar_hello"]["protocolVersion"] == protocol.SIDECAR_PROTOCOL_VERSION


def test_sidecar_hello_mismas_claves_que_el_fixture():
    fixtures = _load_fixtures()
    built = protocol.sidecar_hello(plugin_id="kan-plugin-vision-py", plugin_version="0.1.0", token="tok")
    assert set(built.keys()) == set(fixtures["sidecar_hello"].keys())


def test_discover_result_mismas_claves_que_el_fixture():
    fixtures = _load_fixtures()
    built = protocol.discover_result(request_id="r1", devices=[])
    assert set(built.keys()) == set(fixtures["discover.result"].keys())


def test_connect_result_mismas_claves_que_el_fixture_con_capabilities():
    fixtures = _load_fixtures()
    built = protocol.connect_result(request_id="r1", ok=True, capabilities=[])
    assert set(built.keys()) == set(fixtures["connect.result"].keys())


def test_disconnect_result_mismas_claves_que_el_fixture():
    fixtures = _load_fixtures()
    built = protocol.disconnect_result(request_id="r1", ok=True)
    assert set(built.keys()) == set(fixtures["disconnect.result"].keys())


def test_invoke_result_mismas_claves_que_el_fixture():
    fixtures = _load_fixtures()
    built = protocol.invoke_result(request_id="r1", result={"success": True})
    assert set(built.keys()) == set(fixtures["invoke.result"].keys())


def test_list_targets_result_mismas_claves_que_el_fixture():
    fixtures = _load_fixtures()
    built = protocol.list_targets_result(request_id="r1", targets=[])
    assert set(built.keys()) == set(fixtures["list_targets.result"].keys())


def test_heartbeat_mismas_claves_que_el_fixture():
    fixtures = _load_fixtures()
    built = protocol.heartbeat(at="2026-08-09T12:00:00.000Z")
    assert set(built.keys()) == set(fixtures["heartbeat"].keys())


def test_edge_to_sidecar_y_sidecar_to_edge_no_se_superponen():
    overlap = protocol.EDGE_TO_SIDECAR_TYPES & protocol.SIDECAR_TO_EDGE_TYPES
    assert overlap == frozenset()
