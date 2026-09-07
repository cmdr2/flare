import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import {
  createCarbonEditor,
  DEFAULT_CARBON_LANGUAGE
} from '../public/apps/carbon/codemirror-carbon.js';

const VIEWPORT_HEIGHT = 200;
const SCROLL_HEIGHT = 1000;
const MAX_SCROLL_TOP = SCROLL_HEIGHT - VIEWPORT_HEIGHT;
// One text line, as measured by CodeMirror's height oracle in a real browser.
const LINE_HEIGHT = 14;

beforeAll(() => {
  // jsdom has no layout engine; stub Range geometry so CodeMirror's async
  // measuring code does not crash. The scroll command under test only relies
  // on scrollDOM metrics and the line height, which the tests stub per editor.
  Range.prototype.getClientRects = function () {
    return [];
  };
  Range.prototype.getBoundingClientRect = function () {
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
  };
});

function stubScrollMetrics(scrollDOM, { clientHeight, scrollHeight }) {
  Object.defineProperty(scrollDOM, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(scrollDOM, 'scrollHeight', { configurable: true, get: () => scrollHeight });
}

function pressKey(view, key, modifiers = {}) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  );
}

function createEditor(doc) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createCarbonEditor({
    parent: host,
    doc,
    language: DEFAULT_CARBON_LANGUAGE
  });
  stubScrollMetrics(editor.view.scrollDOM, {
    clientHeight: VIEWPORT_HEIGHT,
    scrollHeight: SCROLL_HEIGHT
  });
  Object.defineProperty(editor.view, 'defaultLineHeight', {
    configurable: true,
    value: LINE_HEIGHT
  });
  return { editor, view: editor.view, scrollDOM: editor.view.scrollDOM };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('carbon Ctrl+ArrowUp/Down line scrolling', () => {
  it('Ctrl+ArrowDown scrolls the tab down by one line', () => {
    const { view, scrollDOM } = createEditor(longDoc());
    expect(scrollDOM.scrollTop).toBe(0);

    pressKey(view, 'ArrowDown', { ctrlKey: true });

    expect(scrollDOM.scrollTop).toBe(LINE_HEIGHT);
  });

  it('Ctrl+ArrowUp scrolls the tab up by one line', () => {
    const { view, scrollDOM } = createEditor(longDoc());
    scrollDOM.scrollTop = MAX_SCROLL_TOP;

    pressKey(view, 'ArrowUp', { ctrlKey: true });

    expect(scrollDOM.scrollTop).toBe(MAX_SCROLL_TOP - LINE_HEIGHT);
  });

  it('scrolls line by line while the key is held down (key auto-repeat)', () => {
    const { view, scrollDOM } = createEditor(longDoc());
    expect(scrollDOM.scrollTop).toBe(0);

    // Browsers fire repeated keydown events while a key is held; each repeat
    // must scroll exactly one more line.
    for (let i = 0; i < 20; i += 1) {
      pressKey(view, 'ArrowDown', { ctrlKey: true });
    }

    expect(scrollDOM.scrollTop).toBe(20 * LINE_HEIGHT);
  });

  it('clamps scrolling to the document edges', () => {
    const { view, scrollDOM } = createEditor(longDoc());

    pressKey(view, 'ArrowUp', { ctrlKey: true });
    expect(scrollDOM.scrollTop).toBe(0);

    scrollDOM.scrollTop = MAX_SCROLL_TOP - 10;
    for (let i = 0; i < 10; i += 1) {
      pressKey(view, 'ArrowDown', { ctrlKey: true });
    }
    expect(scrollDOM.scrollTop).toBe(MAX_SCROLL_TOP);
  });

  it('does nothing when the document fits the viewport', () => {
    const { view, scrollDOM } = createEditor(longDoc());
    stubScrollMetrics(view.scrollDOM, {
      clientHeight: VIEWPORT_HEIGHT,
      scrollHeight: VIEWPORT_HEIGHT
    });
    const selectionBefore = view.state.selection.main;

    pressKey(view, 'ArrowDown', { ctrlKey: true });
    pressKey(view, 'ArrowUp', { ctrlKey: true });

    expect(scrollDOM.scrollTop).toBe(0);
    expect(view.state.selection.main).toEqual(selectionBefore);
  });

  it('keeps the caret and selection in place while scrolling', () => {
    const { view } = createEditor(longDoc());
    view.dispatch({ selection: { anchor: 5, head: 30 } });
    const selectionBefore = view.state.selection.main;
    const docBefore = view.state.doc.toString();

    pressKey(view, 'ArrowDown', { ctrlKey: true });
    pressKey(view, 'ArrowDown', { ctrlKey: true });
    pressKey(view, 'ArrowUp', { ctrlKey: true });

    expect(view.state.selection.main).toEqual(selectionBefore);
    expect(view.state.doc.toString()).toBe(docBefore);
  });

  it('prevents the default browser action for Ctrl+ArrowUp/Down', () => {
    const { view } = createEditor(longDoc());

    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);

    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
  });
});

describe('carbon keymap regressions', () => {
  it('Ctrl+Shift+ArrowDown still moves the current line down', () => {
    const { view } = createEditor('alpha\nbeta\ngamma');

    pressKey(view, 'ArrowDown', { ctrlKey: true, shiftKey: true });

    expect(view.state.doc.toString()).toBe('beta\nalpha\ngamma');
  });

  it('Ctrl+Shift+ArrowUp still moves the current line up', () => {
    const { view } = createEditor('alpha\nbeta\ngamma');
    view.dispatch({ selection: { anchor: 'alpha\nbeta\n'.length } });

    pressKey(view, 'ArrowUp', { ctrlKey: true, shiftKey: true });

    expect(view.state.doc.toString()).toBe('alpha\ngamma\nbeta');
  });

  it('Ctrl+h still opens the search panel', () => {
    const { view } = createEditor(longDoc());

    pressKey(view, 'h', { ctrlKey: true });

    expect(document.querySelector('.cm-panels .cm-search')).not.toBeNull();
  });
});

function longDoc() {
  return Array.from({ length: 60 }, (_, i) => 'line ' + (i + 1)).join('\n');
}
