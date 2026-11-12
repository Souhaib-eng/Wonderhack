/**
 * WONDERHACK — Core Application Architecture & Shared State
 * Manages player profile, points economy, audio synthesis, navigation, and dialogues.
 */

const WonderState = (() => {
  const STORAGE_KEY = 'wonderhack_gamestate_v1';

  // Default initial state: user is NOT logged in. No Alice account shows up at first!
  const defaultState = {
    isLoggedIn: false,
    player: null,
    points: 0,
    pointsByDifficulty: { easy: 0, medium: 0, hard: 0 },
    progressByDifficulty: {
      easy: { solved: 0, total: 15 },
      medium: { solved: 0, total: 10 },
      hard: { solved: 0, total: 5 }
    },
    solvedPuzzles: [],
    purchasedHints: [],
    audioEnabled: true,
    lastVisitedRoom: 'queen-castle'
  };

  function _normalizeDifficulty(diff) {
    if (!diff || typeof diff !== 'string') return null;
    const d = diff.trim().toLowerCase();
    if (d.includes('easy')) return 'easy';
    if (d.includes('med')) return 'medium';
    if (d.includes('hard')) return 'hard';
    return null;
  }

  function purchaseHintDemoAllowed() {
    if (typeof window === 'undefined') return false;
    return window.WONDERHACK_DEMO === true
      || (document.body && document.body.classList.contains('wonderhack-demo'));
  }

  function _normalizeProgress(raw) {
    const out = {};
    ['easy', 'medium', 'hard'].forEach((key) => {
      const base = defaultState.progressByDifficulty[key];
      const value = raw && raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
      out[key] = {
        solved: Math.max(0, Number(value.solved) || 0),
        total: Math.max(0, Number(value.total) || base.total || 0),
      };
    });
    return out;
  }

  function _recalcPointsByDifficulty(solvedPuzzles = []) {    const pbd = { easy: 0, medium: 0, hard: 0 };
    solvedPuzzles.forEach(pid => {
      const id = parseInt(pid, 10);
      if (id >= 200) pbd.hard += 200;
      else if (id >= 100) pbd.medium += 100;
      else if (id > 0) pbd.easy += 50;
    });
    return pbd;
  }

  // Load state from localStorage or initialize
  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Clear old mock Alice if not legitimately logged in
        if (!parsed.isLoggedIn || (parsed.player && parsed.player.username === 'Alice_Cipher')) {
          parsed.isLoggedIn = false;
          parsed.player = null;
          parsed.points = 0;
          parsed.pointsByDifficulty = { easy: 0, medium: 0, hard: 0 };
        }
        if (!parsed.pointsByDifficulty || typeof parsed.pointsByDifficulty !== 'object') {
          parsed.pointsByDifficulty = _recalcPointsByDifficulty(parsed.solvedPuzzles || []);
        } else {
          parsed.pointsByDifficulty = {
            easy: Number(parsed.pointsByDifficulty.easy) || 0,
            medium: Number(parsed.pointsByDifficulty.medium) || 0,
            hard: Number(parsed.pointsByDifficulty.hard) || 0,
          };
        }
        if (!parsed.progressByDifficulty || typeof parsed.progressByDifficulty !== 'object') {
          parsed.progressByDifficulty = { ...defaultState.progressByDifficulty };
        }
        return { ...defaultState, ...parsed };
      }
    } catch (e) {
      console.warn('WonderHack: Could not read localStorage, using defaults.', e);
    }
    return { ...defaultState };
  }

  let state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('WonderHack: Could not save to localStorage.', e);
    }
    notifyListeners();
  }

  const listeners = [];
  function subscribe(fn) {
    listeners.push(fn);
  }
  function notifyListeners() {
    listeners.forEach(fn => fn(state));
  }

  return {
    getState: () => ({ ...state }),
    isLoggedIn: () => !!(state.isLoggedIn && state.player),
    getPlayer: () => state.player,
    login: (user) => {
      state.isLoggedIn = true;
      state.player = {
        username: user.displayName || user.username,
        displayName: user.displayName || user.username,
        character: user.character || 'alice',
        role: user.role || 'Royal Voyager of the Keyhole',
        title: user.title || 'Voyager of the Keyhole',
        email: user.email || '',
        isAdmin: user.isAdmin === true || (user.username || '').toLowerCase() === 'admin',
        isQueen: user.isQueen === true || (user.username || '').toLowerCase() === 'hearts_queen',
        avatar: user.avatar || (
          (user.isAdmin === true || (user.username || '').toLowerCase() === 'admin' || user.character === 'admin')
            ? 'assets/images/characters/admin.png'
            : (user.character === 'queen' ? 'assets/images/characters/queen.png' : 'assets/images/characters/alice.png')
        )
      };
      const pbd = user.pointsByDifficulty || {};
      state.pointsByDifficulty = {
        easy: typeof pbd.easy === 'number' ? pbd.easy : (typeof user.points_easy === 'number' ? user.points_easy : 0),
        medium: typeof pbd.medium === 'number' ? pbd.medium : (typeof user.points_medium === 'number' ? user.points_medium : 0),
        hard: typeof pbd.hard === 'number' ? pbd.hard : (typeof user.points_hard === 'number' ? user.points_hard : 0),
      };
      state.points = typeof user.points === 'number'
        ? user.points
        : (state.pointsByDifficulty.easy + state.pointsByDifficulty.medium + state.pointsByDifficulty.hard);
      state.solvedPuzzles = Array.isArray(user.solvedPuzzles)
        ? user.solvedPuzzles
        : (Array.isArray(user.solved_puzzles) ? user.solved_puzzles : []);
      state.purchasedHints = Array.isArray(user.purchasedHints)
        ? user.purchasedHints
        : (Array.isArray(user.purchased_hints) ? user.purchased_hints : []);
      if (user.progressByDifficulty && typeof user.progressByDifficulty === 'object') {
        state.progressByDifficulty = _normalizeProgress(user.progressByDifficulty);
      }
      saveState();
    },
    /**
     * Replace local progression with the server's authoritative snapshot.
     * Used after boot and after each server-validated puzzle solve.
     */
    applyServerProgress: (progress = {}) => {
      const pbd = progress.pointsByDifficulty || {};
      if (!state.pointsByDifficulty) {
        state.pointsByDifficulty = { easy: 0, medium: 0, hard: 0 };
      }
      if (typeof pbd.easy === 'number') state.pointsByDifficulty.easy = pbd.easy;
      else if (typeof progress.points_easy === 'number') state.pointsByDifficulty.easy = progress.points_easy;

      if (typeof pbd.medium === 'number') state.pointsByDifficulty.medium = pbd.medium;
      else if (typeof progress.points_medium === 'number') state.pointsByDifficulty.medium = progress.points_medium;

      if (typeof pbd.hard === 'number') state.pointsByDifficulty.hard = pbd.hard;
      else if (typeof progress.points_hard === 'number') state.pointsByDifficulty.hard = progress.points_hard;

      if (typeof progress.points === 'number') {
        state.points = progress.points;
      } else {
        state.points = (state.pointsByDifficulty.easy || 0) +
                       (state.pointsByDifficulty.medium || 0) +
                       (state.pointsByDifficulty.hard || 0);
      }
      if (Array.isArray(progress.solvedPuzzles)) {
        state.solvedPuzzles = progress.solvedPuzzles.map(Number);
      }
      if (Array.isArray(progress.purchasedHints)) {
        state.purchasedHints = progress.purchasedHints;
      }
      if (progress.progressByDifficulty && typeof progress.progressByDifficulty === 'object') {
        state.progressByDifficulty = _normalizeProgress(progress.progressByDifficulty);
      }
      saveState();
    },
    logout: () => {
      state.isLoggedIn = false;
      state.player = null;
      state.points = 0;
      state.pointsByDifficulty = { easy: 0, medium: 0, hard: 0 };
      state.progressByDifficulty = _normalizeProgress(null);
      state.solvedPuzzles = [];
      state.purchasedHints = [];
      saveState();
      try {
        localStorage.removeItem('wonderhack_active_session_v1');
      } catch (e) {}
    },
    getPoints: (difficulty) => {
      const diff = _normalizeDifficulty(difficulty || (typeof WonderUI !== 'undefined' ? WonderUI.getCurrentChamberDifficulty() : null));
      if (diff && state.pointsByDifficulty && typeof state.pointsByDifficulty[diff] === 'number') {
        return state.pointsByDifficulty[diff];
      }
      return state.points;
    },
    getPointsByDifficulty: () => ({
      easy: (state.pointsByDifficulty && state.pointsByDifficulty.easy) || 0,
      medium: (state.pointsByDifficulty && state.pointsByDifficulty.medium) || 0,
      hard: (state.pointsByDifficulty && state.pointsByDifficulty.hard) || 0,
    }),
    getProgressByDifficulty: () => _normalizeProgress(state.progressByDifficulty),
    isDemoMode: () => purchaseHintDemoAllowed(),
    prefersReducedMotion: () => {
      if (typeof window === 'undefined' || !window.matchMedia) return false;
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e) {
        return false;
      }
    },
    addPoints: (amount, difficulty) => {
      const diff = _normalizeDifficulty(difficulty || (typeof WonderUI !== 'undefined' ? WonderUI.getCurrentChamberDifficulty() : null));
      if (!state.pointsByDifficulty) {
        state.pointsByDifficulty = { easy: 0, medium: 0, hard: 0 };
      }
      if (diff && diff in state.pointsByDifficulty) {
        state.pointsByDifficulty[diff] += amount;
      }
      state.points = (state.pointsByDifficulty.easy || 0) +
                     (state.pointsByDifficulty.medium || 0) +
                     (state.pointsByDifficulty.hard || 0);
      saveState();
      WonderAudio.playChime();
      const diffTag = diff ? ` [${diff.toUpperCase()}]` : '';
      WonderUI.showToast(`+${amount} Gold Sovereigns Awarded${diffTag}!`, 'gold');
      // Persist to server (debounced)
      if (typeof WonderSession !== 'undefined') WonderSession.saveProgress();
    },
    spendPoints: (amount, difficulty) => {
      const diff = _normalizeDifficulty(difficulty || (typeof WonderUI !== 'undefined' ? WonderUI.getCurrentChamberDifficulty() : null));
      if (!state.pointsByDifficulty) {
        state.pointsByDifficulty = { easy: 0, medium: 0, hard: 0 };
      }
      const available = (diff && diff in state.pointsByDifficulty)
        ? state.pointsByDifficulty[diff]
        : state.points;
      if (available < amount) {
        WonderAudio.playGong();
        const diffTag = diff ? `${diff.toUpperCase()} ` : '';
        WonderUI.showToast(`Not enough ${diffTag}Gold Sovereigns! The Mad Hatter chuckles.`, 'crimson');
        return false;
      }
      if (diff && diff in state.pointsByDifficulty) {
        state.pointsByDifficulty[diff] -= amount;
      }
      state.points = (state.pointsByDifficulty.easy || 0) +
                     (state.pointsByDifficulty.medium || 0) +
                     (state.pointsByDifficulty.hard || 0);
      saveState();
      WonderAudio.playCoin();
      return true;
    },
    isSolved: (puzzleId) => state.solvedPuzzles.includes(puzzleId),
    markSolved: (puzzleId) => {
      if (!state.solvedPuzzles.includes(puzzleId)) {
        state.solvedPuzzles.push(puzzleId);
        saveState();
        // Persist to server (debounced)
        if (typeof WonderSession !== 'undefined') WonderSession.saveProgress();
      }
    },
    isHintPurchased: (hintId) => state.purchasedHints.includes(hintId),
    purchaseHint: (hintId, cost, difficulty) => {
      if (state.purchasedHints.includes(hintId)) return true;
      // Local coin math is only a demo/offline aid. Without an explicit opt-in
      // the server remains the only authority allowed to grant a purchase.
      if (!purchaseHintDemoAllowed()) {
        if (typeof WonderUI !== 'undefined') {
          WonderUI.showToast('Please sign in to purchase hints from the royal registry.', 'crimson');
        }
        return false;
      }
      let diff = _normalizeDifficulty(difficulty);
      if (!diff && typeof hintId === 'string') {
        const parts = hintId.split('-');
        if (parts.length >= 2) {
          const pid = parseInt(parts[1], 10);
          if (pid >= 200) diff = 'hard';
          else if (pid >= 100) diff = 'medium';
          else if (pid > 0) diff = 'easy';
        }
      }
      if (!diff && typeof WonderUI !== 'undefined') {
        diff = WonderUI.getCurrentChamberDifficulty();
      }
      if (!state.pointsByDifficulty) {
        state.pointsByDifficulty = { easy: 0, medium: 0, hard: 0 };
      }
      const available = (diff && diff in state.pointsByDifficulty)
        ? state.pointsByDifficulty[diff]
        : state.points;

      if (available < cost) {
        WonderAudio.playGong();
        const diffTag = diff ? `${diff.toUpperCase()} ` : '';
        WonderUI.showToast(`Alas! You need more ${diffTag}Gold to purchase this secret!`, 'crimson');
        return false;
      }
      if (diff && diff in state.pointsByDifficulty) {
        state.pointsByDifficulty[diff] -= cost;
      }
      state.points = (state.pointsByDifficulty.easy || 0) +
                     (state.pointsByDifficulty.medium || 0) +
                     (state.pointsByDifficulty.hard || 0);
      state.purchasedHints.push(hintId);
      saveState();
      WonderAudio.playCoin();
      const diffTag = diff ? ` [${diff.toUpperCase()}]` : '';
      WonderUI.showToast(`Hint unlocked! -${cost} Sovereigns${diffTag}`, 'gold');
      // Persist to server (debounced)
      if (typeof WonderSession !== 'undefined') WonderSession.saveProgress();
      return true;
    },
    setPlayerProfile: (profileData) => {
      if (!state.player) {
        state.player = { username: 'Court Visitor', character: 'alice' };
      }
      state.player = { ...state.player, ...profileData };
      saveState();
    },
    toggleAudio: () => {
      state.audioEnabled = !state.audioEnabled;
      saveState();
      return state.audioEnabled;
    },
    isAudioEnabled: () => state.audioEnabled,
    resetProgress: () => {
      state = { ...defaultState };
      saveState();
      location.reload();
    },
    subscribe
  };
})();

