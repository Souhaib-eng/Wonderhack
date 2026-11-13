/* Shared Queen video prelude for the sealed final question in every chamber. */
(() => {
  let activeDialog;

  function playFinaleVideo(difficulty) {
    if (activeDialog) return;
    const key = `wh_queen_video_${difficulty}`;
    try {
      if (sessionStorage.getItem(key) === 'seen') return;
      sessionStorage.setItem(key, 'seen');
    } catch (_) {}

    const dialog = document.createElement('dialog');
    dialog.className = 'queen-finale-video';
    dialog.setAttribute('aria-label', 'The Queen announces the destruction of the final question');
    dialog.innerHTML = `
      <video autoplay muted playsinline preload="auto" aria-label="The Queen of Hearts">
        <source src="../../assets/video/queen-finale.mp4" type="video/mp4">
      </video>
      <button type="button" aria-label="Skip the Queen’s video">Skip video →</button>`;
    document.body.append(dialog);
    activeDialog = dialog;

    const finish = () => {
      if (!dialog.isConnected) return;
      const video = dialog.querySelector('video');
      video.pause();
      if (dialog.open) dialog.close();
      dialog.remove();
      activeDialog = null;
    };
    dialog.querySelector('button').addEventListener('click', finish);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) finish();
    });
    dialog.querySelector('video').addEventListener('ended', finish, { once: true });
    dialog.querySelector('video').addEventListener('error', finish, { once: true });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish();
    });
    dialog.showModal();
    dialog.querySelector('video').play().catch(finish);
  }

  document.addEventListener('wonderhack:puzzle-loaded', event => {
    const puzzle = event.detail && event.detail.puzzle;
    if (!puzzle || !puzzle.queenCorrupted) return;
    playFinaleVideo((event.detail.difficulty || 'easy').toLowerCase());
  });
})();
