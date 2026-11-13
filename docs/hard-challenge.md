# The Queen's Last Broadcast — organizer notes (spoilers)

The Hard chamber retains its four coin-earning riddles and corrupted final
riddle. The last riddle cannot be solved through `/api/solve`. Alice must
investigate the court and steal the Queen's Hard-only credential instead.
The Queen's WebSocket stays disconnected during the four ordinary riddles.
Opening the final trial triggers the Queen's takeover: she destroys the question,
then returns to the corrupted parchment and reveals a chat with the Queen.
Players can type messages, send with Enter or the Send button, and read replies.
The chat shows connection status and preserves unsent drafts across reconnects.
Players investigate actual HTTP and
WebSocket traffic with tools on their own computer, such as Burp Suite. The Queen's
ordinary dialogue uses the WebSocket, while leaked secrets are left in the network
response for the player to discover. Players can skip the
transition; reduced-motion preferences bypass it automatically. The takeover is
remembered per player for the current browser tab so returning from the shop or
reloading the final trial resumes the investigation immediately.

## Intended path

1. Register or sign in as a player, then enter the Hard chamber.
2. Solve the four ordinary riddles and open the final trial. After the Queen's
   takeover, click your profile in the header. The page
   requests `GET /api/profile?id=<courtId>`. Intercept it and change the ID to
   `1`: the Queen's dossier reveals the username `hearts_queen`. ID `0` is the
   administrator and always returns 403. The dossier never changes the logged
   in identity, grants privileges, or exposes account password hashes.
3. Click the Queen. Inspect the WebSocket upgrade to
   `/ws/queen` on the same host/port. Normal messages look like:

   ```json
   {"event":"message","data":1}
   ```

4. In Burp's WebSocket history/repeater, change the `data` payload to a string
   longer than three characters and send it. For example:

   ```json
   {"event":"message","data":"AAAA"}
   ```

   Alternatively, type a message longer than three characters in the Queen's
   chat. Both routes send a real WebSocket message. The Queen accidentally
   rehearses a secret: her server response includes `passwordHash` and
   `algorithm: "MD5"`. The chat and dialogue bubble show an interrupted reply;
   the secret stays in the network response for the player to inspect.
5. Recover the password from the digest. The atomic-theory hint points to John
   Dalton; the challenge's lowercase password is `dalton`. This is a dedicated
   fictional credential, independent of the Queen's normal PBKDF2 account hash.
6. Use the login page (`/login.html?difficulty=hard`) to sign in
   as `hearts_queen` with that password. The existing login flow opens the royal
   answer scroll. The session now has a server-stored Hard access capability.
7. Decode the Hard flag on that scroll: Base64, then ROT13. Log out and return
   to the castle's existing flag submission form to credit Alice's account.

The Mad Hatter offers the supplied Burp Suite clue for 300 coins, the WebSocket
clue for 200, and the atomic-theory clue for free (no third price was specified).
The shop retains its existing sequential hint progression and deducts only
Hard coins. Solve the four ordinary Hard riddles to fund the hints.

## Deliberate boundaries

- Court IDs are presentation IDs: admin `0`, Queen `1`, other users' SQLite ID
  plus two. Existing databases keep all primary keys and foreign keys.
- Profile lookup and WebSocket upgrades require an authenticated session.
- Only the `message` event with a string or array longer than three elements
  exposes the weak challenge digest. Ordinary numeric dialogue choices do not.
- wsproto handles the WebSocket protocol, including client masking, fragmented
  text, ping/pong and close frames. Messages above 4096 UTF-8 bytes close with
  code 1009. Idle connections close after 30 seconds and can be reconnected.
- Origins must match the game host. Every complete message rechecks the session
  so logout/expiry revokes an open socket's access.
- Medium's intentional SQL injection, the Queen's normal password, and submitting
  the digest as a password do not grant Hard access. A Hard Queen session keeps
  its Hard flag even when another player changes the shared difficulty.
- Existing player data and normal account password storage remain intact. The
  only schema migration adds a default-false capability to the sessions table.
