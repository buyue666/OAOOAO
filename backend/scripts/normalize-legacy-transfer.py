"""Data-only adapter from a read-only PostgreSQL snapshot to the new transfer format.

No legacy application module is imported. Changes in database shape fail closed.
"""
import datetime
import decimal
import hashlib
import json
import pathlib
import re
import argparse



def date(value):
    if value is None:
        return None
    parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def points(value):
    result = decimal.Decimal(str(value or "0"))
    if result != result.quantize(decimal.Decimal("0.0001")):
        raise ValueError("Source credits exceed target precision")
    return format(result, ".4f")


def camel(value):
    return re.sub(r"_([a-z])", lambda m: m[1].upper(), value)


def archive_value(value):
    if isinstance(value, list):
        return [archive_value(v) for v in value]
    if isinstance(value, dict):
        return {k: archive_value(v) for k, v in value.items() if not re.search(r"password|ciphertext|secret|api.?key|access.?token|refresh.?token", k, re.I)}
    return value


def project_record(project, kind):
    document = project["project_json"]
    if not isinstance(document, dict):
        raise ValueError("Project document must be an object")
    if kind == "drama":
        # The database status is authoritative; retain every other document field,
        # including unknown nested storyboard data. The archive retains the input.
        if project["status"] not in ("active", "archived"):
            raise ValueError("Drama project status requires an explicit supported mapping")
        document = {**document, "status": project["status"]}
    return {"id": project["id"], "user_id": project["user_id"], "kind": kind,
            "title": project["title"], "source_handoff_id": document.get("sourceHandoffId"),
            "document": document, "created_at": date(project["created_at"]),
            "updated_at": date(project["updated_at"])}


