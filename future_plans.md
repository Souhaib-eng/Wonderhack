# WonderHack — Future Plans & Known Issues

## ✅ Resolved

### Server-side accounts, sessions and score persistence
- Accounts live in SQLite (`users`) with salted PBKDF2 password hashes.
- Login creates a real server-side session; the browser receives an `HttpOnly`
  `wh_session` cookie. Session tokens are stored only as SHA-256 hashes.
- `POST /api/solve` validates each answer on the server, records it in the
  `solves` table exactly once, and adds the coins to the player's account.
- `GET /api/me` restores coins + solved puzzles after a refresh or on another
  device (same account/cookie).
- `GET /api/leaderboard` ranks all registered players by saved coins and is
  restricted to the Court Administrator account (`admin`); anonymous visitors
  get 401 and other players get 403.
- The Heart's Queen account has a private answer scroll: `GET /api/queen/answers`
  returns every riddle, question, accepted answers and coin value. The scroll's
  flag panel follows the chamber the players selected most recently (stored in
  the SQLite `settings` table) and refreshes live through `GET /api/queen/flag`.
  The Queen does not play puzzles: she is redirected to the scroll and
  `POST /api/solve` returns 403.
- Profile display name / email are persisted through `POST /api/profile`.
- `POST /api/reset` wipes a player's saved progression.
- The leaderboard auto-refreshes every 20 seconds.

### Mad Hatter hints and the Easy economy
- The Mad Hatter hint shop is populated with five Easy hints.
- Hints are server-priced through `POST /api/hint`; the server owns the cost,
  deducts from both the total and Easy balances, and stores each purchase in
  `purchased_hints` so it survives reloads and other devices.
- Hint costs are aligned to `0, 10, 20, 30, 40` Sovereigns across
  `public/js/wonderhack-easy-hints.js`, `public/data/wonderhack-easy-hints.json`
  and `src/server.py`.
- Hint copy teaches the console-only `isSolved()` path and mentions the cat's
  200-Sovereign Cipher Lab key. The revealed hint text uses the locally bundled
  IM Fell English storybook face.

