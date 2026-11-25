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
    const results = [];
    const traverse = (el) => {
      for (const child of el.children) {
        if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) results.push(child);
        else if (selector.startsWith('#') && child.id === selector.slice(1)) results.push(child);
        else if (selector === '*' || child.tagName.toLowerCase() === selector.toLowerCase()) results.push(child);
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
      if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
      return root.querySelector(sel);
    },
    querySelectorAll(sel) {
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
