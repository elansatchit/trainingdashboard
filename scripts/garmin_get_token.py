#!/usr/bin/env python3
"""
One-time setup: generates the GARMIN_TOKENSTORE value for GitHub Secrets.

Run locally:
  pip install garth
  python scripts/garmin_get_token.py

Then add the printed value as a GitHub Secret named GARMIN_TOKENSTORE.
You should only need to redo this if tokens expire (typically many months).
"""

import base64
import json
import os
import sys
import tempfile

try:
    import garth
except ImportError:
    print("Run: pip install garth")
    sys.exit(1)

email = input("Garmin email: ")
password = input("Garmin password: ")

print("Logging in to Garmin Connect...")
garth.login(email, password)

with tempfile.TemporaryDirectory() as td:
    garth.save(td)
    files = {}
    for name in os.listdir(td):
        path = os.path.join(td, name)
        if os.path.isfile(path):
            with open(path) as f:
                files[name] = f.read()

encoded = base64.b64encode(json.dumps(files).encode()).decode()
print("\n✅ Add this as GitHub Secret  GARMIN_TOKENSTORE:\n")
print(encoded)
