#!/usr/bin/env python3
"""
Pulls yesterday's wellness data from Garmin Connect and upserts into Neon DB.
Requires env vars: GARMIN_EMAIL, GARMIN_PASSWORD, DATABASE_URL
"""

import os
import sys
from datetime import date, timedelta

try:
    from garminconnect import Garmin
except ImportError:
    print("ERROR: garminconnect not installed. Run: pip install garminconnect==0.2.22")
    sys.exit(1)

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

email = os.environ["GARMIN_EMAIL"]
password = os.environ["GARMIN_PASSWORD"]
db_url = os.environ["DATABASE_URL"]

target = (date.today() - timedelta(days=1)).isoformat()
print(f"Syncing Garmin wellness for {target}")

# --- Connect to Garmin ---
client = Garmin(email, password)
client.login()

sleep_hrs = None
hrv = None
resting_hr = None
readiness = None

# --- Sleep + resting HR ---
try:
    sleep_data = client.get_sleep_data(target)
    dto = (sleep_data or {}).get("dailySleepDTO", {})
    secs = dto.get("sleepTimeSeconds")
    if secs:
        sleep_hrs = round(secs / 3600, 1)
    resting_hr = dto.get("restingHeartRate")
    print(f"  Sleep: {sleep_hrs}h, Resting HR: {resting_hr}")
except Exception as e:
    print(f"  Sleep fetch failed: {e}")

# --- HRV ---
try:
    hrv_data = client.get_hrv_data(target)
    summary = (hrv_data or {}).get("hrvSummary", {})
    hrv = summary.get("lastNight") or summary.get("weeklyAvg")
    print(f"  HRV: {hrv}ms")
except Exception as e:
    print(f"  HRV fetch failed: {e}")

# --- Body battery (readiness proxy) ---
try:
    bb = client.get_body_battery(target, target)
    if bb:
        # "charged" = max battery reached after sleep
        charged = next((r.get("charged") for r in bb if r.get("charged") is not None), None)
        readiness = charged
    print(f"  Body battery: {readiness}")
except Exception as e:
    print(f"  Body battery fetch failed: {e}")

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
