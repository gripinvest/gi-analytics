"""
Add this to main.py — a lightweight ping endpoint.
Set UptimeRobot (free) to GET https://grip-analytics-api.onrender.com/ping every 14 minutes.
This prevents Render's free tier from sleeping, so the app is always fast.
"""

# Add to main.py under the /health route:

# @app.get("/ping")
# def ping():
#     return "ok"
#
# UptimeRobot setup (free):
# 1. Go to uptimerobot.com → Create free account
# 2. Add Monitor → HTTP(s)
# 3. URL: https://grip-analytics-api.onrender.com/ping
# 4. Interval: 14 minutes
# Done — Render never sleeps.
