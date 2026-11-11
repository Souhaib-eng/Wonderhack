/**
 * WONDERHACK — Server Session & Leaderboard Client  v2.0
 *
 * Thin async wrapper around the backend API. The browser never decides its own
 * coin balance: puzzle answers are validated by the server and every solve is
 * written to SQLite exactly once.
 *
 * Public API:
 *   WonderSession.boot()                 → restore session on page load
 *   WonderSession.register(data)         → POST /api/register → sets cookie
 *   WonderSession.login(username, pass)  → POST /api/login    → sets cookie
 *   WonderSession.logout()               → POST /api/logout   → clears cookie
 *   WonderSession.solvePuzzle(id, answer)→ server-validated solve + coin save
 *   WonderSession.buyHint(hintId)        → server-authoritative hint purchase
 *   WonderSession.unlockCheshire()       → buy the 200-coin Cipher Lab pass
 *   WonderSession.saveProgress()         → sync hint purchases (debounced)
 *   WonderSession.updateProfile(data)    → save display name / email
 *   WonderSession.resetProgress()        → wipe server progression
 *   WonderSession.leaderboard(opts)        → GET /api/leaderboard (admin only)
 *                                          opts: { difficulty, season }
 *   WonderSession.adminPlayers(opts)     → GET /api/admin/players (admin only)
 *   WonderSession.adminSolves(opts)      → GET /api/admin/solves (admin only)
 *   WonderSession.adminAudit(opts)       → GET /api/admin/audit (admin only)
 *   WonderSession.adminResetPlayer(data) → POST /api/admin/players/reset
 *   WonderSession.adminRolloverSeason()  → POST /api/admin/season/rollover
 *   WonderSession.oauthStatus()          → GET /api/oauth/status
 *   WonderSession.queenAnswers()         → GET /api/queen/answers (Queen only)
 *   WonderSession.queenFlag()            → GET /api/queen/flag (Queen only)
 *   WonderSession.selectDifficulty(diff) → POST /api/difficulty (updates the
 *                                          flag shown on the Queen's scroll)
 *   WonderSession.isServerAvailable()    → boolean
 *   WonderSession.isAuthenticated()      → boolean
 *   WonderSession.isAdmin() / isQueen()  → privilege checks for the UI
 */

