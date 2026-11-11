/**
 * WONDERHACK — Queen's Castle Puzzle Registry & Grand Hall Controller
 * Central registry that aggregates challenges across Easy, Medium, and Hard difficulty levels.
 * Provides unified access for Cipher Lab, Mad Hatter Shop, Profile, and Castle Grand Hall.
 */

const WonderPuzzles = (() => {
  // The catalogue is fetched from the backend. No questions, hints or answers
  // are hard-coded in public JavaScript.
  let catalog = [];
  let loadPromise = null;

  const registeredDifficulties = {};

  function registerDifficulty(diffKey, puzzles) {
    registeredDifficulties[diffKey.toLowerCase()] = [...puzzles];
  }

  async function loadCatalog(force = false) {
    if (loadPromise && !force) return loadPromise;

    loadPromise = (async () => {
      const response = await fetch('/api/puzzles', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`The royal registry answered with HTTP ${response.status}.`);
      }
      const data = await response.json();
      catalog = Array.isArray(data.puzzles) ? data.puzzles : [];
      return catalog;
    })().catch((err) => {
      console.error('[WonderHack] Could not load the puzzle catalogue:', err);
      catalog = [];
      return catalog;
    });

    return loadPromise;
  }

  function _all() {
    if (catalog.length) return [...catalog];
    return Object.values(registeredDifficulties).flat();
  }

  function getEasyPuzzles() {
    return _all().filter(p => String(p.difficulty || '').toLowerCase() === 'easy');
  }

  function getMediumPuzzles() {
    return _all().filter(p => String(p.difficulty || '').toLowerCase() === 'medium');
  }

  function getHardPuzzles() {
    return _all().filter(p => String(p.difficulty || '').toLowerCase() === 'hard');
  }

  function getAllPuzzles() {
    return _all();
  }

  function getPuzzlesByDifficulty(diff) {
    const d = (diff || '').toLowerCase();
    if (d === 'easy') return getEasyPuzzles();
    if (d === 'medium') return getMediumPuzzles();
    if (d === 'hard') return getHardPuzzles();
    return getAllPuzzles();
  }

  function getDifficultyStats() {
    const easyPuzzles = getEasyPuzzles();
    const mediumPuzzles = getMediumPuzzles();
    const hardPuzzles = getHardPuzzles();

    const calcStats = (puzzles, diffKey) => {
      const total = puzzles.length;
      const solved = puzzles.filter(p => typeof WonderState !== 'undefined' && WonderState.isSolved(p.id)).length;
      const totalPoints = puzzles.reduce((sum, p) => sum + p.points, 0);
      const earnedPoints = (typeof WonderState !== 'undefined' && WonderState.getPointsByDifficulty)
        ? (WonderState.getPointsByDifficulty()[diffKey] || 0)
        : 0;
      return { total, solved, totalPoints, earnedPoints, isCompleted: solved === total && total > 0 };
    };

    return {
      easy: calcStats(easyPuzzles, 'easy'),
      medium: calcStats(mediumPuzzles, 'medium'),
      hard: calcStats(hardPuzzles, 'hard')
    };
  }

  /**
   * Initializes the Grand Hall Hub (puzzles.html)
   */
  async function initHub() {
    // Check for query redirect (e.g. puzzles.html?difficulty=easy) -> route to Login
    const urlParams = new URLSearchParams(window.location.search);
    const targetDiff = urlParams.get('difficulty');
    if (targetDiff && ['easy', 'medium', 'hard'].includes(targetDiff.toLowerCase())) {
      window.location.replace(`login.html?difficulty=${targetDiff.toLowerCase()}`);
      return;
    }

    await loadCatalog();
    renderHubChambers();
    bindHubCharacters();
  }

  function renderHubChambers() {
    const container = document.getElementById('chambers-grid-mount');
    if (!container) return;

    const chambers = [
      {
        diff: 'easy',
        title: 'Easy Chamber',
        icon: '🌿',
        cssClass: 'card-easy',
        badgeClass: 'badge-easy',
        description: 'Perfect for non-technical people and beginners. No prior hacking knowledge needed — just curiosity and a willingness to explore.',
        flavour: 'Step through the Garden Gate and learn the basics of web security in a friendly, guided environment.',
        url: 'login.html?difficulty=easy'
      },
      {
        diff: 'medium',
        title: 'Medium Chamber',
        icon: '⚔️',
        cssClass: 'card-medium',
        badgeClass: 'badge-medium',
        description: 'For those with some technical background or who have completed the Easy Chamber. Expect to think like an attacker.',
        flavour: 'Enter the Royal Court and face challenges that require a sharper eye and a bit of creative problem-solving.',
        url: 'login.html?difficulty=medium'
      },
      {
        diff: 'hard',
        title: 'Hard Chamber',
        icon: '👑',
        cssClass: 'card-hard',
        badgeClass: 'badge-hard',
        description: 'For experienced hackers and security enthusiasts. These challenges demand deep technical knowledge and persistence.',
        flavour: 'Dare to enter the Queen\'s Inner Sanctum — only the most skilled and tenacious hackers make it out alive.',
        url: 'login.html?difficulty=hard'
      }
    ];

    container.innerHTML = chambers.map(c => {
      const puzzles = getPuzzlesByDifficulty(c.diff);
      const localSolved = puzzles.filter(p => typeof WonderState !== 'undefined' && WonderState.isSolved(p.id)).length;
      let solvedCount = localSolved;
      let totalCount = puzzles.length;
      if (typeof WonderState !== 'undefined' && typeof WonderState.getProgressByDifficulty === 'function') {
        const serverProgress = WonderState.getProgressByDifficulty()[c.diff];
        if (serverProgress && Number(serverProgress.total) > 0) {
          totalCount = Math.max(totalCount, Number(serverProgress.total));
          solvedCount = Math.max(solvedCount, Number(serverProgress.solved) || 0);
        }
      }
      solvedCount = Math.min(solvedCount, totalCount);
      const maxCoins = puzzles.reduce((sum, p) => sum + (p.points || 0), 0);
      const earnedCoins = (typeof WonderState !== 'undefined' && WonderState.getPointsByDifficulty)
        ? (WonderState.getPointsByDifficulty()[c.diff] || 0)
        : 0;
      const isLoggedIn = typeof WonderState !== 'undefined' && WonderState.isLoggedIn();
      const statusText = isLoggedIn
        ? (solvedCount === totalCount && totalCount > 0 ? 'Conquered ✓' : (solvedCount > 0 ? `${solvedCount}/${totalCount} Solved` : 'Chamber Open'))
        : 'Requires Login';
      const percent = totalCount > 0 ? Math.round((solvedCount / totalCount) * 100) : 0;

      return `
      <article class="chamber-card ${c.cssClass}">
        <div class="chamber-header">
          <span class="chamber-icon">${c.icon}</span>
          <span class="chamber-badge ${c.badgeClass}">${c.diff.toUpperCase()}</span>
        </div>
        <h2 class="chamber-title">${c.title}</h2>

        <div style="margin: 1rem 0; background: rgba(212, 175, 55, 0.07); border: 1px solid rgba(197,155,39,0.3); border-radius: 6px; padding: 0.9rem 1rem;">
          <p style="font-family: var(--font-story); font-size: 0.95rem; color: #3a2810; margin: 0 0 0.6rem 0; font-weight: 600;">${c.description}</p>
          <p style="font-family: var(--font-story); font-size: 0.85rem; color: #6a5040; margin: 0; font-style: italic;">${c.flavour}</p>
        </div>

        <div class="chamber-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${totalCount}" aria-valuenow="${solvedCount}" aria-label="${c.title} progress">
          <div class="chamber-progress-meta">
            <span>Trials conquered</span>
            <span><strong>${solvedCount}</strong> / ${totalCount}</span>
          </div>
          <div class="progress-track"><div class="progress-fill progress-${c.diff}" style="width:${percent}%"></div></div>
        </div>

        <div class="chamber-meta-bar" style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-family: var(--font-story); font-size:0.85rem; color:#5a4032; font-weight:600;">
            🪙 <strong>${earnedCoins}</strong> / ${maxCoins} Sovereigns
          </span>
          <span class="chamber-status-pill">${statusText}</span>
        </div>

        <a href="${c.url}" class="btn-victorian btn-crimson chamber-action-btn" data-difficulty="${c.diff}">
          Enter ${c.title} ➔
        </a>
      </article>
    `}).join('');

    // Choosing a chamber immediately tells the backend which difficulty is
    // active. The Queen's answer scroll then shows that difficulty's flag.
    container.querySelectorAll('.chamber-action-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const difficulty = btn.dataset.difficulty;
        try {
          localStorage.setItem('wonderhack_last_difficulty', difficulty);
        } catch (err) {}
        if (typeof WonderSession !== 'undefined' && WonderSession.selectDifficulty) {
          try { await WonderSession.selectDifficulty(difficulty); } catch (err) {}
        }
        window.location.href = btn.getAttribute('href');
      });
    });
  }

  function bindHubCharacters() {
    const queenSprite = document.getElementById('queen-sprite');
    if (queenSprite) {
      queenSprite.onclick = () => {
        if (typeof WonderCharacters !== 'undefined') {
          WonderCharacters.triggerQueenTaunt("“Choose your trial wisely! The executioner waits behind every door!”");
        }
      };
    }

    const rabbitSprite = document.getElementById('rabbit-sprite');
    if (rabbitSprite) {
      rabbitSprite.onclick = () => {
        if (typeof WonderCharacters !== 'undefined') {
          WonderCharacters.triggerRabbitHint("“If you're just starting, enter the Easy Chamber at the Garden Gate!”");
        }
      };
    }

    document.querySelectorAll('.dialogue-close-btn').forEach(btn => {
      btn.onclick = (e) => {
        const bubble = e.target.closest('.dialogue-bubble');
        if (bubble && typeof WonderCharacters !== 'undefined') {
          WonderCharacters.hideBubble(bubble.id);
        } else if (bubble) {
          bubble.classList.remove('visible');
        }
      };
    });
  }

  return {
    registerDifficulty,
    loadCatalog,
    getAllPuzzles,
    getPuzzlesByDifficulty,
    getEasyPuzzles,
    getMediumPuzzles,
    getHardPuzzles,
    getDifficultyStats,
    initHub,
    init: initHub
  };
})();