/**
 * Web Audio API Victorian Sound Effects Synthesizer
 * Zero external audio file dependencies; synthesizes atmospheric clockwork clicks,
 * gold coin clinks, and gothic bells.
 */
const WonderAudio = (() => {
  let ctx = null;

  function getAudioContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) ctx = new AudioCtx();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  function shouldPlay() {
    // Sound effects are controlled by the audio toggle alone. Reduced-motion
    // preferences govern animation, not audio, so they must not mute feedback
    // such as the cat's meow or the Hatter's giggle.
    return WonderState.isAudioEnabled();
  }

  return {
    playClick: () => {
      if (!shouldPlay()) return;
      try {
        const c = getAudioContext();
        if (!c) return;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(420, c.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, c.currentTime + 0.04);
        gain.gain.setValueAtTime(0.15, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.04);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + 0.05);
      } catch (e) {}
    },

    playCoin: () => {
      if (!shouldPlay()) return;
      try {
        const c = getAudioContext();
        if (!c) return;
        // Two high harmonic resonant pings
        [987.77, 1318.51].forEach((freq, idx) => {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, c.currentTime + idx * 0.06);
          gain.gain.setValueAtTime(0.2, c.currentTime + idx * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + idx * 0.06 + 0.35);
          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(c.currentTime + idx * 0.06);
          osc.stop(c.currentTime + idx * 0.06 + 0.36);
        });
      } catch (e) {}
    },

    playChime: () => {
      if (!shouldPlay()) return;
      try {
        const c = getAudioContext();
        if (!c) return;
        // Victorian grandfather clock chime chord: E5, G#5, B5, E6
        [659.25, 830.61, 987.77, 1318.51].forEach((freq, idx) => {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = 'sine';
          const start = c.currentTime + idx * 0.08;
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.18, start);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(start);
          osc.stop(start + 0.95);
        });
      } catch (e) {}
    },

    playGong: () => {
      if (!shouldPlay()) return;
      try {
        const c = getAudioContext();
        if (!c) return;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, c.currentTime);
        osc.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.5);
        gain.gain.setValueAtTime(0.22, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + 0.65);
      } catch (e) {}
    },

    // The Queen's fury: a low, detuned roar that falls away like a slammed door.
    playQueenAngry: () => {
      if (!shouldPlay()) return;
      try {
        const c = getAudioContext();
        if (!c) return;
        const now = c.currentTime;
        const gain = c.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.24, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
        gain.connect(c.destination);

        const low = c.createOscillator();
        low.type = 'sawtooth';
        low.frequency.setValueAtTime(180, now);
        low.frequency.exponentialRampToValueAtTime(55, now + 0.7);
        low.connect(gain);

        const growl = c.createOscillator();
        growl.type = 'square';
        growl.frequency.setValueAtTime(95, now);
        growl.frequency.exponentialRampToValueAtTime(40, now + 0.7);
        const growlGain = c.createGain();
        growlGain.gain.value = 0.35;
        growl.connect(growlGain);
        growlGain.connect(gain);

        // A quick tremolo makes the roar feel like a furious shout.
        const lfo = c.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 14;
        const lfoGain = c.createGain();
        lfoGain.gain.value = 18;
        lfo.connect(lfoGain);
        lfoGain.connect(low.frequency);

        low.start(now);
        growl.start(now);
        lfo.start(now);
        low.stop(now + 0.78);
        growl.stop(now + 0.78);
        lfo.stop(now + 0.78);
      } catch (e) {}
    },

    // The Cheshire Cat: a curious little meow that rises, wavers, then falls.
    playCatMeow: () => {
      if (!shouldPlay()) return;
      try {
        const c = getAudioContext();
        if (!c) return;
        const now = c.currentTime;
        const gain = c.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.16, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        gain.connect(c.destination);

        const meow = c.createOscillator();
        meow.type = 'triangle';
        meow.frequency.setValueAtTime(480, now);
        meow.frequency.linearRampToValueAtTime(880, now + 0.14);
        meow.frequency.exponentialRampToValueAtTime(430, now + 0.48);
        meow.connect(gain);

        // Purr-like vibrato.
        const purr = c.createOscillator();
        purr.type = 'sine';
        purr.frequency.value = 22;
        const purrGain = c.createGain();
        purrGain.gain.value = 55;
        purr.connect(purrGain);
        purrGain.connect(meow.frequency);

        meow.start(now);
        purr.start(now);
        meow.stop(now + 0.52);
        purr.stop(now + 0.52);
      } catch (e) {}
    },

    // The Mad Hatter: three wheezing, tea-soaked "ha!" notes.
    playHatterLaugh: () => {
      if (!shouldPlay()) return;
      try {
        const c = getAudioContext();
        if (!c) return;
        const now = c.currentTime;
        [392, 349.23, 293.66, 261.63].forEach((freq, index) => {
          const start = now + index * 0.13;
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = index % 2 === 0 ? 'triangle' : 'square';
          osc.frequency.setValueAtTime(freq, start);
          osc.frequency.exponentialRampToValueAtTime(freq * 0.72, start + 0.11);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(start);
          osc.stop(start + 0.13);
        });
      } catch (e) {}
    }
  };
})();

