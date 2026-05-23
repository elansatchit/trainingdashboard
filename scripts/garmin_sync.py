#!/usr/bin/env python3
"""
Pulls today's wellness data from Garmin Connect and upserts into Neon DB.
Uses garth directly — no garminconnect dependency.

Auth: set GARMIN_TOKENSTORE secret (base64-encoded token dir).
  Generate it once locally with: python scripts/garmin_get_token.py
"""

import base64
import json
import os
import sys
import tempfile
from datetime import date

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
target = date.today().isoformat()
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

# --- Get display name (needed for several endpoints) ---
display_name = ""
try:
    profile = garth.connectapi("/userprofile-service/socialProfile")
    display_name = profile.get("displayName") or profile.get("userName") or ""
    print(f"  User: {display_name!r}")
except Exception as e:
    print(f"  Could not get display name: {e}")

# Collected metrics
sleep_hrs      = None
deep_sleep_min = None
light_sleep_min= None
rem_sleep_min  = None
awake_min      = None
spo2           = None
respiration    = None
sleep_stress   = None
hrv            = None
resting_hr     = None
readiness      = None

# --- Sleep (all stages) ---
if display_name:
    try:
        sleep_data = garth.connectapi(
            f"/wellness-service/wellness/dailySleepData/{display_name}"
            f"?date={target}&nonSleepBufferMinutes=60"
        )
        dto = (sleep_data or {}).get("dailySleepDTO", {})

        secs = dto.get("sleepTimeSeconds")
        if secs:
            sleep_hrs = round(secs / 3600, 2)

        deep = dto.get("deepSleepSeconds")
        if deep:
            deep_sleep_min = round(deep / 60)

        light = dto.get("lightSleepSeconds")
        if light:
            light_sleep_min = round(light / 60)

        rem = dto.get("remSleepSeconds")
        if rem:
            rem_sleep_min = round(rem / 60)

        awake = dto.get("awakeSleepSeconds")
        if awake:
            awake_min = round(awake / 60)

        spo2        = dto.get("averageSpO2Value")
        respiration = dto.get("averageRespirationValue")
        sleep_stress= dto.get("avgSleepStress")
        resting_hr  = dto.get("restingHeartRate")

        print(f"  Sleep: {sleep_hrs}h  deep={deep_sleep_min}m light={light_sleep_min}m "
              f"rem={rem_sleep_min}m awake={awake_min}m  "
              f"SpO2={spo2}% resp={respiration} stress={sleep_stress}  rHR={resting_hr}")
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
if display_name:
    try:
        day_summary = garth.connectapi(
            f"/usersummary-service/usersummary/daily/{display_name}"
            f"?calendarDate={target}"
        )
        if day_summary:
            readiness = day_summary.get("bodyBatteryHighestValue")
            if resting_hr is None:
                resting_hr = day_summary.get("restingHeartRate")
        print(f"  Body battery: {readiness}  Resting HR: {resting_hr}")
    except Exception as e:
        print(f"  User summary fetch failed: {e}")

# --- Auto-migrate: add new columns if they don't exist ---
conn = psycopg2.connect(db_url)
cur = conn.cursor()
new_cols = [
    ("deep_sleep_min",  "INTEGER"),
    ("light_sleep_min", "INTEGER"),
    ("rem_sleep_min",   "INTEGER"),
    ("awake_min",       "INTEGER"),
    ("spo2",            "NUMERIC"),
    ("respiration",     "NUMERIC"),
    ("sleep_stress",    "NUMERIC"),
]
for col, dtype in new_cols:
    cur.execute(f"ALTER TABLE wellness ADD COLUMN IF NOT EXISTS {col} {dtype}")
conn.commit()

# --- Upsert into DB ---
cur.execute(
    """
    INSERT INTO wellness
        (date, sleep_hrs, deep_sleep_min, light_sleep_min, rem_sleep_min,
         awake_min, spo2, respiration, sleep_stress, hrv, resting_hr, readiness)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (date) DO UPDATE SET
        sleep_hrs       = EXCLUDED.sleep_hrs,
        deep_sleep_min  = EXCLUDED.deep_sleep_min,
        light_sleep_min = EXCLUDED.light_sleep_min,
        rem_sleep_min   = EXCLUDED.rem_sleep_min,
        awake_min       = EXCLUDED.awake_min,
        spo2            = EXCLUDED.spo2,
        respiration     = EXCLUDED.respiration,
        sleep_stress    = EXCLUDED.sleep_stress,
        hrv             = EXCLUDED.hrv,
        resting_hr      = EXCLUDED.resting_hr,
        readiness       = EXCLUDED.readiness
    """,
    (target, sleep_hrs, deep_sleep_min, light_sleep_min, rem_sleep_min,
     awake_min, spo2, respiration, sleep_stress, hrv, resting_hr, readiness),
)
conn.commit()
cur.close()
conn.close()
print(f"Done — upserted wellness for {target}")
