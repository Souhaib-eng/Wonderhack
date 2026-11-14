# Wonderhack
A hacking room game of Alice who got trapped in the wanderland and got captured by The Heart's Queen who ordered to execute her, but the king has some mercy in his heart, challenged her to solve the queen's puzzle in order to get free out of wonderlind

## Run locally

Requires Python 3.10+.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py
```

Open `http://localhost:8080`. The Hard chamber is at
`http://localhost:8080/challenges/hard/index.html`. Register a player at the
login gate; existing accounts and progress are retained. Database migrations
run automatically on startup.

HTTP and WebSockets share the same port. A reverse proxy must forward
WebSocket upgrades for `/ws/queen`. `PORT` overrides the default port and
`WONDERHACK_DB` selects a separate SQLite database, for example:

```bash
PORT=8090 WONDERHACK_DB=/tmp/wonderhack-dev.db python server.py
```

## Verify

```bash
python -m tests.verify
# For runners that cannot bind local sockets:
python -m tests.verify --in-process
# Queen animation and broadcast behavior (requires Node.js):
node --test tests/hard_chat_verify.js
```

Both modes exercise HTTP and WebSocket wire messages against a temporary
database. They never modify your game database. The in-process mode uses the
real request handlers with an in-memory transport.

## The final challenge

Easy contains 10 trials; Medium and Hard contain 5 each, including one sealed
final trial per chamber. The Queen destroys that trial in a skippable animated
scene. Reduced-motion settings show a still scene with a Continue button.
Medium clues cost 200, 200, and 0 coins so four riddles can fund the investigation.

The Inner Sanctum adds Queen dialogue over WebSockets, court dossiers, and three Mad
Hatter clues costing 300, 200, and 0 Hard Sovereigns. The profile disclosure
and WebSocket secret leak are deliberate CTF vulnerabilities. The leaked weak
digest belongs to a fictional, Hard-only credential; normal account passwords
continue to use salted PBKDF2.
After the final riddle is destroyed, players investigate the game's HTTP and
WebSocket traffic using external tools such as Burp Suite. The final trial
uses the Queen’s speech bubble for replies. Secrets remain in the actual
WebSocket response for investigation.

Organizer notes and the intended solution are in
[docs/hard-challenge.md](docs/hard-challenge.md), outside the public web root.
