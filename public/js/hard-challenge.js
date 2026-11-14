/* Hard chamber broadcast. The Queen speaks through her existing speech bubble. */
(() => {
  let socket;
  let reconnectTimer;
  let speechTimer;
  let finalActive = false;

  function stopConnection() {
    clearTimeout(reconnectTimer);
    clearTimeout(speechTimer);
    const previous = socket;
    socket = null;
    previous?.close(1000);
  }

  function provokeQueen() {
    if (!finalActive) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) { connect(); return; }
    try { socket.send(JSON.stringify({ event: 'message', data: 1 })); } catch (_) {}
  }

  function connect() {
    if (!finalActive || !WonderSession.isAuthenticated()) return;
    if (socket && socket.readyState < WebSocket.CLOSING) return;
    clearTimeout(reconnectTimer);
    const channel = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/queen`);
    socket = channel;
    channel.addEventListener('open', () => { if (socket === channel) provokeQueen(); });
    channel.addEventListener('message', event => {
      if (socket !== channel) return;
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (!message || !['message', 'error'].includes(message.event) || typeof message.text !== 'string') return;
      const text = message.leaked || message.passwordHash
        ? '“You heard nothing, Alice! Nothing!” The Queen cuts herself short.' : message.text;
      const bubble = document.getElementById('queen-bubble');
      if (!bubble) return;
      bubble.querySelector('.dialogue-bubble-text').textContent = text;
      bubble.classList.remove('fading');
      bubble.classList.add('visible');
      clearTimeout(speechTimer);
      speechTimer = setTimeout(() => {
        if (typeof WonderCharacters !== 'undefined') WonderCharacters.hideBubble('queen-bubble');
      }, 5500);
      if (typeof WonderAudio !== 'undefined') WonderAudio.playQueenAngry?.();
    });
    channel.addEventListener('close', event => {
      if (socket !== channel) return;
      socket = null;
      if (event.code !== 1008 && finalActive && WonderSession.isAuthenticated()) reconnectTimer = setTimeout(connect, 1500);
    });
    channel.addEventListener('error', () => { /* close schedules a reconnect */ });
  }

  document.addEventListener('wonderhack:puzzle-loaded', event => {
    if (event.detail.difficulty === 'hard' && !event.detail.puzzle?.queenCorrupted) {
      finalActive = false;
      stopConnection();
    }
  });
  document.addEventListener('wonderhack:takeover-complete', event => {
    if (event.detail.difficulty !== 'hard') return;
    finalActive = true;
    connect();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const queen = document.getElementById('queen-sprite');
    queen?.addEventListener('click', provokeQueen);
    queen?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); queen.click(); }
    });
  });
  window.addEventListener('pagehide', () => { finalActive = false; stopConnection(); });
})();
