/* Exercise animation timing, reduced motion and the Hard broadcast without a network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function setup({ reducedMotion = false, storage = new Map(), courtId = 5 } = {}) {
  const elements = new Map();
  class Element {
    constructor() {
      this.listeners = {};
      this.dataset = {};
      this.children = [];
      this.textContent = '';
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
      };
      this.style = {};
    }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    set innerHTML(value) {
      for (const match of value.matchAll(/id="([^"]+)"/g)) {
        const node = new Element();
        node.id = match[1];
      }
      this.paper = [new Element(), new Element()];
    }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    dispatchEvent(event) {
      for (const callback of this.listeners[event.type] || []) callback(event);
      return true;
    }
    emit(type, event = {}) { return this.dispatchEvent({ type, preventDefault() {}, ...event }); }
    append(node) { this.children.push(node); }
    querySelectorAll() { return this.paper || []; }
    querySelector() { return this.bubbleText ||= new Element(); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { this.focused = true; }
    click() { this.emit('click'); }
  }
  const document = new Element();
  document.body = new Element();
  document.body.dataset.basePath = '../../';
  document.getElementById = id => elements.get(id) || null;
  document.createElement = () => new Element();
  for (const id of ['queen-sprite', 'queen-bubble', 'puzzle-title', 'puzzle-feedback']) {
    new Element().id = id;
  }
  const window = new Element();
  const preference = new Element();
  preference.matches = reducedMotion;
  const timers = new Map();
  let now = 0;
  let timerId = 0;
  const sockets = [];
  class WebSocket extends Element {
    static OPEN = 1;
    static CLOSING = 2;
    constructor() { super(); this.readyState = 0; this.sent = []; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    openConnection() { this.readyState = 1; this.emit('open'); }
    close() { this.readyState = 3; }
    disconnect(code = 1001) { this.readyState = 3; this.emit('close', { code }); }
    reply(packet) { this.emit('message', { data: JSON.stringify(packet) }); }
  }
  const context = vm.createContext({
    document, window, WebSocket,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    location: { protocol: 'https:', host: 'wonderhack.test' },
    matchMedia: () => preference,
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    WonderState: { getPlayer: () => ({ courtId }) },
    WonderSession: { isAuthenticated: () => true },
    WonderCharacters: { hideBubble() {} },
  });
  for (const filename of ['hard-challenge.js', 'queen-takeover.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', filename), 'utf8'), context);
  }
  document.emit('DOMContentLoaded');
  return {
    get: document.getElementById, document, window, sockets, timers, storage, preference,
    puzzle(difficulty = 'hard', queenCorrupted = true) {
      document.emit('wonderhack:puzzle-loaded', {
        detail: { difficulty, puzzle: { queenCorrupted, question: 'The final question' } },
      });
    },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = until;
    },
  };
}

for (const difficulty of ['easy', 'medium', 'hard']) {
  test(`${difficulty}: animated destruction completes before the final investigation`, async () => {
    const app = await setup();
    app.puzzle(difficulty, false);
    assert.equal(app.get('queen-takeover'), null);
    assert.equal(app.sockets.length, 0);
    app.puzzle(difficulty);
    assert.equal(app.get('queen-takeover').dataset.phase, 'arrival');
    assert.equal(app.get('queen-takeover').open, true);
    app.advance(1600);
    assert.equal(app.get('queen-takeover').dataset.phase, 'wrath');
    app.advance(1800);
    assert.equal(app.get('queen-takeover').dataset.phase, 'destroyed');
    assert.equal(app.document.body.classList.contains('queen-destroying'), true);
    assert.equal(app.sockets.length, 0);
    app.advance(3600);
    assert.equal(app.get('queen-takeover').open, false);
    assert.equal(app.document.body.classList.contains('queen-destroying'), false);
    assert.equal(app.document.body.classList.contains('queen-system-broken'), true);
    assert.match(app.get('puzzle-feedback').textContent, /destroyed the final riddle/);
    assert.equal(app.sockets.length, difficulty === 'hard' ? 1 : 0);
  });
}

test('skip cancels the remaining animation and remembers each chamber separately', async () => {
  const app = await setup();
  app.puzzle('easy');
  app.get('skip-takeover').click();
  assert.equal(app.timers.size, 0);
  app.puzzle('easy', false);
  app.puzzle('easy');
  assert.equal(app.get('queen-takeover').open, false);
  app.puzzle('medium');
  assert.equal(app.get('queen-takeover').open, true);
  app.get('queen-takeover').emit('cancel');
  assert.equal(app.get('queen-takeover').open, false);
});

test('reduced motion shows a still scene until Continue, and never starts timers', async () => {
  const app = await setup({ reducedMotion: true });
  app.puzzle();
  assert.equal(app.get('queen-takeover').dataset.phase, 'resistance');
  assert.equal(app.get('skip-takeover').textContent, 'Continue →');
  assert.equal(app.timers.size, 0);
  assert.equal(app.sockets.length, 0);
  app.get('skip-takeover').click();
  assert.equal(app.sockets.length, 1);
});

test('leaving the final trial cancels animation and page restore resumes it', async () => {
  const app = await setup();
  app.puzzle('medium');
  app.puzzle('medium', false);
  assert.equal(app.get('queen-takeover').open, false);
  assert.equal(app.timers.size, 0);
  assert.equal(app.document.body.classList.contains('queen-system-broken'), false);
  app.puzzle('medium');
  app.window.emit('pagehide');
  assert.equal(app.timers.size, 0);
  app.window.emit('pageshow', { persisted: true });
  assert.equal(app.get('queen-takeover').open, true);
});

test('Hard broadcast keeps leaked hashes in the network and reconnects only on the final trial', async () => {
  const app = await setup();
  app.puzzle();
  app.get('skip-takeover').click();
  const socket = app.sockets[0];
  socket.openConnection();
  assert.equal(socket.sent[0].data, 1);
  app.get('queen-sprite').click();
  assert.equal(socket.sent.length, 2);
  socket.reply({ event: 'message', text: 'secret hash in response', passwordHash: 'private-digest' });
  assert.match(app.get('queen-bubble').querySelector().textContent, /heard nothing/);
  assert.doesNotMatch(app.get('queen-bubble').querySelector().textContent, /private-digest|secret hash/);
  socket.disconnect();
  app.advance(1500);
  assert.equal(app.sockets.length, 2);
  app.puzzle('hard', false);
  assert.equal(app.sockets[1].readyState, 3);
  assert.equal(app.timers.size, 0);
  app.get('queen-sprite').click();
  assert.equal(app.sockets.length, 2);
});

test('an expired Hard session does not retry the broadcast', async () => {
  const app = await setup();
  app.puzzle();
  app.get('skip-takeover').click();
  app.sockets[0].disconnect(1008);
  app.advance(2000);
  assert.equal(app.sockets.length, 1);
});
