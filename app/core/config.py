import os

from dotenv import load_dotenv

load_dotenv(".env")

JWT_SECRET = os.environ["JWT_SECRET"]
ALGORITHM = "HS256"
# The client renews the token while the app is in use (POST /auth/refresh),
# so a session only ends after a week without opening the app.
ACCESS_TOKEN_EXPIRE_MINUTES = 7 * 24 * 60
RESET_TOKEN_EXPIRE_MINUTES = 30

# Password-reset mail. Without SMTP_HOST the reset link is written to the server log.
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER or "planifier@localhost")
# Base URL used in mailed links (never taken from the request's Host header).
APP_URL = os.getenv("APP_URL", "http://127.0.0.1:8000").rstrip("/")

MONGODB_URI = os.getenv("MONGODB_URI")
DATABASE_NAME = os.getenv("DATABASE_NAME", "taskify_db")
