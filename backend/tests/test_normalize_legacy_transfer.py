"""Pure synthetic snapshot tests. No database, network or private files are read."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "normalize-legacy-transfer.py"
SPEC = importlib.util.spec_from_file_location("normalize_legacy_transfer", SCRIPT)
NORMALIZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NORMALIZER)
TIMESTAMP = "2026-10-01T20:13:14.567891+08:00"


def snapshot_tables():
    tables = {name: [] for name in "users point_records billing_products billing_orders payment_transactions canvas_projects drama_projects generation_logs referral_codes app_settings referral_programs entitlement_plans audit_logs creative_conversations object_storage_settings user_plan_assignments announcements daily_plan_point_wallets point_grants generation_tasks system_model_channels".split()}
    settings = {name: {} for name in "site mail model_point_costs generation_point_multipliers generation_cost_control data_lifecycle generation_concurrency generation_defaults default_models registration_policy check_in_policy model_pricing media_policy".split()}
    settings.update(id="global", operation_mode="commercial", registration_enabled=False,
                    email_registration_enabled=False, free_daily_points_enabled=False,
                    free_daily_points="0.0000", allow_user_api_config=False,
                    logical_models=[], agent_skills=[], payment_config={},
                    entitlements_enabled=False, default_plan_id="", updated_at=TIMESTAMP)
    tables["app_settings"] = [settings]
    tables["users"] = [{"id": "synthetic-user", "username": "synthetic-user", "email": None,
                        "display_name": "Synthetic", "bio": "", "avatar_storage_key": None,
                        "role": "user", "admin_permissions": [], "status": "active",
                        "password_hash": "synthetic-unusable-hash", "plan_id": None,
                        "points_balance": "12.3456", "mfa_enabled_at": None,
                        "created_at": TIMESTAMP, "updated_at": TIMESTAMP,
                        "last_login_at": None, "policy_accepted_at": None}]
    return tables


def project(kind="drama", status="active"):
    identifier = "synthetic-" + kind
    document = {"id": identifier, "title": "合成分镜项目", "status": status,
                "sourceHandoffId": "synthetic-shared-handoff", "createdAt": TIMESTAMP,
                "updatedAt": TIMESTAMP, "clues": [{"id": "clue", "text": "线索\n完整保留"}],
                "props": [{"id": "prop", "references": ["https://assets.example.invalid/prop.png"]}],
                "ratio": "16:9", "style": "合成风格", "summary": "剧情摘要",
                "scenes": [{"id": "scene", "location": {"name": "合成地点", "weather": "rain"}}],
                "characters": [{"id": "character", "name": "合成人物", "appearance": {"colors": ["蓝", "白"]}}],
                "episodes": [{"id": "episode", "title": "第一集", "shots": [
                    {"id": "shot", "dialogue": [{"speaker": "character", "text": "保留引号 \"台词\""}],
                     "camera": {"movement": "pan", "duration": 4.5},
                     "generatedAssets": [{"url": "https://assets.example.invalid/shot.mp4", "metadata": {"frames": [1, 2], "accepted": False}}],
                     "futureExtension": {"nullValue": None, "empty": [], "nested": {"enabled": True}}}]}],
                "activeEpisodeId": "episode", "sourceAssets": [{"id": "source", "type": "image"}],
                "defaultVideoMode": "image-to-video", "creativeConversationId": "synthetic-conversation"}
    if kind == "canvas":
        document["nodes"] = [{"id": "node", "data": {"prompt": "合成画布", "attachments": []}}]
        document["connections"] = []
    return {"id": identifier, "user_id": "synthetic-user", "title": document["title"],
            "status": status, "project_json": document, "created_at": TIMESTAMP,
            "updated_at": "2026-10-02T04:05:06.987654Z"}


def normalize(tables):
    source = [{"format": "oaooao-database-transfer-v1", "capturedAt": TIMESTAMP}]
    source.extend({"table": "vozeb_pro_" + name, "rows": values} for name, values in tables.items())
    snapshot = "\n".join(json.dumps(row, ensure_ascii=False) for row in source).encode("utf-8")
    with tempfile.TemporaryDirectory(prefix="oaooao-normalize-synthetic-") as directory:
        input_path, output_path = pathlib.Path(directory) / "snapshot.jsonl", pathlib.Path(directory) / "bundle.json"
        input_path.write_bytes(snapshot)
        console = io.StringIO()
        with patch.object(sys, "argv", [str(SCRIPT), str(input_path), str(output_path)]), contextlib.redirect_stdout(console):
            NORMALIZER.main()
        return json.loads(output_path.read_text(encoding="utf-8")), json.loads(console.getvalue()), snapshot


class NormalizeProjectTests(unittest.TestCase):
    def test_mixed_canvas_and_drama_preserve_all_nested_content_and_archive(self):
        tables = snapshot_tables()
        canvas, drama = project("canvas"), project("drama")
        tables["canvas_projects"], tables["drama_projects"] = [canvas], [drama]
        original = copy.deepcopy(tables)
        bundle, summary, source = normalize(tables)
        self.assertEqual(tables, original)
        self.assertEqual(summary["counts"]["projects"], 2)
        self.assertEqual(bundle["sourceDigest"], hashlib.sha256(source).hexdigest())
        records = bundle["records"]["projects"]
        self.assertEqual([row["kind"] for row in records], ["canvas", "drama"])
        for actual, expected in zip(records, (canvas, drama)):
            self.assertEqual(actual["id"], expected["id"])
            self.assertEqual(actual["user_id"], expected["user_id"])
            self.assertEqual(actual["title"], expected["title"])
            self.assertEqual(actual["source_handoff_id"], expected["project_json"]["sourceHandoffId"])
            self.assertEqual(actual["document"], expected["project_json"])
            self.assertEqual(actual["created_at"], "2026-10-01T12:13:14.567Z")
            self.assertEqual(actual["updated_at"], "2026-10-02T04:05:06.987Z")
            archive = next(row for row in bundle["archive"] if row["entityId"] == expected["id"])
            self.assertEqual(archive["entityType"], actual["kind"] + "_projects")
            self.assertEqual(archive["document"], expected)

    def test_drama_row_status_is_authoritative_without_mutating_archive(self):
        for original_status in (None, "draft", "active"):
            with self.subTest(document_status=original_status):
                tables = snapshot_tables()
                drama = project(status="active")
                if original_status is None:
                    del drama["project_json"]["status"]
                else:
                    drama["project_json"]["status"] = original_status
                tables["drama_projects"] = [drama]
                bundle, _, _ = normalize(tables)
                actual = bundle["records"]["projects"][0]
                self.assertEqual(actual["document"], {**drama["project_json"], "status": "active"})
                archive = next(row for row in bundle["archive"] if row["entityType"] == "drama_projects")
                self.assertEqual(archive["document"], drama)

    def test_missing_optional_drama_table_keeps_canvas_compatibility(self):
        tables = snapshot_tables()
        del tables["drama_projects"]
        canvas = project("canvas")
        tables["canvas_projects"] = [canvas]
        bundle, summary, _ = normalize(tables)
        self.assertEqual(summary["counts"]["projects"], 1)
        self.assertEqual(bundle["records"]["projects"][0]["document"], canvas["project_json"])

    def test_archived_drama_remains_archived(self):
        tables = snapshot_tables()
        tables["drama_projects"] = [project(status="archived")]
        bundle, _, _ = normalize(tables)
        self.assertEqual(bundle["records"]["projects"][0]["document"]["status"], "archived")

    def test_unknown_nonempty_entity_still_blocks_the_entire_snapshot(self):
        tables = snapshot_tables()
        tables["drama_projects"] = [project()]
        tables["unmapped_synthetic_entity"] = [{"id": "new-data", "value": "must not disappear"}]
        with self.assertRaisesRegex(ValueError, "Nonempty entities need an explicit mapping.*unmapped_synthetic_entity"):
            normalize(tables)
        tables["unmapped_synthetic_entity"] = []
        bundle, _, _ = normalize(tables)
        self.assertEqual(len(bundle["records"]["projects"]), 1)

    def test_invalid_drama_document_or_status_fails_closed(self):
        for field, invalid in (("project_json", []), ("project_json", None), ("status", None), ("status", ""), ("status", False), ("status", "unknown")):
            with self.subTest(field=field, invalid=invalid):
                tables = snapshot_tables()
                drama = project()
                drama[field] = invalid
                tables["drama_projects"] = [drama]
                with self.assertRaisesRegex(ValueError, "Project document|Drama project status"):
                    normalize(tables)


if __name__ == "__main__":
    unittest.main()
