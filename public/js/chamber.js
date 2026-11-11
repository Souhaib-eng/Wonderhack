/**
 * WONDERHACK — Chamber Loader
 *
 * The questions, hints and flavour text are fetched from the backend
 * (`GET /api/puzzles?difficulty=...`). Accepted answers never leave the server:
 * every submission is checked by `POST /api/solve`.
 *
 * This file replaces the old per-difficulty challenge catalogues that used to
 * live in public/challenges/*.js.
 */

const WonderChamber = (() => {
  const CHAMBERS = {
    easy: {
      difficulty: 'Easy',
      title: 'Easy Chamber — The Garden Gate',
    },
    medium: {
      difficulty: 'Medium',
      title: 'Medium Chamber — The Royal Court',
    },
    hard: {
      difficulty: 'Hard',
      title: "Hard Chamber — The Queen's Inner Sanctum",
    },
  };

  function currentDifficulty() {
    const match = window.location.pathname.match(/\/challenges\/(easy|medium|hard)\//i);
    if (match) return match[1].toLowerCase();

    const params = new URLSearchParams(window.location.search);
    const fromQuery = (params.get('difficulty') || '').toLowerCase();
    if (CHAMBERS[fromQuery]) return fromQuery;

    return 'easy';
  }

  async function fetchPuzzles(difficulty) {
    const response = await fetch(`/api/puzzles?difficulty=${encodeURIComponent(difficulty)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`The royal registry answered with HTTP ${response.status}.`);
    }
    const data = await response.json();
    if (!data || data.success !== true || !Array.isArray(data.puzzles)) {
      throw new Error((data && data.error) || 'The royal registry returned no puzzles.');
    }
    return data.puzzles;
  }

  function showLoadError(message) {
    const title = document.getElementById('puzzle-title');
    if (title) title.textContent = 'The royal registry is silent…';
    const feedback = document.getElementById('puzzle-feedback');
    if (feedback) {
      feedback.className = 'feedback-banner error show';
      feedback.style.display = 'flex';
      feedback.innerHTML = `<span>⚠️</span> <span>${message}</span>`;
    }
  }

  async function init() {
    const difficulty = currentDifficulty();
    const chamber = CHAMBERS[difficulty];

    let puzzles;
    try {
      puzzles = await fetchPuzzles(difficulty);
    } catch (err) {
      showLoadError('Could not load the chamber from the backend. Is the server running?');
      console.error('[WonderHack] chamber load failed:', err);
      return;
    }

    if (typeof WonderPuzzles !== 'undefined' && WonderPuzzles.registerDifficulty) {
      WonderPuzzles.registerDifficulty(difficulty, puzzles);
    }

    if (typeof WonderPuzzleEngine === 'undefined') {
      showLoadError('The puzzle engine did not load.');
      return;
    }

    await WonderPuzzleEngine.init({
      difficulty: chamber.difficulty,
      chamberTitle: chamber.title,
      puzzles,
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
  });

  return { init, fetchPuzzles, currentDifficulty };
})();