def main():
    parser = argparse.ArgumentParser(description="Normalize the reviewed legacy snapshot; writes confidential account records")
    parser.add_argument("snapshot", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    data = args.snapshot.read_bytes()
    source_digest = hashlib.sha256(data).hexdigest()
    rows = [json.loads(line) for line in data.decode("utf-8").splitlines()]
    source = {r["table"].removeprefix("vozeb_pro_"): r["rows"] for r in rows[1:]}
    if rows[0].get("format") != "oaooao-database-transfer-v1":
        raise ValueError("Unexpected source format")
    supported = set("users point_records billing_products billing_orders payment_transactions canvas_projects drama_projects generation_logs referral_codes app_settings referral_programs entitlement_plans audit_logs creative_conversations object_storage_settings user_plan_assignments announcements".split())
    unexpected = [name for name, values in source.items() if values and name not in supported]
    if unexpected:
        raise ValueError("Nonempty entities need an explicit mapping before migration: " + ", ".join(unexpected))
    if any(u["avatar_storage_key"] for u in source["users"]):
        raise ValueError("Avatar files require a verified media transfer")
    if any(row["enabled"] or row["access_key_id_ciphertext"] or row["secret_access_key_ciphertext"] for row in source["object_storage_settings"]):
        raise ValueError("Object storage requires explicit secret and media transfer")
    if any(row["status"] == "active" and (not row["ends_at"] or date(row["ends_at"]) > date(rows[0]["capturedAt"])) for row in source["user_plan_assignments"]):
        raise ValueError("Active future plan entitlements require an explicit decision and mapping")
    if source["daily_plan_point_wallets"] or source["point_grants"] or source["generation_tasks"] or source["system_model_channels"]:
        raise ValueError("New live wallets, tasks, grants or channels require an explicit transfer mapping")
    if any(u["mfa_enabled_at"] for u in source["users"]):
        raise ValueError("MFA migration is required before transfer")
    output = {"format": "oaooao-normalized-transfer-v1", "id": "oaooao-replacement-" + source_digest[:16], "sourceDigest": source_digest, "capturedAt": date(rows[0]["capturedAt"]), "records": {}, "archive": []}
    records = output["records"]
    announcement_columns = "id title content enabled popup_home popup_after_login starts_at ends_at created_at updated_at".split()
    records["announcements"] = [{key: date(item[key]) if key.endswith("_at") else item[key] for key in announcement_columns} for item in source.get("announcements", [])]
    records["users"] = [{
        "id": u["id"], "username": u["username"], "email": u["email"] or None,
        "display_name": u["display_name"] or "", "bio": u["bio"] or "",
        "avatar_url": "/api/reference-assets/" + u["avatar_storage_key"] if u["avatar_storage_key"] else "",
        "role": u["role"], "admin_permissions": u["admin_permissions"] or [], "enabled": u["status"] == "active",
        "password_hash": u["password_hash"], "email_verified": False, "plan_id": u["plan_id"],
        "created_at": date(u["created_at"]), "updated_at": date(u["updated_at"]), "last_login_at": date(u["last_login_at"]), "policy_accepted_at": date(u["policy_accepted_at"])
    } for u in source["users"]]
    records["wallets"] = [{"user_id": u["id"], "permanent_balance": points(u["points_balance"]), "daily_balance": "0.0000", "daily_allowance": "0.0000", "daily_expires_at": None, "daily_refresh_date": None, "updated_at": date(u["updated_at"])} for u in source["users"]]
    records["ledger"] = [{
        "operation_id": "history:" + r["id"], "user_id": r["user_id"], "requested_delta": points(r["amount"]),
        "permanent_delta": points(r["permanent_amount"]), "daily_delta": points(r["daily_amount"]),
        "permanent_after": points(r["permanent_balance_after"]), "daily_after": points(r["daily_balance_after"]),
        "daily_expires_at": None, "refund_of": None,
        "metadata": {"kind": "imported_history", "type": r["type"], "description": r["description"], "model": r["model"], "idempotencyKey": r["idempotency_key"], "sourceRecordId": r["source_record_id"], "sourceDate": r["source_date"], "originalId": r["id"], "legacyData": r["metadata"]},
        "created_at": date(r["created_at"])
    } for r in source["point_records"]]
    product_columns = "id product_kind plan_id name description amount_cents currency points_amount daily_points period_days enabled sort_order metadata created_at updated_at".split()
    records["products"] = [{k: date(p[k]) if k.endswith("_at") else points(p[k]) if k in {"points_amount", "daily_points"} else p[k] for k in product_columns} for p in source["billing_products"]]
    product_ids = {p["id"] for p in records["products"]}
    for order in source["billing_orders"]:
        product_id = order["product_id"] or "archive-product:unavailable"
        if product_id not in product_ids:
            records["products"].append({"id": product_id, "product_kind": order["product_kind"], "plan_id": order["plan_id"], "name": "历史商品（已归档）", "description": "保留历史订单引用，不对外销售", "amount_cents": "0", "currency": order["currency"], "points_amount": "0.0000", "daily_points": "0.0000", "period_days": 0, "enabled": False, "sort_order": 999999, "metadata": {"archivedForHistoricalOrders": True}, "created_at": date(order["created_at"]), "updated_at": date(order["updated_at"])})
            product_ids.add(product_id)
    order_columns = "id order_no user_id product_id product_kind plan_id subject status quantity list_amount_cents promotion_discount_cents coupon_discount_cents amount_cents currency points_amount daily_points period_days provider provider_order_id expires_at closed_at paid_at pricing_snapshot metadata created_at updated_at".split()
    records["orders"] = [{k: date(o[k]) if k.endswith("_at") else points(o[k]) if k in {"points_amount", "daily_points"} else o[k] for k in order_columns} for o in source["billing_orders"]]
    for order in records["orders"]:
        if order["product_id"] is None:
            order["product_id"] = "archive-product:unavailable"
            order["metadata"] = {**(order["metadata"] or {}), "originalProductId": None, "productReferenceUnavailableAtImport": True}
    records["payments"] = [{"id": p["id"], "order_id": p["order_id"], "provider": p["provider"], "provider_payment_id": p["provider_payment_id"] or p["provider_trade_id"] or "historical:" + p["id"], "amount_cents": p["amount_cents"], "currency": p["currency"], "status": p["status"], "confirmation": {"kind": "imported_historical_payment", "originalProviderPaymentId": p["provider_payment_id"], "originalProviderTradeId": p["provider_trade_id"], "paidAt": date(p["paid_at"])}, "created_at": date(p["created_at"]), "refunded_at": date(p["refunded_at"])} for p in source["payment_transactions"]]
    records["projects"] = [project_record(project, kind)
                           for name, kind in (("canvas_projects", "canvas"), ("drama_projects", "drama"))
                           for project in source.get(name, [])]
    records["history"] = []
    for h in source["generation_logs"]:
        document = {camel(k): h[k] for k in "id kind source status title prompt model summary duration_ms count success_count fail_count error".split()}
        document.update({"createdAt": date(h["created_at"]), "assets": [], "importedHistory": True})
        records["history"].append({"id": h["id"], "user_id": h["user_id"], "document": document, "created_at": date(h["created_at"])})
    records["referralCodes"] = [{"user_id": r["user_id"], "code": r["code"], "clicks": r["click_count"]} for r in source["referral_codes"] if r["enabled"]]
    settings = source["app_settings"][0]
    allowed_settings = "site operation_mode registration_enabled email_registration_enabled free_daily_points_enabled free_daily_points allow_user_api_config mail model_point_costs generation_point_multipliers generation_cost_control data_lifecycle generation_concurrency generation_defaults logical_models default_models agent_skills registration_policy check_in_policy model_pricing media_policy".split()
    value = {camel(k): float(settings[k]) if k == "free_daily_points" else settings[k] for k in allowed_settings}
    if settings["mail"] or settings["payment_config"]:
        raise ValueError("New integration credentials require explicit re-encryption mapping")
    value["systemChannels"] = []
    value["entitlements"] = {"enabled": settings["entitlements_enabled"], "defaultPlanId": settings["default_plan_id"], "plans": [{camel(k): float(p[k]) if k == "daily_points" else p[k] for k in "id name enabled daily_points limits features sort_order".split()} for p in source["entitlement_plans"]]}
    records["settings"] = [{"id": "global", "value": value, "updated_at": date(settings["updated_at"])}]
    for program in source["referral_programs"]:
        fields = "id enabled inviter_points invitee_reward_type invitee_points minimum_paid_cents cooling_off_days inviter_monthly_limit campaign_total_limit auto_freeze_risk".split()
        val = {camel(k): float(program[k]) if k in {"inviter_points", "invitee_points"} else int(program[k]) if k == "minimum_paid_cents" else program[k] for k in fields}
        records["settings"].append({"id": "referrals", "value": val, "updated_at": date(program["updated_at"])})
    records["audit"] = []
    for name, table_rows in source.items():
        for row in table_rows:
            identity = str(row.get("id") or row.get("storage_key") or row.get("user_id") or hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest())
            output["archive"].append({"entityType": name, "entityId": identity, "document": archive_value(row)})
    result = json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    args.output.write_text(result, encoding="utf-8")
    print(json.dumps({"saved": str(args.output), "sourceDigest": source_digest, "counts": {key: len(value) for key, value in records.items()}, "permanentPoints": str(sum(decimal.Decimal(w["permanent_balance"]) for w in records["wallets"])), "archivedRows": len(output["archive"])}))


if __name__ == "__main__":
    main()
