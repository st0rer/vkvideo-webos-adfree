/**
 * Lightweight webOS TV DOM Mock for Node 22 testing
 */

export class MockClassList {
  constructor() {
    this.classes = new Set();
  }
  add(cls) { this.classes.add(cls); }
  remove(cls) { this.classes.delete(cls); }
  toggle(cls, force) {
    if (force === undefined) {
      if (this.classes.has(cls)) this.classes.delete(cls);
      else this.classes.add(cls);
    } else if (force) {
      this.classes.add(cls);
    } else {
      this.classes.delete(cls);
    }
  }
  contains(cls) { return this.classes.has(cls); }
}

export class MockElement {
  constructor(tagName = 'div', id = '', className = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.classList = new MockClassList();
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.dataset = {};
    this.attributes = {};
    this._rect = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
    this.offsetParent = {};
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  load() {}
  pause() {}
  play() { return Promise.resolve(); }

  setRect(top, left, width, height) {
    this._rect = {
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height
    };
  }

  getBoundingClientRect() {
    return this._rect;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const h of list) h(event);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, currentTarget: this });
  }

  focus() {
    this.classList.add('focused');
  }

  blur() {
    this.classList.remove('focused');
  }

  scrollIntoView() {}

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.startsWith('.') && curr.classList.contains(selector.slice(1))) return curr;
      if (selector.startsWith('#') && curr.id === selector.slice(1)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1 && parts[0].startsWith('#')) {
      const scopeId = parts[0].slice(1);
      const scopeEl = this.id === scopeId ? this : this.querySelectorAll(parts[0])[0];
      if (!scopeEl) return [];
      return scopeEl.querySelectorAll(parts.slice(1).join(' '));
    }
    const results = [];
    const matchSingle = (el, sel) => {
      if (sel === '*') return true;
      if (sel.startsWith('#')) return el.id === sel.slice(1);
      if (sel.startsWith('.')) {
        const classes = sel.slice(1).split('.').filter(Boolean);
        return classes.every(c => el.classList.contains(c));
      }
      return el.tagName.toLowerCase() === sel.toLowerCase();
    };
    const traverse = (el) => {
      for (const child of el.children) {
        if (matchSingle(child, selector)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  contains(node) {
    let curr = node;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }
}

export class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) { return this.store[key] !== undefined ? this.store[key] : null; }
  setItem(key, val) { this.store[key] = String(val); }
  removeItem(key) { delete this.store[key]; }
  clear() { this.store = {}; }
}

export function setupMockEnvironment() {
  const elements = new Map();
  const root = new MockElement('div', 'app');

  const doc = {
    createElement(tag) { return new MockElement(tag); },
    getElementById(id) {
      if (!elements.has(id)) {
        const el = new MockElement('div', id);
        elements.set(id, el);
      }
      return elements.get(id);
    },
    querySelector(sel) {
      if (sel.startsWith('#') && !/\s/.test(sel)) return this.getElementById(sel.slice(1));
      const all = this.querySelectorAll(sel);
      if (all.length > 0) return all[0];
      return root.querySelector(sel);
    },
    querySelectorAll(sel) {
      const parts = sel.trim().split(/\s+/);
      if (parts.length > 1 && parts[0].startsWith('#')) {
        const scope = elements.get(parts[0].slice(1)) || (root.id === parts[0].slice(1) ? root : null);
        if (scope) return scope.querySelectorAll(parts.slice(1).join(' '));
      }
      return root.querySelectorAll(sel);
    },
    addEventListener(event, handler) {
      if (!this._listeners) this._listeners = {};
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    },
    dispatchEvent(event) {
      const list = (this._listeners && this._listeners[event.type]) || [];
      for (const h of list) h(event);
    }
  };

  const win = {
    document: doc,
    localStorage: new MockLocalStorage(),
    addEventListener(event, handler) {
      if (!this._listeners) this._listeners = {};
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    },
    dispatchEvent(event) {
      const list = (this._listeners && this._listeners[event.type]) || [];
      for (const h of list) h(event);
    },
    webOS: {
      platformBack() { win._platformBackCalled = true; }
    }
  };

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = win.localStorage;
  globalThis.webOS = win.webOS;

  return { root, win, doc, elements };
}
