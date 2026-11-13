/* Exercise the shipped chat controller without a browser or network dependency. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.listeners = {};
    this.children = [];
    this.value = '';
    this.hidden = true;
    this.disabled = true;
    this.open = false;
    this.dataset = {};
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    };
  }
  addEventListener(name, callback) {
    (this.listeners[name] ||= []).push(callback);
  }
  async emit(name, event = {}) {
    event.preventDefault ||= () => {};
    for (const callback of this.listeners[name] || []) await callback(event);
  }
  append(...children) {
    for (const child of children) {
      if (typeof child !== 'string') child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  get textContent() {
    return this.children.map(child => typeof child === 'string' ? child : child.textContent).join('');
  }
  set textContent(text) { this.children = [text]; }
  get childNodes() { return this.children; }
  get childElementCount() { return this.children.filter(child => typeof child !== 'string').length; }
  get firstElementChild() { return this.children.find(child => typeof child !== 'string'); }
  querySelector() { return this.textElement ||= new Element(); }
  focus() { this.focused = true; }
  scrollIntoView() {}
  close() { this.open = false; }
  showModal() { this.open = true; }
}

async function setup({ final = true, reducedMotion = true } = {}) {
  const elements = new Map();
  const document = new Element();
  document.body = new Element();
  document.getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  document.createElement = () => new Element();
  const window = new Element();
  const timers = new Map();
  let timerId = 0;
  const sockets = [];
  class WebSocket extends Element {
    static OPEN = 1;
    static CLOSING = 2;
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(raw) {
      if (this.readyState !== WebSocket.OPEN) throw new Error('Socket is closed');
      this.sent.push(JSON.parse(raw));
    }
    async openConnection() { this.readyState = WebSocket.OPEN; await this.emit('open'); }
    async disconnect(code = 1001) { this.readyState = 3; await this.emit('close', { code }); }
    close() { this.readyState = 3; }
    reply(packet) { return this.emit('message', { data: JSON.stringify(packet) }); }
  }
  const context = vm.createContext({
    document, window, WebSocket,
    location: { protocol: 'https:', host: 'wonderhack.test' },
    matchMedia: () => ({ matches: reducedMotion }),
    sessionStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    WonderSession: { boot: async () => {}, isAuthenticated: () => true },
    WonderState: { getPlayer: () => ({ courtId: 5 }) },
    WonderPuzzleEngine: { getCurrentPuzzle: () => ({ queenCorrupted: final }) },
    WonderCharacters: { hideBubble: () => {} },
  });
  const source = fs.readFileSync(path.join(__dirname, '../public/js/hard-challenge.js'), 'utf8');
  vm.runInContext(source, context);
  await document.emit('DOMContentLoaded');
  return {
    get: document.getElementById, document, window, sockets, timers,
    puzzle: queenCorrupted => document.emit('wonderhack:puzzle-loaded', {
      detail: { difficulty: 'hard', puzzle: { queenCorrupted } },
    }),
    async draft(text) {
      document.getElementById('queen-chat-input').value = text;
      await document.getElementById('queen-chat-input').emit('input');
    },
    submit: () => document.getElementById('queen-chat-form').emit('submit'),
  };
}

test('chat stays hidden until the final takeover ends', async () => {
  const app = await setup({ final: false, reducedMotion: false });
  assert.equal(app.get('queen-chat').hidden, true);
  assert.equal(app.sockets.length, 0);
  await app.puzzle(true);
  assert.equal(app.get('queen-takeover').open, true);
  assert.equal(app.get('queen-chat').hidden, true);
  await app.get('skip-takeover').emit('click');
  assert.equal(app.get('queen-chat').hidden, false);
  assert.equal(app.sockets.length, 1);
  assert.equal(app.get('queen-takeover').open, false);
});

test('typed messages use the real protocol; replies and user markup render as text', async () => {
  const app = await setup();
  const socket = app.sockets[0];
  assert.equal(socket.url, 'wss://wonderhack.test/ws/queen');
  assert.equal(app.get('queen-chat-send').disabled, true);
  await socket.openConnection();
  assert.equal(app.get('queen-chat-send').disabled, true);
  await app.draft('  ');
  await app.submit();
  assert.equal(socket.sent.length, 1); // Only the initial numeric Queen taunt.
  await app.draft('<img src=x onerror=alert(1)>');
  assert.equal(app.get('queen-chat-send').disabled, false);
  await app.submit();
  assert.equal(socket.sent[1].event, 'message');
  assert.equal(socket.sent[1].data, '<img src=x onerror=alert(1)>');
  assert.equal(app.get('queen-chat-input').value, '');
  assert.equal(app.get('queen-chat-input').focused, true);
  assert.equal(app.get('queen-chat-send').disabled, true);
  assert.equal(app.get('queen-chat-log').textContent, 'You: <img src=x onerror=alert(1)>');
  await socket.reply({ event: 'message', text: 'Off with their heads!' });
  assert.match(app.get('queen-chat-log').textContent, /Queen of Hearts: Off with their heads!/);
  assert.equal(app.get('queen-bubble').querySelector().textContent, 'Off with their heads!');
  await socket.reply({ event: 'error', text: 'Speak in royal envelopes, Alice!' });
  assert.match(app.get('queen-chat-log').textContent, /Speak in royal envelopes/);
});

test('reconnecting preserves drafts and expiry disables sending', async () => {
  const app = await setup();
  const socket = app.sockets[0];
  await socket.openConnection();
  await app.draft('Hello Queen');
  await socket.disconnect();
  assert.equal(app.get('queen-chat-send').disabled, true);
  assert.match(app.get('queen-chat-status').textContent, /Reconnecting/);
  const reconnect = [...app.timers.values()].find(timer => timer.delay === 1500);
  reconnect.callback();
  await app.submit(); // Even an attempted submission while connecting keeps the draft.
  assert.equal(app.get('queen-chat-input').value, 'Hello Queen');
  const replacement = app.sockets[1];
  await replacement.openConnection();
  assert.equal(app.get('queen-chat-send').disabled, false);
  await app.submit();
  assert.equal(replacement.sent[1].data, 'Hello Queen');
  await replacement.disconnect(1008);
  assert.equal(app.get('queen-chat-send').disabled, true);
  assert.match(app.get('queen-chat-status').textContent, /Sign in again/);
});

test('secret-bearing replies are acknowledged without displaying the secret', async () => {
  const app = await setup();
  const socket = app.sockets[0];
  await socket.openConnection();
  await socket.reply({ event: 'message', leaked: true, text: 'secret-digest', passwordHash: 'secret-digest' });
  assert.doesNotMatch(app.get('queen-chat-log').textContent, /secret-digest/);
  assert.match(app.get('queen-chat-log').textContent, /cuts herself short/);
  assert.doesNotMatch(app.get('queen-bubble').querySelector().textContent, /secret-digest/);
  await socket.emit('message', { data: '{malformed' });
  await socket.reply(null);
});

test('leaving the final trial closes chat and ignores late events', async () => {
  const app = await setup();
  const socket = app.sockets[0];
  await socket.openConnection();
  for (let i = 0; i < 55; i++) await socket.reply({ event: 'message', text: `reply ${i}` });
  assert.equal(app.get('queen-chat-log').childElementCount, 50);
  const transcript = app.get('queen-chat-log').textContent;
  await app.puzzle(false);
  assert.equal(app.get('queen-chat').hidden, true);
  assert.equal(app.get('queen-chat-send').disabled, true);
  assert.equal(socket.readyState, 3);
  await socket.reply({ event: 'message', text: 'stale reply' });
  await socket.disconnect();
  assert.equal(app.get('queen-chat-log').textContent, transcript);
  assert.equal([...app.timers.values()].some(timer => timer.delay === 1500), false);
});
