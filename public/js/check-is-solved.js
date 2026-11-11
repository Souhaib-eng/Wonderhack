/**
 * WONDERHACK —
 * Since you're here, that means you're searching for a key, Congrats you're in the right path!
 * Try inspecting the webpage for some functions you find interesting!
 * Trust your guts and the challenges will be 'Solved'
 * Good luck! ;)
 *                                      - The mad hatter 
 */

const WonderCheckIsSolved = (() => {
  const ENDPOINT = '/api/check-is-solved';

  function _asSolved(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
      return ['true', '1', 'yes', 'solved'].includes(value.trim().toLowerCase());
    }
    return false;
  }

  function _currentChamber() {
    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
    const match = path.match(/\/challenges\/(easy|medium|hard)\//i);
    if (match) return match[1].toLowerCase();
    return 'easy'; // landing page: the Easy gateway
  }

  function _payload(puzzleNumber, solved) {
    // isSolved() and isSolved(true) both target the final trial (ordinal 30).
    if (typeof puzzleNumber === 'boolean' && solved === undefined) {
      return { puzzle: 30, solved: puzzleNumber };
    }
    if (puzzleNumber === undefined) {
      return { puzzle: 30, solved: true };
    }
    return {
      puzzle: Number(puzzleNumber),
      solved: solved === undefined ? true : _asSolved(solved),
    };
  }

  function _summarize(data) {
    if (!data || data.success !== true) {
      if (data && data.immune) {
        console.warn('[WonderHack]', data.error);
      } else {
        console.warn('[WonderHack]', (data && data.error) || 'The royal registry rejected that request.');
      }
      return null;
    }

    const result = data.flag || data.prize || 0;
    console.log(
      `[WonderHack] Puzzle ${data.puzzle} (${data.title}) — ` +
      (data.solved ? `solved, prize: ${data.prize}` : 'not solved, prize: 0') +
      (data.flag ? ` — FLAG: ${data.flag}` : '')
    );
    return result;
  }

  // Synchronous on purpose: a console call returns the prize/flag directly.
  function _request(puzzleNumber, solved) {
    const payload = _payload(puzzleNumber, solved);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', ENDPOINT, false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = true;
      xhr.send(JSON.stringify(payload));

      if (xhr.status < 200 || xhr.status >= 300) {
        let denial = null;
        try { denial = JSON.parse(xhr.responseText); } catch (e) {}
        if (denial && denial.immune) {
          console.warn('[WonderHack]', denial.error);
          return null;
        }
        throw new Error(`The royal registry answered with HTTP ${xhr.status}.`);
      }
      return _summarize(JSON.parse(xhr.responseText));
    } catch (err) {
      console.error('[WonderHack] isSolved() could not reach the royal registry:', err);
      return null;
    }
  }
  // Check if the puzzles are solved
  function isSolved(puzzleNumber, solved) {
    return _request(puzzleNumber, solved);  
  }

  // Backwards-compatible name used by earlier hints.
  function checkIsSolved(puzzleNumber, solved) {
    return _request(puzzleNumber, solved);
  }

  // Promise-based variant for code that does not want a blocking request.
  async function checkIsSolvedAsync(puzzleNumber, solved) {
    const payload = _payload(puzzleNumber, solved);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return _summarize(await response.json());
    } catch (err) {
      console.error('[WonderHack] checkIsSolvedAsync could not reach the royal registry:', err);
      return null;
    }
  }

  if (typeof window !== 'undefined') {
    window.isSolved = isSolved;
    window.checkIsSolved = checkIsSolved;
    window.checkIsSolvedAsync = checkIsSolvedAsync;
    window.WonderCheckIsSolved = {
      isSolved,
      checkIsSolved,
      checkIsSolvedAsync,
      currentChamber: _currentChamber,
    };
  }

  return { isSolved, checkIsSolved, checkIsSolvedAsync, currentChamber: _currentChamber };
})();
