#!/usr/bin/env python3
"""
Pulls yesterday's wellness data from Garmin Connect and upserts into Neon DB.
Uses garth directly — no garminconnect dependency.

Auth: set GARMIN_TOKENSTORE secret (base64-encoded token dir).
  Generate it once locally with: python scripts/garmin_get_token.py
"""

import base64
import json
import os
import sys
import tempfile
from datetime import date, timedelta

try:
    import garth
except ImportError:
    print("ERROR: garth not installed.")
    sys.exit(1)

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 not installed.")
    sys.exit(1)

db_url = os.environ["DATABASE_URL"]
target = (date.today() - timedelta(days=1)).isoformat()
print(f"Syncing Garmin wellness for {target}")

# --- Restore tokens ---
tokenstore_b64 = os.environ.get("GARMIN_TOKENSTORE")
if not tokenstore_b64:
    print("ERROR: GARMIN_TOKENSTORE secret is not set.")
    sys.exit(1)

token_dir = tempfile.mkdtemp()
files = json.loads(base64.b64decode(tokenstore_b64))
for name, content in files.items():
    with open(os.path.join(token_dir, name), "w") as f:
        f.write(content)

garth.client.load(token_dir)
print("  Auth: using stored OAuth tokens")

# --- Get display name (needed for sleep endpoint) ---
display_name = ""
try:
    profile = garth.connectapi("/userprofile-service/socialProfile")
    print(f"  Profile keys: {list(profile.keys()) if profile else 'None'}")
    # displayName may be None even if the key exists — use `or`
    display_name = profile.get("displayName") or profile.get("userName") or ""
    print(f"  User: {display_name!r}")
except Exception as e:
    print(f"  Could not get display name: {e}")

sleep_hrs = None
hrv = None
resting_hr = None
readiness = None

# --- Sleep + resting HR ---
# Embed params in URL string to avoid garth kwargs issues
if display_name:
    try:
        sleep_data = garth.connectapi(
            f"/wellness-service/wellness/dailySleepData/{display_name}"
            f"?date={target}&nonSleepBufferMinutes=60"
        )
        dto = (sleep_data or {}).get("dailySleepDTO", {})
        secs = dto.get("sleepTimeSeconds")
        if secs:
            sleep_hrs = round(secs / 3600, 1)
        resting_hr = dto.get("restingHeartRate")
        print(f"  Sleep: {sleep_hrs}h, Resting HR: {resting_hr}")
    except Exception as e:
        print(f"  Sleep fetch failed: {e}")
else:
    print("  Skipping sleep — no display name")

# --- HRV ---
try:
    hrv_data = garth.connectapi(f"/hrv-service/hrv/{target}")
    summary = (hrv_data or {}).get("hrvSummary", {})
    hrv = summary.get("lastNight") or summary.get("weeklyAvg")
    print(f"  HRV: {hrv}ms")
except Exception as e:
    print(f"  HRV fetch failed: {e}")

# --- User daily summary: body battery + resting HR fallback ---
try:
    day_summary = garth.connectapi(
        f"/usersummary-service/usersummary/daily/{display_name}"
        f"?calendarDate={target}"
    )
    if day_summary:
        readiness = (
            day_summary.get("bodyBatteryChargedValue")
            or day_summary.get("maxBodyBatteryLevel")
        )
        # Use summary resting HR if sleep endpoint didn't provide it
        if resting_hr is None:
            resting_hr = day_summary.get("restingHeartRateValue")
    print(f"  Body battery: {readiness}, Resting HR: {resting_hr}")
except Exception as e:
    print(f"  User summary fetch failed: {e}")

# --- Upsert into DB ---
conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute(
    """
    INSERT INTO wellness (date, sleep_hrs, hrv, resting_hr, readiness)
    VALUES (%s, %s, %s, %s, %s)
    ON CONFLICT (date) DO UPDATE SET
        sleep_hrs  = EXCLUDED.sleep_hrs,
        hrv        = EXCLUDED.hrv,
        resting_hr = EXCLUDED.resting_hr,
        readiness  = EXCLUDED.readiness
    """,
    (target, sleep_hrs, hrv, resting_hr, readiness),
)
conn.commit()
cur.close()
conn.close()
print(f"Done — upserted wellness for {target}")
