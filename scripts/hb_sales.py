"""Read Holland & Barrett orders from the vendor portal and write the per-day
order counts and revenue the dashboard reads from .sales-cache/hb.json.

H&B has no API, so this logs in with the browser (Playwright) and then pages
through the portal's own fulfilments endpoint. It borrows the login code from
the H&B order feeding automation (set HB_AUTOMATION_DIR if it moved).
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / ".sales-cache" / "hb.json"
STATE_PATH = REPO_ROOT / "support" / "secrets" / "hb_portal_state.json"
DEFAULT_AUTOMATION_DIR = (
    REPO_ROOT.parent / "holland-and-barrett-helm-order-feeding-automation"
)
DEFAULT_LOGIN_URL = "https://vendor.hollandandbarrett.com/auth"
LIST_PATH = "/fulfilments/v1/list"
PAGE_SIZE = 100
MAX_PAGES = 200
DEFAULT_DAYS = 95
LONDON = ZoneInfo("Europe/London")
IGNORED_STATES = {"CANCELLED", "CANCELED", "REJECTED", "EXPIRED"}
SKIPPED_HEADERS = {"content-length", "host", "cookie"}


def require_env(name):
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def london_day(timestamp):
    moment = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    return moment.astimezone(LONDON).date().isoformat()


def fetch_fulfilments(days):
    automation_dir = Path(os.getenv("HB_AUTOMATION_DIR") or DEFAULT_AUTOMATION_DIR)
    ui_dir = automation_dir / "components" / "ui_automation"
    if not ui_dir.exists():
        raise SystemExit(
            f"Could not find the H&B portal code at {ui_dir}. "
            "Set HB_AUTOMATION_DIR to the H&B order feeding automation folder."
        )
    sys.path.insert(0, str(automation_dir / "components"))
    sys.path.insert(0, str(ui_dir))

    from hb_portal import HbPortal
    from playwright.sync_api import sync_playwright

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    seen = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(
                storage_state=str(STATE_PATH) if STATE_PATH.exists() else None
            )
            page = context.new_page()

            def remember_list_request(request):
                if request.method == "POST" and request.url.endswith(LIST_PATH):
                    seen.setdefault("url", request.url)
                    seen["headers"] = {
                        k: v
                        for k, v in request.headers.items()
                        if k.lower() not in SKIPPED_HEADERS and not k.startswith(":")
                    }

            page.on("request", remember_list_request)
            portal = HbPortal(
                page,
                os.getenv("HB_PORTAL_LOGIN_URL") or DEFAULT_LOGIN_URL,
                require_env("HB_PORTAL_USERNAME"),
                require_env("HB_PORTAL_PASSWORD"),
            )
            portal.login()
            STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            context.storage_state(path=str(STATE_PATH))

            supplier = re.search(r"/supplier/\d+", page.url)
            if supplier:
                page.goto(
                    urljoin(page.url, f"{supplier.group(0)}/deliveries/fulfilments"),
                    wait_until="load",
                )
            else:
                portal.open_fulfilments()
            page.wait_for_timeout(3_000)
            if "url" not in seen:
                raise RuntimeError("The portal did not request its fulfilments list.")

            found = []
            for page_number in range(MAX_PAGES):
                response = context.request.post(
                    seen["url"],
                    headers=seen["headers"],
                    data={
                        "page": page_number,
                        "size": PAGE_SIZE,
                        "sort_direction": "DESC",
                    },
                )
                body = response.json() if response.ok else {}
                rows = (body.get("data") or {}).get("fulfilments")
                if not response.ok or not body.get("success") or rows is None:
                    raise RuntimeError(
                        f"Fulfilments page {page_number} failed "
                        f"(HTTP {response.status}): {str(body)[:300]}"
                    )
                found.extend(rows)
                oldest = min(
                    (
                        r["creation_date_time"]
                        for r in rows
                        if r.get("creation_date_time")
                    ),
                    default=None,
                )
                if len(rows) < PAGE_SIZE or (
                    oldest
                    and datetime.fromisoformat(oldest.replace("Z", "+00:00")) < cutoff
                ):
                    return found
            raise RuntimeError(f"Stopped after {MAX_PAGES} pages of fulfilments.")
        finally:
            browser.close()


def summarise(fulfilments, days):
    orders = {}
    states = defaultdict(int)
    for row in fulfilments:
        states[row.get("state")] += 1
        if row.get("state") in IGNORED_STATES or not row.get("creation_date_time"):
            continue
        total = (row.get("price_summary") or {}).get("total") or {}
        entry = orders.setdefault(
            row.get("order_id") or row["fulfilment_id"],
            {"day": london_day(row["creation_date_time"]), "revenue": 0.0},
        )
        entry["revenue"] += float(total.get("value") or 0)

    today = datetime.now(LONDON).date()
    result = {
        (today - timedelta(days=offset)).isoformat(): {
            "count": 0,
            "revenue": 0.0,
            "currency": "GBP",
        }
        for offset in range(days + 1)
    }
    for entry in orders.values():
        if entry["day"] in result:
            result[entry["day"]]["count"] += 1
            result[entry["day"]]["revenue"] += entry["revenue"]
    for day in result.values():
        day["revenue"] = round(day["revenue"], 2)
    return result, dict(states)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--dry-run", action="store_true", help="print, don't save")
    args = parser.parse_args()
    load_dotenv(REPO_ROOT / ".env")

    fulfilments = fetch_fulfilments(args.days)
    result, states = summarise(fulfilments, args.days)
    print(f"Read {len(fulfilments)} fulfilments; states: {states}")
    for day in sorted(result)[-7:]:
        print(day, result[day])
    if args.dry_run:
        return

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT_PATH.with_suffix(".tmp")
    temp.write_text(
        json.dumps(
            {
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "days": result,
            }
        ),
        encoding="utf-8",
    )
    temp.replace(OUTPUT_PATH)
    print(f"Saved {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