### Console-only Easy flag
- The Easy flag is no longer obtainable from any on-page decoder or panel:
  - `src/server.py` builds the four-layer trail from `EASY_CIPHER_MESSAGE`, a
    non-flag message that tells the player to return to the Easy Chamber and
    run `isSolved()`. The flag is returned only by the intentional Easy-only
    `/api/check-is-solved` flaw and by the Queen's answer scroll.
  - `POST /api/cheshire/advance` returns `revealed` (the cat's message) on the
    final layer, never a `flag` field. No intermediate value or public file
    contains the Easy flag.
  - `public/challenges/easy/index.html` no longer has the "Queen's Sealed Flag"
    panel, its copy button, or the `cheshire-cipher.js` client. The chamber is
    now purely the riddle room.
  - `public/challenge.html` no longer has "Verify Flag Format" or a flag
    validation banner. The guide's final state displays the decoded message and
    points the player at the console.
  - Guide progress moved from `wh_cheshire_guide_v1` to `wh_cheshire_guide_v2`.
    The old key (which may have contained the flag) is deleted on load, so stale
    progress cannot leak the flag into the UI.
- The public flag surface was audited and tightened:
  - The legacy `POST /api/flag` endpoint was removed. It trusted a client-supplied
    `solvedPuzzles` list and could return any difficulty's flag, which violated
    the "only `isSolved()` and the Queen" rule. The route now returns 404.
  - `POST /api/difficulty` no longer includes `flag` in its response, and
    `WonderSession.selectDifficulty()` no longer returns one. This endpoint is
    public and is called by the chamber hub, login gate and puzzle engine only
    to record the active difficulty for the Queen's scroll.
  - The remaining `flag` fields in `src/server.py` are exclusively in
    `GET /api/queen/answers`, `GET /api/queen/flag` (both Queen-only) and the
    Easy-referer branch of `POST /api/check-is-solved`.

### Paid Cipher Lab and Cheshire Cat gating
- The cat becomes clickable only in the Easy chamber after all five Easy hints
  have been purchased. Everywhere else it fades away on hover and ignores clicks.
- The Cipher Lab itself costs 200 Sovereigns. `POST /api/cheshire/unlock`
  verifies that every Easy hint is owned, deducts the coins server-side, and
  records `cheshire-cat-pass` in `purchased_hints`. The pass survives reloads,
  logout/login and other devices.
- `public/js/characters.js` exposes `hasCheshirePass()` and
  `requestCheshirePass()`. The latter renders a themed payment modal using the
  shared `.wonder-modal-*` styles and falls back to `WonderState.purchaseHint`
  when the player is offline or not logged in.
- Both the Mad Hatter's cat sprite and the global cat click handler in
  `public/js/main.js` check the pass before navigating to `challenge.html`.
  Clicking an unlocked but unpaid cat opens the payment prompt instead of the
  lab. Direct visitors to `challenge.html` see the paywall line and can pay by
  clicking the cat.
- After each decoding instruction is completed, the cat supplies the next
  instruction; the four-step trail is Base64 Decode → Reverse Hex → ROT13 →
  URL Decode.

### Character voices
- `public/js/main.js` synthesises three themed voices with the Web Audio API:
  - Queen of Hearts: low, detuned angry roar.
  - Cheshire Cat: rising, purring meow.
  - Mad Hatter: wheezing four-note laugh.
- `public/js/characters.js` `showBubble()` accepts a `voice` argument so Queen,
  Cat and Hatter dialogue play the matching sound. The generic click sound no
  longer overrides character sprite voices.

### Project structure, database and cache hygiene
- The project is split into `public/` (client-facing) and `src/` (internal
  backend). The root `server.py` delegates to `src.server.main()`.
- `src/server.py` puts `src/` ahead of the repository root on `sys.path`, so the
  maintained schema in `src/db/` is the one Python loads. The canonical database
  is `src/db/wonderhack.db`; set `WONDERHACK_DB` to point the server (and the
  regression suite) at another file.
- `db/init_db.py` is kept as a compatibility copy for the legacy root path, but
  new schema work belongs in `src/db/init_db.py`.
- Cache-busting versions were bumped for every changed asset: `main.js` v21,
  `session.js` v9, `puzzles.js` v17, `profile.js` v17, `characters.js` v19,
  `mad-hatter.js` v24, `puzzle-engine.js` v21, `main.css` v15,
  `leaderboard.css` v3 and `puzzles.css` v14.

## 🔧 Known Issues To Fix Later

- The former `Alice` and `The Red Queen` demo accounts have been removed from
  the database and from the seed list. Only `admin`, `hearts_queen` and real
  player accounts remain.
- The old `public/js/database.js` IndexedDB helper remains for reference only,
  seeds no accounts, and is no longer used for authentication or scoring.
- The offline fallback for `WonderState.purchaseHint()` now requires an explicit
  demo opt-in (`window.WONDERHACK_DEMO === true` or a `wonderhack-demo` body
  class). A production page cannot grant the Cipher Lab pass locally. The
  fallback is documented in `CHANGES.txt`; online play always uses
  `POST /api/cheshire/unlock`.
- `POST /api/cheshire/advance` is intentionally stateless: it validates the
  supplied cipher text against the expected layer but does not track per-user
  step progress server-side. Progress is stored in
  `wh_cheshire_guide_v2` and can be replayed. This is fine for a teaching
  challenge; if the guide ever awards a flag or coins, move step state into the
  `solves`/`purchased_hints` model.
- The regression suite lives in `tests/verify.py` and runs with
  `python3 -m tests.verify`. It starts an isolated server against a temporary
  `WONDERHACK_DB`, so it never touches the event database.

## 🎯 Intentionally Vulnerable Teaching Challenges

- Challenge logic is backend-owned: the chamber pages fetch questions and hints
  from `GET /api/puzzles`, and answers are only ever checked by
  `POST /api/solve`. No accepted-answer list exists in `public/`.
- `public/js/check-is-solved.js` exposes `isSolved()` (and the older
  `checkIsSolved(number, solved)`) on the landing page and chamber pages.
  `POST /api/check-is-solved` intentionally trusts the `solved` claim, but only
  when the request comes from the Easy Chamber or the landing page. Calling
  `isSolved()` there returns the Easy flag. Medium and Hard requests receive
  HTTP 403 (`immune: true`) based on the browser-provided Referer, so those
  chambers cannot use the shortcut. This Easy-only trust flaw is a deliberate
  teaching challenge, not a bug to fix.
- The final trial of each chamber (Easy 15, Medium 110, Hard 205) is sealed by
  the Queen. `queenCorrupted` is served by the backend and `POST /api/solve`
  returns 403 for those IDs, so the seal survives logout, re-login, progress
  resets and client-side tampering. The Easy flag is still reachable through the
  intentionally vulnerable Easy-only `isSolved()` helper; the Medium and Hard
  flags stay behind the immunity gate and the Queen's scroll.
- The Cheshire Cat's four-layer Cipher Lab trail (Base64 Decode → Reverse Hex →
  ROT13 → URL Decode) no longer reveals the Easy flag. The plaintext is a
  non-flag message instructing the player to run `isSolved()`. Every
  intermediate value and the final message stay server-side;
  `GET /api/cheshire` exposes only the sealed value and the operation order, and
  `POST /api/cheshire/advance` validates one operation at a time.
