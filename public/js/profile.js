/**
 * WONDERHACK — Player Profile & Dossier Manager
 * Allows switching avatar between Alice and Queen, updating hacker alias, and tracking achievements.
 */

const WonderProfile = (() => {
  function init() {
    renderProfile();
    bindEvents();
  }

  function renderProfile() {
    const isLoggedIn = WonderState.isLoggedIn();
    const state = WonderState.getState();
    const container = document.querySelector('.profile-container');

    // If not logged in, show lock screen so Alice account does NOT show up at first!
    if (!isLoggedIn || !state.player) {
      if (container) {
        container.innerHTML = `
          <article class="parchment-window" style="text-align: center; padding: 3.5rem 2rem;">
            <div style="font-size: 3.5rem; margin-bottom: 1rem;">🔒📜</div>
            <h1 style="font-family: var(--font-display); font-size: 2.1rem; color: #7a1223; margin-bottom: 0.75rem;">
              Court Dossier Locked
            </h1>
            <p style="font-family: var(--font-story); font-size: 1.25rem; color: #5a4032; font-style: italic; max-width: 540px; margin: 0 auto 2rem auto; line-height: 1.6;">
              No court account is currently authenticated. Please log in at the Gatekeeper Login to inspect royal dossier records and sovereign balances.
            </p>
            <div style="display:flex; justify-content:center; gap: 1rem; flex-wrap:wrap;">
              <a href="login.html?difficulty=easy" class="btn-victorian btn-crimson" style="padding: 0.85rem 2rem; font-size: 1.05rem; text-decoration: none;">
                🗝️ Proceed to Gatekeeper Login ➔
              </a>
              <a href="puzzles.html" class="btn-victorian btn-gold" style="padding: 0.85rem 2rem; font-size: 1.05rem; text-decoration: none;">
                🏰 Return to Castle
              </a>
            </div>
          </article>
        `;
      }
      return;
    }

    const isAlice = state.player.character === 'alice';
    const isAdmin = state.player.isAdmin || (state.player.username || '').toLowerCase() === 'admin' || (state.player.character || '').toLowerCase() === 'admin';

    // Update portrait cameo
    const avatarImg = document.getElementById('profile-avatar-img');
    const charName = document.getElementById('profile-character-name');
    if (avatarImg) {
      avatarImg.src = isAdmin
        ? 'assets/images/characters/admin.png'
        : (isAlice ? 'assets/images/characters/alice.png' : 'assets/images/characters/queen.png');
      avatarImg.alt = state.player.displayName || (isAdmin ? 'Court Administrator' : (isAlice ? 'Alice' : 'Court Player'));
    }
    if (charName) {
      charName.textContent = `Court Dossier: ${state.player.displayName || (isAdmin ? 'Court Administrator' : (isAlice ? 'Alice' : 'Court Player'))}`;
    }

    // Update fields
    const aliasInput = document.getElementById('profile-username');
    const emailInput = document.getElementById('profile-email');
    if (aliasInput) aliasInput.value = state.player.username || state.player.displayName || '';
    if (emailInput) emailInput.value = state.player.email || '';

    // Update stats counters
    const ptsEasyElem = document.getElementById('stat-points-easy');
    const ptsMedElem = document.getElementById('stat-points-medium');
    const ptsHardElem = document.getElementById('stat-points-hard');
    const ptsElem = document.getElementById('stat-points');
    const solvedElem = document.getElementById('stat-solved');
    const hintsElem = document.getElementById('stat-hints');

    const diffPts = state.pointsByDifficulty || { easy: 0, medium: 0, hard: 0 };
    if (ptsEasyElem) ptsEasyElem.textContent = diffPts.easy || 0;
    if (ptsMedElem) ptsMedElem.textContent = diffPts.medium || 0;
    if (ptsHardElem) ptsHardElem.textContent = diffPts.hard || 0;
    if (ptsElem) ptsElem.textContent = state.points;
    if (solvedElem) solvedElem.textContent = `${state.solvedPuzzles.length} / 30`;
    if (hintsElem) hintsElem.textContent = state.purchasedHints.length;

    // Per-chamber progress (server-authoritative when online).
    const progress = (typeof WonderState.getProgressByDifficulty === 'function')
      ? WonderState.getProgressByDifficulty()
      : { easy: { solved: 0, total: 15 }, medium: { solved: 0, total: 10 }, hard: { solved: 0, total: 5 } };
    ['easy', 'medium', 'hard'].forEach((difficulty) => {
      const item = progress[difficulty] || { solved: 0, total: 0 };
      const value = Math.min(Number(item.solved) || 0, Number(item.total) || 0);
      const total = Math.max(Number(item.total) || 0, value);
      const percent = total > 0 ? Math.round((value / total) * 100) : 0;
      const fill = document.getElementById(`progress-${difficulty}-fill`);
      const label = document.getElementById(`progress-${difficulty}-value`);
      if (fill) fill.style.width = `${percent}%`;
      if (label) label.textContent = `${value} / ${total}`;
    });

    // Render achievements
    renderAchievements(state);
  }

  function renderAchievements(state) {
    const container = document.getElementById('achievements-container');
    if (!container) return;

    const achievements = [
      {
        id: 'down-rabbit-hole',
        title: 'Down the Rabbit Hole',
        desc: 'Entered the Queen’s Castle and began the cryptographic trials.',
        unlocked: true,
        icon: '🐇'
      },
      {
        id: 'unbirthday-tea',
        title: 'Mad Hatter’s Patron',
        desc: 'Acquired at least one secret hint from the tea party.',
        unlocked: state.purchasedHints.length > 0,
        icon: '🎩'
      },
      {
        id: 'feline-rot',
        title: 'Feline Cryptographer',
        desc: 'Conquered Enigma I with the Cheshire Cat’s blessing.',
        unlocked: state.solvedPuzzles.includes('puzzle-1'),
        icon: '🐱'
      },
      {
        id: 'tarts-recovered',
        title: 'Tart Mastermind',
        desc: 'Audited the Knave’s backwards hex ledger in Enigma III.',
        unlocked: state.solvedPuzzles.includes('puzzle-3'),
        icon: '🥧'
      },
      {
        id: 'rsa-grandmaster',
        title: 'Grand Court Cipherist',
        desc: 'Cracked the Mad Hatter’s RSA modulus in Enigma V.',
        unlocked: state.solvedPuzzles.includes('puzzle-5'),
        icon: '👑'
      }
    ];

    container.innerHTML = achievements.map(a => `
      <div class="achievement-badge ${a.unlocked ? 'unlocked' : 'locked'}">
        <div class="achievement-icon">${a.icon}</div>
        <div>
          <h4 class="achievement-title">${a.title}</h4>
          <p class="achievement-desc">${a.desc}</p>
        </div>
        <div class="achievement-status">
          ${a.unlocked ? '✓ Conquered' : 'Locked'}
        </div>
      </div>
    `).join('');
  }

  function bindEvents() {
    // Save profile details form (persisted to the player's server account)
    const form = document.getElementById('profile-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('profile-username').value.trim();
        const email = document.getElementById('profile-email').value.trim();
        if (!username) return;

        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        let saved = false;
        const onlineAccount = typeof WonderSession !== 'undefined'
          && WonderSession.isAuthenticated();

        if (onlineAccount) {
          const result = await WonderSession.updateProfile({
            displayName: username,
            email,
          });
          saved = !!result.success;
          if (!saved) {
            WonderUI.showToast(result.error || 'The court rejected that dossier.', 'crimson');
          }
        } else {
          // No server account on this page: keep the local dossier usable.
          WonderState.setPlayerProfile({ username, email });
          saved = true;
        }

        if (btn) btn.disabled = false;
        if (saved) WonderUI.showToast('Player dossier sealed in the royal registry!', 'gold');
        renderProfile();
      });
    }

    // Reset progress button — clears server coins, solves and hints.
    const resetBtn = document.getElementById('reset-progress-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Are you certain? This erases your saved coins, solved enigmas and hints from the server.')) {
          return;
        }
        resetBtn.disabled = true;

        const onlineAccount = typeof WonderSession !== 'undefined'
          && WonderSession.isAuthenticated();

        if (onlineAccount) {
          const result = await WonderSession.resetProgress();
          if (!result.success) {
            WonderUI.showToast(result.error || 'Could not reset server progress.', 'crimson');
            resetBtn.disabled = false;
            return;
          }
          WonderUI.showToast('Your progression has been wiped clean.', 'gold');
          setTimeout(() => window.location.reload(), 700);
          return;
        }

        // No server account: wipe the local game state.
        WonderState.resetProgress();
      });
    }
  }

  return { init };
})();