const WonderSession = (() => {
  const BASE = ''; // same-origin: static files and API share this server
  const HEADERS = { 'Content-Type': 'application/json' };

  let _serverAvailable = null; // null = not tested yet
  let _saveTimer = null;
  let _user = null;
  let _bootPromise = null;
  let _authVersion = 0;

  // ── small fetch wrapper ───────────────────────────────────────────────────

  async function _api(method, path, body) {
    try {
      const opts = {
        method,
        credentials: 'same-origin', // send/receive the wh_session HttpOnly cookie
        headers: HEADERS,
        cache: 'no-store',
      };
      if (body !== undefined) opts.body = JSON.stringify(body);

      const res = await fetch(BASE + path, opts);
      _serverAvailable = true;

      let data = {};
      try {
        data = await res.json();
      } catch (e) {
        // A static file server (e.g. `python3 -m http.server`) answers API
        // calls with an HTML error page. Say so instead of a generic failure.
        const isStaticServer = res.status === 501 || res.status === 404;
        data = {
          error: isStaticServer
            ? 'The app is being served by a plain file server, so there is no WonderHack API. Stop it and run "python3 server.py", then open http://localhost:8080.'
            : `The server returned an invalid response (HTTP ${res.status}).`,
        };
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      _serverAvailable = false;
      return { ok: false, status: 0, data: { error: err.message } };
    }
  }

  // ── state helpers ─────────────────────────────────────────────────────────

  function _applyUser(user) {
    _user = user || null;
    if (typeof WonderState !== 'undefined' && user) {
      WonderState.login(user);
    }
  }

  function _clearUser() {
    _user = null;
    if (typeof WonderState !== 'undefined' && WonderState.isLoggedIn()) {
      WonderState.logout();
    }
  }

  // ── public methods ────────────────────────────────────────────────────────

  /**
   * boot() — called once on DOMContentLoaded.
   * GET /api/me restores the account and saved progression from the session
   * cookie. If the server is unreachable the local state is left untouched.
   * Repeated calls share one request, so page scripts can safely `await` it.
   */
  function boot() {
    if (!_bootPromise) _bootPromise = _boot();
    return _bootPromise;
  }

  async function _boot() {
    const startedAt = _authVersion;
    const { ok, status, data } = await _api('GET', '/api/me');

    // A login/registration finished while this request was in flight — the
    // older response must not overwrite the newer authenticated state.
    if (startedAt !== _authVersion) return isAuthenticated();

    if (status === 0) {
      _serverAvailable = false;
      console.info('WonderSession: server offline, using local state.');
      return false;
    }

    _serverAvailable = true;

    if (!ok || !data.user) {
      _clearUser();
      return false;
    }

    _applyUser(data.user);
    return true;
  }

  /**
   * register({ username, password, displayName, email })
   */
  async function register(payload) {
    const { ok, status, data } = await _api('POST', '/api/register', payload);

    if (status === 0) {
      return { success: false, offline: true, error: 'Cannot reach the royal registry. Is server.py running?' };
    }
    if (ok && data.success && data.user) {
      _authVersion += 1;
      _bootPromise = null;
      _applyUser(data.user);
      return { success: true, user: data.user };
    }
    return { success: false, error: data.error || 'Registration failed.' };
  }

  /**
   * login(username, password) → { success, user?, error? }
   */
  async function login(username, password) {
    const { ok, status, data } = await _api('POST', '/api/login', { username, password });

    if (status === 0) {
      return { success: false, offline: true, error: 'Cannot reach the royal registry. Is server.py running?' };
    }
    if (ok && data.success && data.user) {
      _authVersion += 1;
      _bootPromise = null;
      _applyUser(data.user);
      return { success: true, user: data.user };
    }
    return { success: false, error: data.error || 'Login failed.' };
  }

  /**
   * logout() — destroys the server session and clears the HttpOnly cookie.
   */
  async function logout() {
    _authVersion += 1;
    await _api('POST', '/api/logout');
    _clearUser();
    _bootPromise = null;
  }

  /**
   * solvePuzzle(puzzleId, answer) — the ONLY way coins are awarded.
   * The server validates the answer, records the solve, and returns the new
   * authoritative balance + solved list.
   */
  async function solvePuzzle(puzzleId, answer) {
    if (_serverAvailable === false) {
      return { ok: false, offline: true, error: 'Server offline — progress was not saved.' };
    }
    if (!_user) {
      return { ok: false, notAuthenticated: true, error: 'Please log in to save this solve.' };
    }

    const { ok, status, data } = await _api('POST', '/api/solve', {
      puzzleId,
      answer,
    });

    if (status === 401) {
      _clearUser();
      return { ok: false, notAuthenticated: true, error: data.error || 'Session expired.' };
    }
    if (status === 0) {
      return { ok: false, offline: true, error: 'Server offline — progress was not saved.' };
    }
    if (ok && data.success) {
      if (data.correct) {
        if (typeof WonderState !== 'undefined') {
          WonderState.applyServerProgress({
            points: data.totalPoints,
            pointsByDifficulty: data.pointsByDifficulty,
            points_easy: data.points_easy,
            points_medium: data.points_medium,
            points_hard: data.points_hard,
            solvedPuzzles: data.solvedPuzzles,
            progressByDifficulty: data.progressByDifficulty,
          });
        }
        if (_user) {
          _user.points = data.totalPoints;
          _user.pointsByDifficulty = data.pointsByDifficulty;
          _user.points_easy = data.points_easy;
          _user.points_medium = data.points_medium;
          _user.points_hard = data.points_hard;
          _user.solved_puzzles = data.solvedPuzzles;
          _user.solvedPuzzles = data.solvedPuzzles;
          _user.solvedCount = data.solvedCount;
        }
      }
      return { ...data, ok: true };
    }
    return { ok: false, error: data.error || 'The royal registry rejected that solve.' };
  }

  /**
   * buyHint(hintId) — authoritatively purchases a hint via POST /api/hint.
   * Points are deducted by the server, and the authoritative balance is saved.
   */
  async function buyHint(hintId) {
    if (_serverAvailable === false) {
      return { ok: false, offline: true, error: 'Server offline.' };
    }
    if (!_user) {
      return { ok: false, notAuthenticated: true, error: 'Please log in to purchase hints.' };
    }
    const { ok, status, data } = await _api('POST', '/api/hint', { hintId });
    if (status === 401) {
      _clearUser();
      return { ok: false, notAuthenticated: true, error: data.error || 'Session expired.' };
    }
    if (status === 0) {
      return { ok: false, offline: true, error: 'Server offline.' };
    }
    if (ok && data.success) {
      if (typeof WonderState !== 'undefined' && data.user) {
        WonderState.applyServerProgress({
          points: data.totalPoints,
          pointsByDifficulty: data.pointsByDifficulty,
          points_easy: data.points_easy,
          points_medium: data.points_medium,
          points_hard: data.points_hard,
          purchasedHints: data.purchasedHints,
          progressByDifficulty: data.user && data.user.progressByDifficulty,
        });
      }
      if (_user) {
        _user.points = data.totalPoints;
        _user.points_easy = data.points_easy;
        _user.pointsByDifficulty = data.pointsByDifficulty;
        _user.purchased_hints = data.purchasedHints;
        _user.purchasedHints = data.purchasedHints;
      }
      return { ok: true, data };
    }
    return { ok: false, error: data.error || 'Hint purchase rejected.' };
  }

  /**
   * unlockCheshire() — buys the Cheshire Cat's 200-Sovereign Cipher Lab pass.
   * The server checks that every Easy hint was purchased and deducts the coins
   * from the account, then records the pass in purchased_hints.
   */
  async function unlockCheshire() {
    if (_serverAvailable === false) {
      return { ok: false, offline: true, error: 'The Cheshire Cat cannot reach the royal registry.' };
    }
    if (!_user) {
      return { ok: false, notAuthenticated: true, error: 'Please log in to pay the Cheshire Cat.' };
    }
    const { ok, status, data } = await _api('POST', '/api/cheshire/unlock');
    if (status === 401) {
      _clearUser();
      return { ok: false, notAuthenticated: true, error: data.error || 'Session expired.' };
    }
    if (status === 0) {
      return { ok: false, offline: true, error: 'The Cheshire Cat cannot reach the royal registry.' };
    }
    if (ok && data.success) {
      if (typeof WonderState !== 'undefined' && data.user) {
        WonderState.applyServerProgress({
          points: data.points,
          pointsByDifficulty: data.pointsByDifficulty,
          points_easy: data.points_easy,
          purchasedHints: data.purchasedHints,
        });
      }
      if (_user) {
        _user.points = data.points;
        _user.points_easy = data.points_easy;
        _user.pointsByDifficulty = data.pointsByDifficulty;
        _user.purchased_hints = data.purchasedHints;
        _user.purchasedHints = data.purchasedHints;
      }
      return { ok: true, ...data };
    }
    return { ok: false, error: data.error || 'The Cheshire Cat refuses your purse.' };
  }

  /**
   * saveProgress() — debounced: syncs hint purchases to the account.
   * Points are intentionally NOT sent: the server owns the coin economy.
   */
  function saveProgress() {
    if (_serverAvailable === false || !_user) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushProgress, 500);
  }

  async function _flushProgress() {
    _saveTimer = null;
    if (typeof WonderState === 'undefined' || !_user) return;
    const st = WonderState.getState();
    if (!st.isLoggedIn) return;

    const { ok, data } = await _api('POST', '/api/progress', {
      purchasedHints: st.purchasedHints || [],
    });

    if (ok && data.success) {
      if (typeof WonderState !== 'undefined' && data.user) {
        WonderState.applyServerProgress({
          points: data.totalPoints,
          pointsByDifficulty: data.pointsByDifficulty,
          points_easy: data.points_easy,
          points_medium: data.points_medium,
          points_hard: data.points_hard,
          solvedPuzzles: data.user.solvedPuzzles,
          purchasedHints: data.user.purchasedHints,
          progressByDifficulty: data.user.progressByDifficulty,
        });
      }
      const chamberDiff = (typeof WonderUI !== 'undefined') ? WonderUI.getCurrentChamberDifficulty() : null;
      let pts = data.totalPoints;
      if (chamberDiff && data.pointsByDifficulty && typeof data.pointsByDifficulty[chamberDiff] === 'number') {
        pts = data.pointsByDifficulty[chamberDiff];
      }
      const navPts = document.getElementById('nav-points-val');
      if (navPts && typeof pts === 'number') navPts.textContent = pts;
    }
  }

  /**
   * updateProfile({ displayName, email, character })
   */
  async function updateProfile(profile) {
    const { ok, data } = await _api('POST', '/api/profile', profile);
    if (ok && data.success && data.user) {
      _applyUser(data.user);
      return { success: true, user: data.user };
    }
    return { success: false, error: data.error || 'Could not seal the dossier.' };
  }

  /**
   * resetProgress() — wipes server-side coins, solves and hints.
   */
  async function resetProgress() {
    const { ok, data } = await _api('POST', '/api/reset', { confirm: 'RESET' });
    if (ok && data.success && data.user) {
      _applyUser(data.user);
      return { success: true, user: data.user };
    }
    return { success: false, error: data.error || 'Could not reset progress.' };
  }

  /**
   * leaderboard({ difficulty, season }) → { ok, status, entries, error, ... }
   *   difficulty: 'all' | 'easy' | 'medium' | 'hard'
   *   season:     'current' | 'all'
   * entries: { rank, username, character, role, points, solvedCount, isYou }
   * The server answers 401/403 unless the logged-in account is the Court
   * Administrator, so this cannot be bypassed from the browser.
   */
  async function leaderboard(options = {}) {
    const params = new URLSearchParams();
    const difficulty = String(options.difficulty || 'all').toLowerCase();
    const season = String(options.season || 'current').toLowerCase();
    if (['easy', 'medium', 'hard', 'all'].includes(difficulty)) {
      params.set('difficulty', difficulty);
    }
    if (season === 'all') params.set('season', 'all');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const { ok, status, data } = await _api('GET', `/api/leaderboard${suffix}`);
    return {
      ok: ok && data.success === true,
      status,
      entries: Array.isArray(data.leaderboard) ? data.leaderboard : [],
      difficulty: data.difficulty || difficulty,
      season: data.season || null,
      seasonMode: data.seasonMode || season,
      totalPlayers: data.totalPlayers || 0,
      error: data.error || '',
    };
  }

  // ── Court Administrator monitoring ──────────────────────────────────────

  /**
   * adminPlayers({ page, perPage, sort, order, search }) →
   *   { ok, status, players, total, page, pages, season, error }
   */
  async function adminPlayers(options = {}) {
    const params = new URLSearchParams();
    if (options.page) params.set('page', String(options.page));
    if (options.perPage) params.set('perPage', String(options.perPage));
    if (options.sort) params.set('sort', String(options.sort));
    if (options.order) params.set('order', String(options.order));
    if (options.search) params.set('search', String(options.search));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const { ok, status, data } = await _api('GET', `/api/admin/players${suffix}`);
    return {
      ok: ok && data.success === true,
      status,
      players: Array.isArray(data.players) ? data.players : [],
      total: data.total || 0,
      page: data.page || 1,
      perPage: data.perPage || 25,
      pages: data.pages || 1,
      season: data.season || null,
      error: data.error || '',
    };
  }

  async function adminSolves(options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const { ok, status, data } = await _api('GET', `/api/admin/solves${suffix}`);
    return {
      ok: ok && data.success === true,
      status,
      solves: Array.isArray(data.solves) ? data.solves : [],
      total: data.total || 0,
      error: data.error || '',
    };
  }

  async function adminAudit(options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const { ok, status, data } = await _api('GET', `/api/admin/audit${suffix}`);
    return {
      ok: ok && data.success === true,
      status,
      audit: Array.isArray(data.audit) ? data.audit : [],
      error: data.error || '',
    };
  }

  async function adminResetPlayer({ userId, username, confirm = 'RESET' } = {}) {
    const payload = { confirm };
    if (userId !== undefined) payload.userId = userId;
    if (username) payload.username = username;
    const { ok, status, data } = await _api('POST', '/api/admin/players/reset', payload);
    return {
      ok: ok && data.success === true,
      status,
      player: data.player || null,
      error: data.error || '',
    };
  }

  async function adminRolloverSeason(confirm = 'ROLLOVER') {
    const { ok, status, data } = await _api(
      'POST', '/api/admin/season/rollover', { confirm }
    );
    return {
      ok: ok && data.success === true,
      status,
      previousSeason: data.previousSeason,
      season: data.season,
      error: data.error || '',
    };
  }

  /**
   * adminSkipToFinal(difficulty) → { ok, status, puzzleId, title, sealed, ... }
   * Court Administrator only. Resolves (and audits) the final trial of a
   * chamber without solving or awarding anything.
   */
  async function adminSkipToFinal(difficulty) {
    const { ok, status, data } = await _api(
      'POST', '/api/admin/skip', { difficulty }
    );
    return {
      ok: ok && data.success === true,
      status,
      difficulty: data.difficulty || difficulty,
      puzzleId: data.puzzleId,
      title: data.title || '',
      sealed: data.sealed === true,
      skipped: data.skipped || 0,
      total: data.total || 0,
      error: data.error || '',
    };
  }

  /** oauthStatus() → { ok, enabled, provider, startUrl, error } */
  async function oauthStatus() {
    const { ok, status, data } = await _api('GET', '/api/oauth/status');
    return {
      ok: ok && data.success === true,
      status,
      enabled: data.enabled === true,
      provider: data.provider || '',
      startUrl: data.startUrl || '/api/oauth/start',
      error: data.error || '',
    };
  }

  /**
   * queenAnswers() → { ok, status, flag, puzzles, error }
   * The server answers 403 for every account except The Heart's Queen.
   */
  async function queenAnswers() {
    const { ok, status, data } = await _api('GET', '/api/queen/answers');
    return {
      ok: ok && data.success === true,
      status,
      flag: typeof data.flag === 'string' ? data.flag : '',
      difficulty: typeof data.difficulty === 'string' ? data.difficulty : 'easy',
      puzzles: Array.isArray(data.puzzles) ? data.puzzles : [],
      error: data.error || '',
    };
  }

  /**
   * queenFlag() → { ok, status, difficulty, flag, error }
   * Lightweight polling endpoint for the live flag on the Queen's scroll.
   */
  async function queenFlag() {
    const { ok, status, data } = await _api('GET', '/api/queen/flag');
    return {
      ok: ok && data.success === true,
      status,
      difficulty: typeof data.difficulty === 'string' ? data.difficulty : 'easy',
      flag: typeof data.flag === 'string' ? data.flag : '',
      error: data.error || '',
    };
  }

  /**
   * selectDifficulty(difficulty) → { ok, status, difficulty, error }
   * Tells the backend which chamber the player just chose. The Queen's answer
   * scroll uses this shared value to show the matching difficulty flag.
   */
  async function selectDifficulty(difficulty) {
    const diff = String(difficulty || '').trim().toLowerCase();
    if (!['easy', 'medium', 'hard'].includes(diff)) {
      return { ok: false, status: 0, difficulty: '', flag: '', error: 'Unknown difficulty.' };
    }
    try {
      localStorage.setItem('wonderhack_last_difficulty', diff);
    } catch (e) {}
    const { ok, status, data } = await _api('POST', '/api/difficulty', { difficulty: diff });
    return {
      ok: ok && data.success === true,
      status,
      difficulty: typeof data.difficulty === 'string' ? data.difficulty : diff,
      error: data.error || '',
    };
  }

  function isServerAvailable() {
    return _serverAvailable === true;
  }

  function isAuthenticated() {
    return !!_user;
  }

  function isAdmin() {
    if (!_user) return false;
    return _user.isAdmin === true
      || (_user.username || '').toLowerCase() === 'admin'
      || /administrator/i.test(_user.role || '');
  }

  function isQueen() {
    if (!_user) return false;
    return _user.isQueen === true
      || (_user.username || '').toLowerCase() === 'hearts_queen';
  }

  function currentUser() {
    return _user;
  }

  // ── expose ────────────────────────────────────────────────────────────────
  const pub = {
    boot,
    register,
    login,
    logout,
    solvePuzzle,
    buyHint,
    unlockCheshire,
    saveProgress,
    updateProfile,
    resetProgress,
    leaderboard,
    adminPlayers,
    adminSolves,
    adminAudit,
    adminResetPlayer,
    adminRolloverSeason,
    oauthStatus,
    queenAnswers,
    queenFlag,
    selectDifficulty,
    isServerAvailable,
    isAuthenticated,
    isAdmin,
    isQueen,
    currentUser,
  };
  if (typeof window !== 'undefined') window.WonderSession = pub;
  return pub;
})();