- Flag inventory (for maintainers only; never render these in the UI):
  - Easy: `CIC{cur10us_4l1c3}`
  - Medium: `CIC{th3_qu33n_4lw4ys_w4tch3s}`
  - Hard: `CIC{n0_rul3_1s_s4f3_1n_w0nd3rl4nd}`

---

## 🚀 Planned Features

- [x] Server-side hint catalogue + coin deductions (`POST /api/hint`).
- [x] Restructured into `public/` (client-facing) and `src/` (internal/backend).
- [x] Mad Hatter hints are server-priced and use the tea-room storybook font.
- [x] Console-only Easy flag with a paid Cipher Lab and character voices.
- [x] Admin-only leaderboard access.
- [x] One flag per difficulty, shown on the Queen's scroll.
- [x] Optional OAuth / external identity provider login.
- [x] Per-difficulty leaderboard filters and event-season resets.
- [x] Admin view for monitoring registered players and solves.
- [x] Per-chamber progress counters so Easy 15 / Medium 10 / Hard 5 are shown
  separately in the Grand Hall and profile.
- [x] Automated smoke/regression tests for the flag gates and Cheshire flow.
- [x] Accessibility and reduced-motion pass for character voices and modals.

---

## ✅ Completed in the 2026 hardening release

The former "Detailed Remaining Work" list is complete. The concrete changes
are recorded here so future maintainers can find the contracts quickly.

### 1. Regression suite
- `tests/verify.py` boots an isolated server with a temporary `WONDERHACK_DB`
  and covers registration, server scoring, the Easy/Medium/Hard referer gate,
  ordinal 30's label, the full Cipher Lab trail, the paid Cipher Lab pass,
  Queen-only answer/flag endpoints, admin monitoring, season rollover, privileged
  reset protection and the disabled OAuth state.
- Run it from the repository root with `python3 -m tests.verify`. It never
  modifies `src/db/wonderhack.db`.

### 2. Ordinal-30 console label
- `POST /api/check-is-solved` now returns `title: "The Final Trial"` and
  `difficulty: "Easy"` for ordinal 30, matching the Easy flag it returns.

