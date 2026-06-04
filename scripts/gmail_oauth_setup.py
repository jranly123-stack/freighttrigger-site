#!/usr/bin/env python3
"""Create a Gmail refresh token for the FreightTrigger engine.

This script starts a localhost callback server, opens the Google OAuth URL,
exchanges the returned code, and stores GMAIL_REFRESH_TOKEN in .env.
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DEFAULT_REDIRECT = "http://localhost:8765/oauth2callback"
SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_PATH.exists():
        raise SystemExit(".env not found. Create it from .env.example first.")
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
        os.environ.setdefault(key, value)
    return values


def write_env_value(key: str, value: str) -> None:
    lines = ENV_PATH.read_text().splitlines()
    found = False
    output: list[str] = []
    for line in lines:
        if line.startswith(f"{key}="):
            output.append(f"{key}={value}")
            found = True
        else:
            output.append(line)
    if not found:
        output.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(output) + "\n")


class CallbackHandler(BaseHTTPRequestHandler):
    server: "OAuthServer"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        self.server.code = query.get("code", [None])[0]
        self.server.error = query.get("error", [None])[0]
        self.server.state = query.get("state", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            b"<html><body><h2>FreightTrigger Gmail authorization received.</h2>"
            b"<p>You can close this tab and return to Codex.</p></body></html>"
        )
        threading.Thread(target=self.server.shutdown, daemon=True).start()


class OAuthServer(HTTPServer):
    code: str | None = None
    error: str | None = None
    state: str | None = None


def open_browser(url: str) -> None:
    try:
        subprocess.run(["open", url], check=False)
    except Exception:
        pass


def exchange_code(code: str, redirect_uri: str, client_id: str, client_secret: str) -> dict:
    payload = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode()
    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def main() -> None:
    env = load_env()
    client_id = env.get("GOOGLE_CLIENT_ID")
    client_secret = env.get("GOOGLE_CLIENT_SECRET")
    redirect_uri = env.get("GOOGLE_REDIRECT_URI") or DEFAULT_REDIRECT
    if not client_id or not client_secret:
        raise SystemExit("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.")

    parsed = urllib.parse.urlparse(redirect_uri)
    port = parsed.port or 8765
    state = secrets.token_urlsafe(24)
    params = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "include_granted_scopes": "true",
        }
    )
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{params}"

    server = OAuthServer(("127.0.0.1", port), CallbackHandler)
    print("Opening Google OAuth consent in your browser...")
    print("If Chrome does not open, visit this URL manually:")
    print(auth_url)
    open_browser(auth_url)
    server.serve_forever()

    if server.error:
        raise SystemExit(f"Google OAuth failed: {server.error}")
    if server.state != state:
        raise SystemExit("Google OAuth failed: state mismatch.")
    if not server.code:
        raise SystemExit("Google OAuth failed: no authorization code received.")

    token = exchange_code(server.code, redirect_uri, client_id, client_secret)
    refresh_token = token.get("refresh_token")
    if not refresh_token:
        raise SystemExit(
            "Google did not return a refresh token. Re-run the script and make sure "
            "you approve the consent prompt for the correct mailbox."
        )
    write_env_value("GOOGLE_REDIRECT_URI", redirect_uri)
    write_env_value("GMAIL_REFRESH_TOKEN", refresh_token)
    print("Gmail refresh token saved to .env as GMAIL_REFRESH_TOKEN.")
    print("No token was printed. Run python3 scripts/gmail_smoke_test.py to verify.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nCancelled.")
