/**
 * WONDERHACK — Puzzle Room Engine v2
 * Handles the full puzzle UI lifecycle for all difficulty chambers:
 *   • Sequential puzzle flow (cannot skip unsolved puzzles)
 *   • Rabbit hint speech bubble + accumulated hint log below the input
 *   • Answer evaluation and progress persistence via WonderState
 */

const WonderPuzzleEngine = (() => {
  let cfg = null;        // room configuration
  let currentIdx = 0;   // which puzzle is active

  /* -----------------------------------------------------------------------
   * PUBLIC: init(config)
   * config = { difficulty, chamberTitle, puzzles[] }
   * --------------------------------------------------------------------- */
  async function init(roomConfig) {
    cfg = {
      difficulty: 'Easy',
      chamberTitle: 'Easy Chamber',
      puzzles: [],
      ...roomConfig
    };

    // Make sure the cookie session (and saved solved list) is restored before
    // deciding which puzzle to open. boot() is cached, so this is cheap.
    if (typeof WonderSession !== 'undefined') {
      try { await WonderSession.boot(); } catch (e) {}
    }

    // Every coin must be saved to an account. If the registry is online but
    // this visitor has no live session cookie, send them to the login gate.
    if (typeof WonderSession !== 'undefined'
        && WonderSession.isServerAvailable()
        && !WonderSession.isAuthenticated()) {
      const basePath = document.body.dataset.basePath || '';
      const diff = (cfg.difficulty || 'Easy').toLowerCase();
      window.location.replace(`${basePath}login.html?difficulty=${diff}`);
      return;
    }

    try {
      const diff = (cfg.difficulty || 'easy').toLowerCase();
      localStorage.setItem('wh_last_puzzle_url', window.location.href);
      localStorage.setItem('wh_last_difficulty', diff);
      localStorage.setItem('wh_active_chamber', `challenges/${diff}/index.html`);
    } catch (e) {}

    // Tell the backend which chamber is active so the Queen's answer scroll
    // shows the flag for this difficulty.
    if (typeof WonderSession !== 'undefined' && WonderSession.selectDifficulty) {
      try { await WonderSession.selectDifficulty((cfg.difficulty || 'easy').toLowerCase()); } catch (e) {}
    }

    currentIdx = _firstUnsolvedIndex();
    _renderTabs();
    _loadPuzzle(currentIdx);
    _bindInteractions();
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: determine the first unsolved puzzle index
   * --------------------------------------------------------------------- */
  function _firstUnsolvedIndex() {
    if (!cfg || !cfg.puzzles.length) return 0;
    for (let i = 0; i < cfg.puzzles.length; i++) {
      if (!WonderState.isSolved(cfg.puzzles[i].id)) return i;
    }
    // All solved — show last puzzle (read-only)
    return cfg.puzzles.length - 1;
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: render the tab bar
   * --------------------------------------------------------------------- */
  function _renderTabs() {
    const bar = document.getElementById('puzzle-tabs');
    if (!bar || !cfg) return;

    // Determine which puzzles are unlocked (all previous must be solved)
    bar.innerHTML = cfg.puzzles.map((p, idx) => {
      const isSealed   = !!p.queenCorrupted;
      const isSolved   = !isSealed && WonderState.isSolved(p.id);
      const isActive   = idx === currentIdx;
      const isUnlocked = idx === 0 || WonderState.isSolved(cfg.puzzles[idx - 1].id);
      const isLocked   = !isUnlocked && !isSolved;

      let cls = 'puzzle-tab-btn';
      if (isActive)   cls += ' active';
      if (isSolved)   cls += ' solved';
      if (isLocked)   cls += ' locked';

      return `
        <button type="button"
                class="${cls}"
                data-idx="${idx}"
                ${isLocked ? 'disabled aria-disabled="true"' : ''}
                title="${isLocked ? 'Solve the previous puzzle to unlock' : (isSealed ? `${p.title} — sealed by the Queen` : `Puzzle ${p.number}: ${p.title}`)}">
          <span>${isLocked ? '🔒' : (isSealed ? '👑' : (isSolved ? '✓' : '♠'))}</span>
          ${p.number}
        </button>
      `;
    }).join('');

    bar.querySelectorAll('.puzzle-tab-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        // Extra guard: cannot navigate to locked puzzle
        if (idx > 0 && !WonderState.isSolved(cfg.puzzles[idx - 1].id)) return;
        _loadPuzzle(idx);
      });
    });
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: render the parchment for puzzle at idx
   * --------------------------------------------------------------------- */
  function _loadPuzzle(idx) {
    if (!cfg || !cfg.puzzles.length) return;
    if (idx < 0 || idx >= cfg.puzzles.length) return;

    // Enforce sequential lock
    if (idx > 0 && !WonderState.isSolved(cfg.puzzles[idx - 1].id)) {
      WonderUI.showToast('Solve the current puzzle first!', 'crimson');
      return;
    }

    currentIdx = idx;
    const p = cfg.puzzles[idx];
    // A sealed final trial always renders as corrupted, even if an older
    // account somehow recorded a solve for it before the seal was added.
    const isSolved = !p.queenCorrupted && WonderState.isSolved(p.id);

    // --- Parchment header ---
    _setText('puzzle-number-badge', p.number);
    _setText('puzzle-difficulty-tag', `${p.difficulty} · ${p.category}`);
    _setText('puzzle-title', p.title);
    const diffTag = p.difficulty ? ` ${p.difficulty}` : '';
    _setText('puzzle-reward-pts', `+${p.points}${diffTag} Sovereigns`);

    // --- Question ---
    const qEl = document.getElementById('puzzle-question-text');
    if (qEl) {
      if (p.queenCorrupted) {
        // Replace the readable question with Queen-corrupted glitch text
        const corruptedText = _corruptText(p.question);
        qEl.innerHTML = `
          <div class="corruption-banner">
            <span class="corruption-banner-icon">👑</span>
            <span class="corruption-banner-text">
              THE QUEEN HAS CORRUPTED THIS RIDDLE — NORMAL READING IS IMPOSSIBLE
            </span>
          </div>
          <span class="queen-corrupted-question" data-glitch="${corruptedText}">${corruptedText}</span>
        `;
        // The corruption arrives with its own screech.
        if (typeof WonderAudio !== 'undefined' && WonderAudio.playQueenGlitch) {
          WonderAudio.playQueenGlitch();
        }
      } else {
        qEl.textContent = p.question;
      }
    }

    // --- Answer input + submit ---
    const input     = document.getElementById('puzzle-answer-input');
    const submitBtn = document.getElementById('submit-answer-btn');

    if (p.queenCorrupted) {
      // The Queen's final trial is permanently sealed. The input is disabled
      // and the server also refuses any direct POST /api/solve attempt.
      if (input)     { input.value = ''; input.placeholder = 'Sealed by the Queen'; input.disabled = true; }
      if (submitBtn) { submitBtn.textContent = '👑 Corrupted'; submitBtn.disabled = true; }
      _showFeedback('error',
        '\uD83D\uDD34 <span><strong>The Queen has corrupted this final trial!</strong> ' +
        'Her seal can never be broken — no answer will ever be accepted.</span>'
      );
    } else if (isSolved) {
      if (input)     { input.value = ''; input.placeholder = 'Solved ✓'; input.disabled = true; }
      if (submitBtn) { submitBtn.textContent = 'Solved ✓'; submitBtn.disabled = true; }
      _showFeedback('success', `👑 <strong>Already Solved!</strong> You have conquered this riddle.`);
    } else {
      if (input)     { input.value = ''; input.placeholder = 'Type your answer here…'; input.disabled = false; input.focus(); }
      if (submitBtn) { submitBtn.textContent = 'Propose Solution'; submitBtn.disabled = false; }
      _hideFeedback();
    }

    // --- Clear hint log when switching puzzles ---
    _clearHintLog();

    _renderTabs();

    // Random queen taunt on load (unsolved puzzles only)
    // For corrupted puzzles: auto-trigger the rabbit warning instead
    if (!isSolved) {
      if (p.queenCorrupted) {
        setTimeout(() => {
          if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerRabbitHint) {
            WonderCharacters.triggerRabbitHint(
              '"Oh dear, oh dear! The Queen has corrupted the final trial — ' +
              'no answer will ever break her seal!"'
            );
          }
        }, 700);
        // Also trigger the queen gloating
        setTimeout(() => {
          if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerQueenTaunt) {
            WonderCharacters.triggerQueenTaunt(
              '\u201cMUAHAHA! The final trial is MINE now! My corruption is permanent — ' +
              'no mortal, no hacker, no clever trick shall ever answer it!\u201d'
            );
          }
        }, 3500);
      } else if (Math.random() > 0.4) {
        setTimeout(() => {
          if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerQueenTaunt) {
            WonderCharacters.triggerQueenTaunt(p.queenTaunt);
          }
        }, 900);
      }
    }
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: bind all interactive elements
   * --------------------------------------------------------------------- */
  function _bindInteractions() {
    // Form submit
    const form = document.getElementById('puzzle-solution-form');
    if (form) form.onsubmit = e => { e.preventDefault(); _evaluateSubmission(); };
    // Rabbit sprite + hint button → show next hint in bubble AND log
    const rabbitSprite = document.getElementById('rabbit-sprite');
    const hintBtn      = document.getElementById('rabbit-hint-btn');
    const doHint = () => _revealNextHint();
    if (rabbitSprite) rabbitSprite.onclick = doHint;
    if (hintBtn)      hintBtn.onclick      = doHint;

    // Queen sprite → random taunt
    const queenSprite = document.getElementById('queen-sprite');
    if (queenSprite) {
      queenSprite.onclick = () => {
        const p = _current();
        if (p && typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerQueenTaunt) {
          WonderCharacters.triggerQueenTaunt(p.queenTaunt);
        }
      };
    }

    // Speech bubble close buttons
    document.querySelectorAll('.dialogue-close-btn').forEach(btn => {
      btn.onclick = e => {
        const bubble = e.target.closest('.dialogue-bubble');
        if (bubble && typeof WonderCharacters !== 'undefined') {
          WonderCharacters.hideBubble(bubble.id);
        } else if (bubble) {
          bubble.classList.remove('visible');
        }
      };
    });
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: hint reveal logic
   *   - tracks how many hints revealed per puzzle
   *   - shows in rabbit bubble
   *   - appends to the hint log below input
   * --------------------------------------------------------------------- */
  const _hintState = {}; // { puzzleId: nextHintIndex }

  function _revealNextHint() {
    const p = _current();
    if (!p || !p.rabbitHints || !p.rabbitHints.length) {
      if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerRabbitHint) {
        WonderCharacters.triggerRabbitHint('"Oh dear! I have no hints for this one — you must think harder!"');
      }
      return;
    }

    if (!_hintState[p.id]) _hintState[p.id] = 0;
    const hintIndex = _hintState[p.id];

    if (hintIndex >= p.rabbitHints.length) {
      // All hints shown — tell the player
      if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerRabbitHint) {
        WonderCharacters.triggerRabbitHint('"Oh my pocket watch! I have no more hints — you must figure the rest out yourself!"');
      }
      return;
    }

    const hint = p.rabbitHints[hintIndex];
    _hintState[p.id] = hintIndex + 1;

    // For corrupted puzzles, use a longer auto-hide so players can read the redirect message
    const autoHideMs = p.queenCorrupted ? 8000 : 4000;

    // 1) Show in rabbit speech bubble
    if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerRabbitHint) {
      // Temporarily patch showBubble duration for corrupted hints
      if (p.queenCorrupted) {
        WonderCharacters.triggerRabbitHintLong(`"${hint}"`);
      } else {
        WonderCharacters.triggerRabbitHint(`"${hint}"`);
      }
    }

    // 2) Append to hint log below input
    _appendHintToLog(hintIndex + 1, hint);
  }

  function _appendHintToLog(hintNumber, hintText) {
    let log = document.getElementById('hint-log');
    if (!log) return;

    // Make log visible if it was hidden
    log.style.display = 'block';

    const item = document.createElement('div');
    item.className = 'hint-log-item';
    item.innerHTML = `
      <span class="hint-log-number">🐇 Hint ${hintNumber}:</span>
      <span class="hint-log-text">${hintText}</span>
    `;
    // Animate in
    item.style.opacity = '0';
    item.style.transform = 'translateY(6px)';
    log.appendChild(item);
    requestAnimationFrame(() => {
      item.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
      item.style.opacity = '1';
      item.style.transform = 'translateY(0)';
    });
  }

  function _clearHintLog() {
    const log = document.getElementById('hint-log');
    if (log) { log.innerHTML = ''; log.style.display = 'none'; }
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: evaluate the current answer submission
   *   The answer is ALWAYS checked by the server. No accepted-answer list is
   *   shipped to the browser, so this function cannot be tricked by editing
   *   client-side state.
   * --------------------------------------------------------------------- */
  let _submitting = false;

  async function _evaluateSubmission() {
    if (!cfg || _submitting) return;
    const p     = _current();
    const input = document.getElementById('puzzle-answer-input');
    const val   = input ? input.value.trim() : '';
    if (!val) { if (input) input.focus(); return; }

    if (typeof WonderSession === 'undefined' || !WonderSession.solvePuzzle) {
      _showFeedback('error',
        '⚠️ <span><strong>The royal registry is unavailable.</strong> Answers can only be verified by the server.</span>'
      );
      return;
    }

    const submitBtn = document.getElementById('submit-answer-btn');
    const previousBtnText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.textContent = 'Verifying with the Court…'; submitBtn.disabled = true; }
    _submitting = true;

    let serverSave;
    try {
      serverSave = await WonderSession.solvePuzzle(p.id, val);
    } catch (err) {
      serverSave = { ok: false, error: err.message };
    }
    _submitting = false;

    if (!serverSave || !serverSave.ok) {
      if (submitBtn) { submitBtn.textContent = previousBtnText; submitBtn.disabled = false; }
      const message = serverSave && serverSave.notAuthenticated
        ? 'Your session has expired. Please log in again.'
        : (serverSave && serverSave.offline
            ? 'The royal registry is offline. This answer cannot be verified.'
            : (serverSave && serverSave.error) || 'Could not reach the royal registry.');
      _showFeedback('error', `⚠️ <span><strong>Not verified.</strong> ${message}</span>`);
      if (serverSave && serverSave.notAuthenticated) {
        setTimeout(() => {
          const basePath = document.body.dataset.basePath || '../../';
          window.location.href = `${basePath}login.html`;
        }, 1200);
      }
      if (input) input.select();
      return;
    }

    if (serverSave.correct === false) {
      if (submitBtn) { submitBtn.textContent = previousBtnText; submitBtn.disabled = false; }
      _showFeedback('error',
        '⚠️ <span><strong>The royal registry rejected that answer.</strong> Try again or consult the White Rabbit!</span>'
      );
      if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerQueenFailure) {
        WonderCharacters.triggerQueenFailure();
      }
      if (input) input.select();
      return;
    }

    const awarded = serverSave.awardedPoints || 0;
    const diffTag = p.difficulty ? ` ${p.difficulty}` : '';
    WonderAudio.playChime();
    if (serverSave.alreadySolved) {
      WonderUI.showToast('This enigma was already recorded — no extra coins.', 'gold');
    } else {
      WonderUI.showToast(`+${awarded}${diffTag} Gold Sovereigns saved to your account!`, 'gold');
    }

    const isLast = currentIdx >= cfg.puzzles.length - 1;
    const rewardLine = awarded > 0
      ? `You claimed <strong>${awarded}${diffTag} Gold Sovereigns</strong>!`
      : (serverSave && serverSave.alreadySolved
          ? 'The royal registry already held this conquest.'
          : 'The royal registry recorded this conquest.');

    _showFeedback('success', `
      🎉 <div>
        <strong>Splendid!</strong> ${rewardLine}
        ${!isLast
          ? `<button type="button" id="next-puzzle-btn" class="btn-victorian btn-gold"
               style="margin-left:1rem; padding:0.3rem 0.9rem; font-size:0.82rem;">
               Next Riddle →
             </button>`
          : `<a href="../../puzzles.html" class="btn-victorian btn-gold"
               style="margin-left:1rem; padding:0.3rem 0.9rem; font-size:0.82rem; text-decoration:none;">
               Chamber Conquered! Return to Hall →
             </a>`
        }
      </div>
    `);

    if (input) input.disabled = true;
    if (submitBtn) { submitBtn.textContent = 'Solved ✓'; submitBtn.disabled = true; }

    if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerQueenSuccess) {
      WonderCharacters.triggerQueenSuccess();
    }

    _renderTabs();

    const nextBtn = document.getElementById('next-puzzle-btn');
    if (nextBtn) {
      nextBtn.onclick = () => _loadPuzzle(currentIdx + 1);
    }
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: feedback banner helpers
   * --------------------------------------------------------------------- */
  function _showFeedback(type, html) {
    const fb = document.getElementById('puzzle-feedback');
    if (!fb) return;
    fb.className = `feedback-banner ${type} show`;
    fb.style.display = 'flex';
    fb.innerHTML = html;
  }

  function _hideFeedback() {
    const fb = document.getElementById('puzzle-feedback');
    if (!fb) return;
    fb.className = 'feedback-banner';
    fb.style.display = 'none';
    fb.innerHTML = '';
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: small helpers
   * --------------------------------------------------------------------- */
  function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function _current() {
    return cfg && cfg.puzzles ? cfg.puzzles[currentIdx] : null;
  }

  /* -----------------------------------------------------------------------
   * PRIVATE: Queen corruption — scramble the question text so it is
   * visually unreadable, keeping roughly the same character count.
   * Uses a mix of look-alike Unicode glitch chars, zalgo-style combiners,
   * random symbol noise and reversed segments.
   * --------------------------------------------------------------------- */
  const _GLITCH_CHARS = [
    '̴','̵','̶','̷','̸','̡','̢','͜','͝','͞','͟','͠','͡',  // combining chars
    '̲','̳','̮','̯','̰','̱',                                // underline / below
    '▓','░','▒','█','▌','▐','▄','▀',                        // block elements
    '⣿','⠿','⣷','⡿','⢿',                                    // braille blocks
    '¿','¡','ß','Ø','Þ','ð','ƒ','Ψ','Φ','Ω','Σ','Δ','Λ',   // odd letters
    '$','#','@','%','&','*','!','?','~',                     // symbols
    '\u200b','\u200c','\u200d'                               // zero-width
  ];

  function _corruptText(original) {
    // Split into words; corrupt each word heavily
    return original.split('').map(ch => {
      if (ch === ' ') return Math.random() < 0.3 ? '\u00a0\u200b' : ' '; // occasional zero-width space
      const roll = Math.random();
      if (roll < 0.25) {
        // Replace character with a random glitch char
        return _GLITCH_CHARS[Math.floor(Math.random() * _GLITCH_CHARS.length)];
      } else if (roll < 0.50) {
        // Keep char but inject combiners after it
        const numCombine = Math.floor(Math.random() * 3) + 1;
        let out = ch;
        for (let i = 0; i < numCombine; i++) {
          // Pick a combining diacritic range (U+0300 – U+036F)
          out += String.fromCharCode(0x0300 + Math.floor(Math.random() * 0x70));
        }
        return out;
      } else if (roll < 0.70) {
        // Swap with a visually similar-ish symbol
        const pool = ['█','▓','▒','░','Ω','Σ','ƒ','⠿','?','#','@'];
        return pool[Math.floor(Math.random() * pool.length)];
      } else {
        // Keep original char (some chars survive for extra creepiness)
        return ch;
      }
    }).join('');
  }

  /* -----------------------------------------------------------------------
   * PUBLIC API
   * --------------------------------------------------------------------- */
  return {
    init,
    loadPuzzle: _loadPuzzle,
    getCurrentPuzzle: _current,
    renderTabs: _renderTabs
  };
})();