### 3. Per-chamber progress counters
- `GET /api/me`, `POST /api/solve` and `POST /api/progress` include
  `progressByDifficulty: {easy: {solved,total}, medium: ..., hard: ...}`.
- The Grand Hall (`public/puzzles.html` + `puzzles.js`) and the Player Dossier
  (`public/profile.html` + `profile.js`) render an accessible progress bar for
  each chamber. Totals come from the server puzzle catalogue.

### 4. Admin monitoring view
- New admin-only endpoints: `GET /api/admin/players` (search, sort, pagination),
  `GET /api/admin/solves` (recent solves) and `GET /api/admin/audit` (privileged
  action trail).
- New `public/admin.html` + `public/css/admin.css` page, linked from the shared
  admin navigation and the leaderboard.
- `POST /api/admin/players/reset` wipes a player's solves, coins and hints with
  an explicit `RESET` confirmation. Privileged `admin`/`hearts_queen` accounts
  cannot be reset.
- Every reset and season rollover appends a row to `admin_audit`.

### 5. Leaderboard filters and seasons
- `GET /api/leaderboard` accepts `?difficulty=all|easy|medium|hard` and
  `?season=current|all`. The leaderboard page exposes both controls and shows
  the active season note.
- `solves.season` and the `current_season` setting were added. A rollover
  archives the old season, increments `current_season`, zeroes player-facing
  coins/solved caches, and preserves purchased hints and the Cipher Lab pass.
- `season=current` aggregates the active season; `season=all` aggregates every
  archived season.

### 6. OAuth / external identity provider login
- Provider-agnostic OAuth 2.0 endpoints: `GET /api/oauth/status`,
  `GET /api/oauth/start`, `GET /api/oauth/callback`.
- Configure with `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`,
  `OAUTH_AUTHORIZE_URL`, `OAUTH_TOKEN_URL`, `OAUTH_USERINFO_URL` and optionally
  `OAUTH_PROVIDER_NAME`, `OAUTH_SCOPE`, `OAUTH_REDIRECT_URI`. The login button
  stays hidden unless the full configuration is present.
- `users.oauth_subject` maps one provider subject to one account. An existing
  local account is linked by email only when the provider marks the email as
  verified. Provider claims never assign admin/Queen roles.

### 7. Accessibility and reduced motion
- `prefers-reduced-motion: reduce` disables decorative animation, transitions,
  hover transforms and floating cards, and the Web Audio voices skip playback.
- The Cheshire Cat payment modal traps focus, closes on Escape, supports
  Enter/Space, uses `role="dialog"`/`aria-modal="true"`, and returns focus to
  the triggering sprite on close.
- The cat sprite is keyboard-operable and exposes an accessible label that
  reflects locked / unpaid / paid state.

### 8. Offline/demo path hardening
- `WonderState.purchaseHint()` refuses to grant anything unless the page opts in
  with `window.WONDERHACK_DEMO === true` or a `wonderhack-demo` body class.
- The Cipher Lab pass remains server-authoritative online through
  `POST /api/cheshire/unlock`; the local fallback is explicitly demo-only.

### 9. Documentation and release hygiene
- This file and `CHANGES.txt` describe the release, the endpoints and the cache
  version bumps.
- Restart with `python3 server.py`, then run `python3 -m tests.verify`.
- Manual smoke checks: `/api/cheshire`, `/api/cheshire/unlock`,
  `/api/check-is-solved`, `/api/queen/flag`, `/api/admin/players`.
- The SQLite database is `src/db/wonderhack.db`. Keep it free of `test_*`,
  `regress_*`, `verify_*` and `guide_tester_*` accounts; the regression suite
  uses a temporary database and cannot pollute it.
- The shipped event database is clean: `admin`, `hearts_queen` and `Kardoush`
  all start at 0 coins with no solves or hint purchases.
- Bump the `?v=` query string whenever a JS/CSS asset changes (the project has
  no bundler).
