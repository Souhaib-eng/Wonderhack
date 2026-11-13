/* Final takeover and live Queen chat. Secrets remain in the network traffic. */
(() => {
  let socket;
  let reconnectTimer;
  let speechTimer;
  let ready = false;
  let finalActive = false;
  let transitioning = false;
  let transitionTimers = [];
  let restoreQuestion = null;
  let finaleKey = '';

  function updateChat(status) {
    if (status) document.getElementById('queen-chat-status').textContent = status;
    const input = document.getElementById('queen-chat-input');
    document.getElementById('queen-chat-send').disabled = !finalActive || transitioning
      || !socket || socket.readyState !== WebSocket.OPEN || !input.value.trim();
  }

  function appendChat(speaker, text) {
    const log = document.getElementById('queen-chat-log');
    const line = document.createElement('p');
    const name = document.createElement('strong');
    name.textContent = `${speaker}: `;
    line.append(name, text);
    log.append(line);
    // Bound the transcript during long sessions without storing it in the browser.
    while (log.childElementCount > 50) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function sendChat(event) {
    event.preventDefault();
    const input = document.getElementById('queen-chat-input');
    if (!finalActive || transitioning || !input.value.trim()) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connect();
      return; // Keep the draft so a reconnect never loses the player's message.
    }
    try {
      socket.send(JSON.stringify({ event: 'message', data: input.value }));
    } catch (_) {
      updateChat('Your message could not be sent. Try again when the Queen returns.');
      return;
    }
    appendChat('You', input.value);
    input.value = '';
    updateChat();
    input.focus();
  }

  function clearTransition() {
    transitionTimers.forEach(clearTimeout);
    transitionTimers = [];
    transitioning = false;
    document.body.classList.remove('queen-destroying');
    const dialog = document.getElementById('queen-takeover');
    if (dialog.open) dialog.close();
  }

  function revealHack(focus = false) {
    if (!finalActive) return;
    if (restoreQuestion) restoreQuestion();
    restoreQuestion = null;
    clearTransition();
    document.body.classList.add('queen-system-broken');
    const feedback = document.getElementById('puzzle-feedback');
    feedback.replaceChildren();
    const message = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = 'The Queen destroyed the final riddle. ';
    message.append(title, 'The royal system is still running. Find your own way out.');
    feedback.append(message);
    try { sessionStorage.setItem(finaleKey, 'destroyed'); } catch (_) {}
    if (focus) {
      const title = document.getElementById('puzzle-title');
      title.focus({ preventScroll: true });
      title.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    }
  }

  function startTakeover(puzzle) {
    let alreadySeen = false;
    try { alreadySeen = sessionStorage.getItem(finaleKey) === 'destroyed'; } catch (_) {}
    if (alreadySeen || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      revealHack();
      return;
    }
    const dialog = document.getElementById('queen-takeover');
    const question = document.getElementById('puzzle-question-text');
    const corrupted = Array.from(question.childNodes);
    restoreQuestion = () => question.replaceChildren(...corrupted);
    question.textContent = puzzle.question;
    transitioning = true;
    dialog.dataset.phase = 'arrival';
    document.getElementById('takeover-title').textContent = 'You were never meant to win.';
    document.getElementById('takeover-line').textContent = 'One last question. One furious Queen.';
    // Close old dialogue so it cannot cover the final act when the curtain falls.
    ['queen-bubble', 'rabbit-bubble'].forEach(id => {
      if (typeof WonderCharacters !== 'undefined') WonderCharacters.hideBubble(id);
    });
    dialog.showModal();
    document.getElementById('skip-takeover').focus();
    const beat = (delay, action) => transitionTimers.push(setTimeout(action, delay));
    beat(1500, () => {
      dialog.dataset.phase = 'wrath';
      document.getElementById('takeover-title').textContent = 'Then I shall destroy the rules.';
      document.getElementById('takeover-line').textContent = '“No more riddles. No more escape. OFF WITH THE GAME!”';
    });
    beat(3000, () => {
      dialog.dataset.phase = 'destroyed';
      document.body.classList.add('queen-destroying');
      restoreQuestion();
      restoreQuestion = null;
      document.getElementById('takeover-title').textContent = 'The final riddle is destroyed.';
      document.getElementById('takeover-line').textContent = 'RIDDLE ARCHIVE LOST / ROYAL SYSTEM STILL ONLINE';
      if (typeof WonderAudio !== 'undefined' && WonderAudio.playQueenGlitch) WonderAudio.playQueenGlitch();
    });
    beat(4600, () => {
      dialog.dataset.phase = 'resistance';
      document.getElementById('takeover-title').textContent = 'She broke the game. Hack the system.';
      document.getElementById('takeover-line').textContent = 'Her rules have failed. Find your own way out.';
    });
    beat(6200, () => revealHack(true));
  }

  function onPuzzle(puzzle) {
    if (!ready || !puzzle) return;
    const isFinal = !!puzzle.queenCorrupted;
    if (isFinal && finalActive) {
      if (!transitioning) revealHack();
      return;
    }
    clearTransition();
    restoreQuestion = null;
    finalActive = isFinal;
    document.body.classList.remove('queen-system-broken');
    if (!isFinal) {
      return;
    }
    startTakeover(puzzle);
  }

  document.addEventListener('wonderhack:puzzle-loaded', event => {
    if (event.detail.difficulty === 'hard') onPuzzle(event.detail.puzzle);
  });

  function provokeQueen() { return false; }

  function connect() {
    if (!ready || !finalActive || transitioning) return;
    if (socket && socket.readyState < WebSocket.CLOSING) return;
    clearTimeout(reconnectTimer);
    updateChat('Connecting to Her Majesty…');
    const channel = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/queen`);
    socket = channel;
    channel.addEventListener('open', () => {
      if (channel !== socket) return;
      updateChat('The Queen is listening.');
      provokeQueen();
    });
    channel.addEventListener('message', event => {
      if (channel !== socket) return;
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (!message || !['message', 'error'].includes(message.event) || typeof message.text !== 'string') return;
      // Acknowledge every reply, but leave the challenge secret in the network.
      const text = message.leaked || message.passwordHash
        ? '“You heard nothing, Alice! Nothing!” The Queen cuts herself short.'
        : message.text;
      appendChat('Queen of Hearts', text);
      const bubble = document.getElementById('queen-bubble');
      bubble.querySelector('.dialogue-bubble-text').textContent = text;
      bubble.classList.remove('fading');
      bubble.classList.add('visible');
      clearTimeout(speechTimer);
      speechTimer = setTimeout(() => WonderCharacters.hideBubble('queen-bubble'), 5500);
      if (typeof WonderAudio !== 'undefined') WonderAudio.playQueenAngry();
    });
    channel.addEventListener('close', event => {
      if (channel !== socket) return;
      socket = null;
      if (event.code !== 1008 && finalActive && WonderSession.isAuthenticated()) {
        updateChat('The Queen stepped away. Reconnecting… Your draft will stay here.');
        reconnectTimer = setTimeout(connect, 1500);
      } else {
        updateChat('Your court pass expired. Sign in again to speak to the Queen.');
      }
    });
    channel.addEventListener('error', () => {
      if (channel === socket) updateChat('Could not reach the Queen. Waiting to reconnect…');
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await WonderSession.boot();
    if (!WonderSession.isAuthenticated()) return;
    const player = WonderState.getPlayer();
    finaleKey = `wh_hard_takeover_${player.courtId}`;
    document.getElementById('skip-takeover').addEventListener('click', () => revealHack(true));
    document.getElementById('queen-takeover').addEventListener('cancel', event => {
      event.preventDefault();
      revealHack(true);
    });
    document.getElementById('queen-sprite').addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (finalActive) provokeQueen();
        else document.getElementById('queen-sprite').click();
      }
    });
    ready = true;
    onPuzzle(WonderPuzzleEngine.getCurrentPuzzle());
  });
  window.addEventListener('pagehide', () => {
    if (restoreQuestion) restoreQuestion();
    restoreQuestion = null;
    clearTransition();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && finalActive && WonderSession.isAuthenticated()) revealHack();
  });
})();