/**
 * UI Renderer and Shared Components
 */
const WonderUI = (() => {
  const DIFFICULTY_STORAGE_KEY = 'wonderhack_last_difficulty';
  let headerSubscribed = false;
  let lastHeaderArgs = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  // Figure out which difficulty chamber the player is actively inside right now
  function getCurrentChamberDifficulty() {
    const fromPath = window.location.pathname.match(/\/challenges\/(easy|medium|hard)(?:\/|$)/i);
    const fromQuery = new URLSearchParams(window.location.search).get('from') || new URLSearchParams(window.location.search).get('difficulty');
    const cand = [fromPath && fromPath[1], fromQuery]
      .filter(Boolean)
      .map(v => v.toLowerCase())
      .find(v => ['easy', 'medium', 'hard'].includes(v));
    return cand || null;
  }

  // Figure out which difficulty chamber the player is currently in (or last visited).
  function getActiveDifficulty() {
    const fromPath = window.location.pathname.match(/\/challenges\/(easy|medium|hard)(?:\/|$)/i);
    const fromQuery = new URLSearchParams(window.location.search).get('from') || new URLSearchParams(window.location.search).get('difficulty');
    let stored = null;
    try {
      stored = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    } catch (e) {}

    const candidates = [fromPath && fromPath[1], fromQuery, stored];
    const difficulty = candidates
      .filter(Boolean)
      .map(value => value.toLowerCase())
      .find(value => ['easy', 'medium', 'hard'].includes(value));

    if (difficulty) {
      try {
        localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty);
      } catch (e) {}
    }
    return difficulty || null;
  }

  // Mount or update the shared top navigation bar
  function initHeader(activePage = '', customBasePath = null, options = {}) {
    lastHeaderArgs = [activePage, customBasePath, options];
    const headerContainer = document.getElementById('wonder-header-mount');
    if (!headerContainer) return;

    const basePath = customBasePath !== null 
      ? customBasePath 
      : (document.body.dataset.basePath || '');

    // Non-game pages (landing, difficulty hub, login gate) never show the account widget.
    // Auto-detected via body class / pathname so it works even if the HTML is cached.
    const isLandingPage = document.body.classList.contains('menu-body');
    const isDifficultyHub = document.body.classList.contains('difficulty-hub-body')
      || /\/puzzles\.html$/i.test(window.location.pathname);
    const isLoginGate = /\/login\.html$/i.test(window.location.pathname);
    const hideAccount = options.hideAccount === true
      || (options.hideAccount !== false && (isLandingPage || isDifficultyHub || isLoginGate));

    const state = WonderState.getState();
    const isLoggedIn = WonderState.isLoggedIn();
    const player = state.player;
    const hatIconSrc = `${basePath}assets/images/ui/hatter-hat.png`;

    // Privileged navigation: the leaderboard is for the administrator only and
    // the answer scroll is for The Heart's Queen only.
    const isAdmin = !!(isLoggedIn && player && (
      player.isAdmin === true
      || (player.username || '').toLowerCase() === 'admin'
      || /administrator/i.test(player.role || '')
    ));
    const isQueen = !!(isLoggedIn && player && (
      player.isQueen === true
      || (player.username || '').toLowerCase() === 'hearts_queen'
    ));

    const leaderboardNav = isAdmin ? `
          <li class="nav-item ${activePage === 'leaderboard' ? 'active' : ''}">
            <a href="${basePath}leaderboard.html" title="Royal Court Leaderboard (Administrator only)">
              <span>🏆</span> Leaderboard
            </a>
          </li>` : '';

    const adminNav = isAdmin ? `
          <li class="nav-item ${activePage === 'admin' ? 'active' : ''}">
            <a href="${basePath}admin.html" title="Court Administrator Monitoring (Administrator only)">
              <span>🛡️</span> Admin
            </a>
          </li>` : '';

    // The Queen's Castle button has been removed from the top bar. Only the
    // administrator keeps links (leaderboard + monitoring); the Queen has none.
    const navItemsHtml = `${leaderboardNav}${adminNav}`;
    const navLinksHtml = (isQueen || !navItemsHtml.trim()) ? '' : `
        <ul class="nav-links">${navItemsHtml}
        </ul>`;

    const brandHref = isQueen ? `${basePath}royal-answers.html` : `${basePath}index.html`;

    let userWidgetHtml = '';
    let pointsChipHtml = '';

    if (hideAccount) {
      // Show only the WonderHack branding and navigation — no logged-in account.
      userWidgetHtml = '';
      pointsChipHtml = '';
    } else if (isLoggedIn && player && isQueen) {
      // Minimal sovereign header: identity and logout only.
      userWidgetHtml = `
        <div style="display:flex; align-items:center; gap: 0.6rem;">
          <span class="nav-player-name" title="Sovereign of the Rose Court">♛ ${escapeHtml(player.username)}</span>
          <button type="button" class="nav-logout-btn" id="nav-logout-trigger" title="Log out of the Queen's account">
            Log out
          </button>
        </div>
      `;
    } else if (isLoggedIn && player) {
      const isAlice = player.character === 'alice';
      const safeName = escapeHtml(player.username);
      const avatarSrc = (isAdmin || (player.character || '').toLowerCase() === 'admin')
        ? `${basePath}assets/images/characters/admin.png`
        : (isAlice 
          ? `${basePath}assets/images/characters/alice.png` 
          : `${basePath}assets/images/characters/queen.png`);

      const chamberDiff = getCurrentChamberDifficulty();
      let displayedPoints = state.points;
      let diffBadge = '';
      let chipTitle = 'Current Balance of Gold Sovereigns';

      if (chamberDiff && ['easy', 'medium', 'hard'].includes(chamberDiff)) {
        const diffCap = chamberDiff.charAt(0).toUpperCase() + chamberDiff.slice(1);
        displayedPoints = (state.pointsByDifficulty && typeof state.pointsByDifficulty[chamberDiff] === 'number')
          ? state.pointsByDifficulty[chamberDiff]
          : 0;
        diffBadge = `<span class="nav-points-diff-label" style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-right:4px; color:var(--color-gold-bright); letter-spacing:0.5px;">${diffCap}:</span>`;
        chipTitle = `${diffCap} Chamber Sovereigns (${displayedPoints} 🪙)`;
      } else if (state.pointsByDifficulty) {
        const pbd = state.pointsByDifficulty;
        chipTitle = `Gold Sovereigns: Total ${state.points} (Easy: ${pbd.easy || 0}, Medium: ${pbd.medium || 0}, Hard: ${pbd.hard || 0})`;
      }

      pointsChipHtml = `
        <div class="nav-points-chip" title="${chipTitle}">
          <svg class="coin-icon" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/>
            <text x="12" y="16" font-family="'Cinzel', serif" font-size="11" font-weight="bold" fill="currentColor" text-anchor="middle">S</text>
          </svg>
          ${diffBadge}
          <span id="nav-points-val">${displayedPoints}</span>
        </div>
      `;

      userWidgetHtml = `
        <div style="display:flex; align-items:center; gap: 0.6rem;">
          <a href="${basePath}profile.html" class="nav-profile ${activePage === 'profile' ? 'active' : ''}" title="Player Dossier (${safeName}) — Inspect royal achievements">
            <div class="nav-avatar-cameo">
              <img id="nav-avatar-img" src="${avatarSrc}" alt="${safeName} Dossier Portrait">
            </div>
            <div class="nav-player-details">
              <span class="nav-player-name" id="nav-player-name">${safeName}</span>
              <span class="nav-player-email" id="nav-player-email">📜 Player Dossier</span>
            </div>
          </a>
          <button type="button" class="nav-logout-btn" id="nav-logout-trigger" title="Log out of court session">
            Log out
          </button>
        </div>
      `;
    } else {
      // User is NOT logged in: Clicking the account icon opens the Player Dossier / Login
      userWidgetHtml = `
        <a href="${basePath}profile.html" class="nav-profile ${activePage === 'profile' ? 'active' : ''}" title="Player Dossier — Authenticate to view">
          <div class="nav-avatar-cameo" style="background: radial-gradient(circle, #2b1828 0%, #150a18 100%);">
            <span style="font-size: 1.25rem;">📜</span>
          </div>
          <div class="nav-player-details">
            <span class="nav-player-name">Player Dossier</span>
            <span class="nav-player-email">Court Login</span>
          </div>
        </a>
      `;
    }

    headerContainer.innerHTML = `
      <nav class="wonder-header" aria-label="Wonderland Main Navigation">
        <!-- Brand Crest -->
        <a href="${brandHref}" class="nav-brand" title="${isQueen ? "The Queen's Answer Scroll" : 'Return to Storybook Entrance'}">
          <div class="brand-crest">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </div>
          <div>
            <span class="brand-title">WONDERHACK</span>
            <span class="brand-subtitle">${isQueen ? "The Sovereign's Answer Scroll" : "The Queen's Cipher Realm"}</span>
          </div>
        </a>

        <!-- Navigation Links (the Queen has none: no castle, no puzzles) -->
        ${navLinksHtml}

        <!-- Points HUD, Profile Cameo & Controls -->
        <div style="display:flex; align-items:center; gap: 0.85rem;">
          ${pointsChipHtml}
          ${userWidgetHtml}

          <!-- Audio Toggle (hidden for the Queen's minimal account view) -->
          ${isQueen ? '' : `
          <button class="nav-audio-toggle" id="audio-toggle-btn" aria-label="Toggle Sound Effects" title="Toggle Sound">
            <span id="audio-icon">${state.audioEnabled ? '🔔' : '🔕'}</span>
          </button>`}
        </div>
      </nav>
    `;

    // Hook audio toggle
    const audioBtn = document.getElementById('audio-toggle-btn');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        const enabled = WonderState.toggleAudio();
        document.getElementById('audio-icon').textContent = enabled ? '🔔' : '🔕';
        if (enabled) WonderAudio.playClick();
      });
    }

    // Hook logout button
    const logoutBtn = document.getElementById('nav-logout-trigger');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        logoutBtn.disabled = true;

        // Remember the chamber the player is in so we can return them to its login gate.
        const difficulty = getActiveDifficulty();

        // Destroy the real server-side session (and its HttpOnly cookie) first.
        if (typeof WonderSession !== 'undefined' && WonderSession.logout) {
          try {
            await WonderSession.logout();
          } catch (err) {
            WonderState.logout();
          }
        } else {
          WonderState.logout();
        }

        WonderUI.showToast('Logged out of court registry.', 'crimson');
        const destination = isQueen
          ? `${basePath}login.html?difficulty=easy`
          : (difficulty
            ? `${basePath}login.html?difficulty=${difficulty}`
            : `${basePath}puzzles.html`);
        setTimeout(() => {
          window.location.href = destination;
        }, 350);
      });
    }

    // Subscribe to state changes to keep the HUD updated. Subscribe only once;
    // otherwise every re-render would register another listener.
    if (!headerSubscribed) {
      headerSubscribed = true;
      WonderState.subscribe(() => {
        if (lastHeaderArgs) initHeader(...lastHeaderArgs);
      });
    }
  }

  // Toast Notification System
  function showToast(message, type = 'gold') {
    let container = document.querySelector('.wonder-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'wonder-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `wonder-toast ${type}`;
    const icon = type === 'crimson' ? '⚠️' : '✨';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 320);
    }, 3800);
  }

  return {
    initHeader,
    showToast,
    getActiveDifficulty,
    getCurrentChamberDifficulty
  };
})();

