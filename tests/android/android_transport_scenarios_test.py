#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import threading
import unittest
import urllib.error
from pathlib import Path

from tests.integration.mobile_host.mock_host_controller import MockHostProcess, request_json


class AndroidTransportScenariosTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[2]
        self.tmp = tempfile.TemporaryDirectory()
        self.persist_file = Path(self.tmp.name) / "mock-state.json"
        self.host = MockHostProcess(self.repo_root, persist_file=self.persist_file)
        self.host.start()

    def tearDown(self) -> None:
        self.host.stop()
        self.tmp.cleanup()

    def test_pairing_success(self) -> None:
        _, token = self.host.pair()
        self.assertEqual(token, "token-v1")

    def test_health_probe_available(self) -> None:
        status, payload = request_json("GET", f"{self.host.base_url}/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "ok")

    def test_unauthorized_rejected(self) -> None:
        status, payload = request_json(
            "GET",
            f"{self.host.base_url}/v1/instances",
        )
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "unauthorized")

    def test_lan_disconnect_reconnect(self) -> None:
        _, token = self.host.pair()
        auth = {"Authorization": f"Bearer {token}"}

        self.host.stop()
        with self.assertRaises(urllib.error.URLError):
            request_json("GET", f"{self.host.base_url}/v1/instances", headers=auth)

        self.host.start()
        status, payload = request_json(
            "GET",
            f"{self.host.base_url}/v1/instances",
            headers=auth,
        )
        self.assertEqual(status, 200)
        self.assertIn("instances", payload)

    def test_instance_launch_close_race(self) -> None:
        _, token = self.host.pair()
        auth = {"Authorization": f"Bearer {token}"}
        launch_statuses: list[int] = []
        close_statuses: list[int] = []
        thread_errors: list[str] = []

        def launch_then_close() -> None:
            try:
                s1, body = request_json(
                    "POST",
                    f"{self.host.base_url}/v1/instances",
                    body={"title": "race"},
                    headers=auth,
                )
                launch_statuses.append(s1)
                if s1 != 201:
                    return
                instance_id = body["instance_id"]
                s2, _ = request_json(
                    "DELETE",
                    f"{self.host.base_url}/v1/instances/{instance_id}",
                    headers=auth,
                )
                close_statuses.append(s2)
            except Exception as exc:  # pragma: no cover - exercised only on transport failure
                thread_errors.append(repr(exc))

        threads = [threading.Thread(target=launch_then_close) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(thread_errors, [])
        self.assertTrue(all(status == 201 for status in launch_statuses))
        self.assertTrue(all(status in {202, 404} for status in close_statuses))

        status, payload = request_json(
            "GET",
            f"{self.host.base_url}/v1/instances",
            headers=auth,
        )
        self.assertEqual(status, 200)
        self.assertIn("instances", payload)

    def test_restore_after_host_restart(self) -> None:
        _, token = self.host.pair()
        auth = {"Authorization": f"Bearer {token}"}
        restore_state_path = "C:/wizard_team_app/runs/session-after-restart/session_restore.json"

        status, payload = request_json(
            "POST",
            f"{self.host.base_url}/v1/instances",
            body={"restore_state_path": restore_state_path},
            headers=auth,
        )
        self.assertEqual(status, 201)
        restored_instance_id = payload["instance_id"]

        self.host.stop()
        self.host.start()

        status, payload = request_json(
            "GET",
            f"{self.host.base_url}/v1/instances",
            headers=auth,
        )
        self.assertEqual(status, 200)
        ids = [item["instance_id"] for item in payload["instances"]]
        self.assertIn(restored_instance_id, ids)

    def test_restore_by_opaque_restore_ref(self) -> None:
        _, token = self.host.pair()
        auth = {"Authorization": f"Bearer {token}"}

        status, instances = request_json(
            "GET",
            f"{self.host.base_url}/v1/instances",
            headers=auth,
        )
        self.assertEqual(status, 200)
        self.assertTrue(instances["instances"][0]["restore_ref"])

        status, payload = request_json(
            "GET",
            f"{self.host.base_url}/v1/restore-refs",
            headers=auth,
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["restore_refs"])
        restore_ref = payload["restore_refs"][0]["restore_ref"]

        status, restored = request_json(
            "POST",
            f"{self.host.base_url}/v1/instances",
            body={"restore_ref": restore_ref},
            headers=auth,
        )
        self.assertEqual(status, 201)
        self.assertEqual(restored["result_summary"]["short_text"], "Session restore queued")
        self.assertTrue(str(restored["session_id"]).startswith("restored-"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