// Attach to window for global access
if (typeof window !== 'undefined') {
  window.WonderState = WonderState;
  window.WonderAudio = WonderAudio;
  window.WonderUI = WonderUI;
}

// Document Ready Bootstrap
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', async () => {
    // ── Session boot: try to restore server session via cookie ──────────────
    // WonderSession is loaded via session.js on pages that need it.
    // For pages that don't load session.js, skip gracefully.
    if (typeof WonderSession !== 'undefined') {
      try {
        await WonderSession.boot();
      } catch (e) {
        // Server offline or session.js not loaded — keep local state
      }
    }

    // The Queen does not play the puzzles. Keep her on the answer scroll.
    if (typeof WonderSession !== 'undefined' && WonderSession.isQueen()) {
      const path = window.location.pathname;
      const onAnswerScroll = /\/royal-answers\.html$/i.test(path);
      const onLoginGate = /\/login\.html$/i.test(path);
      if (!onAnswerScroll && !onLoginGate) {
        const basePath = document.body.dataset.basePath || '';
        window.location.replace(`${basePath}royal-answers.html`);
        return;
      }
    }

    // Global click listener for Cheshire Cat -> Navigate to Cipher Lab.
    // The cat is only clickable in the Easy Chamber after every Easy hint has
    // been purchased. Everywhere else it vanishes and this listener does nothing.
    document.addEventListener('click', async (e) => {
      const catTrigger = e.target.closest && (
        e.target.closest('img[src*="cheshire-cat.png"]') ||
        e.target.closest('.cat-cipher-trigger')
      );
      if (catTrigger) {
        // Every poke at the cat earns a meow, even while it is still asleep.
        if (typeof WonderAudio !== 'undefined') {
          if (WonderAudio.playCatMeow) WonderAudio.playCatMeow();
          else if (WonderAudio.playClick) WonderAudio.playClick();
        }

        const unlocked = typeof WonderCharacters !== 'undefined'
          && typeof WonderCharacters.isCheshireUnlocked === 'function'
          && WonderCharacters.isCheshireUnlocked();
        if (!unlocked) return;

        const isAlreadyInLab = /challenge(\.html)?$/i.test(window.location.pathname);
        if (!isAlreadyInLab) {
          e.preventDefault();

          // The cat is visible after every Easy hint, but the Cipher Lab is a
          // private party: his 200-Sovereign pass must be paid first.
          let hasPass = typeof WonderCharacters.hasCheshirePass === 'function'
            && WonderCharacters.hasCheshirePass();
          if (!hasPass && typeof WonderCharacters.requestCheshirePass === 'function') {
            hasPass = await WonderCharacters.requestCheshirePass();
          }
          if (!hasPass) return;

          const basePath = document.body.dataset.basePath || '';
          const diff = (typeof WonderUI !== 'undefined' && typeof WonderUI.getActiveDifficulty === 'function')
            ? WonderUI.getActiveDifficulty()
            : null;
          const suffix = diff ? `?from=${encodeURIComponent(diff)}` : '';
          window.location.href = `${basePath}challenge.html${suffix}`;
          return;
        }
      }

      // Global click audio listener on interactive buttons. Character sprites
      // play their own voice in characters.js, so they are excluded here.
      const btn = e.target.closest && e.target.closest('button, .btn-victorian, .nav-item a');
      if (btn) WonderAudio.playClick();
    });
  });
}
