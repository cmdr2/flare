import {
  COMMON_LANGUAGE_OPTIONS,
  createCodeMirrorEditor,
  DEFAULT_LANGUAGE_ID,
  EditorView,
  HighlightStyle,
  moveLineDown,
  moveLineUp,
  tags
} from '/public/libs/codemirror.js';

export const DEFAULT_CARBON_LANGUAGE = DEFAULT_LANGUAGE_ID;

export const CARBON_LANGUAGE_OPTIONS = COMMON_LANGUAGE_OPTIONS;

const carbonHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#8292a2' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#ae81ff' },
  { tag: [tags.string, tags.special(tags.string)], color: '#e6db74' },
  { tag: [tags.regexp, tags.className, tags.typeName, tags.definition(tags.typeName)], color: '#66d9ef' },
  { tag: [tags.variableName, tags.special(tags.variableName)], color: '#9effff' },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], color: '#a6e22e' },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName), tags.function(tags.variableName)], color: '#fd971f' },
  { tag: [tags.keyword, tags.definitionKeyword, tags.modifier, tags.tagName, tags.angleBracket], color: '#f92672' },
  { tag: [tags.heading, tags.strong], color: '#fd971f', fontWeight: '700' },
  { tag: [tags.emphasis, tags.quote], color: '#66d9ef', fontStyle: 'italic' },
  { tag: [tags.monospace, tags.link, tags.contentSeparator, tags.list], color: '#e6db74' },
  { tag: tags.punctuation, color: '#f8f8f2' }
]);

const carbonTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: '#272822',
    color: '#f8f8f2'
  },
  '.cm-scroller': {
    overflowX: 'hidden',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
  },
  '.cm-content, .cm-gutter': {
    minHeight: '100%'
  },
  '.cm-content': {
    padding: '20px 0 56px',
    caretColor: '#f8f8f0'
  },
  '.cm-line': {
    padding: '0 20px'
  },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: '#23241f',
    color: '#6d7066'
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#2f3129',
    color: '#cfcfc2'
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)'
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(73, 72, 62, 0.95)'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#f8f8f0'
  },
  '&.cm-focused': {
    outline: 'none'
  }
}, { dark: true });

const carbonKeymap = [
  { key: 'Ctrl-Shift-ArrowUp', run: moveLineUp, preventDefault: true },
  { key: 'Ctrl-Shift-ArrowDown', run: moveLineDown, preventDefault: true },
  { key: 'Cmd-Shift-ArrowUp', run: moveLineUp, preventDefault: true },
  { key: 'Cmd-Shift-ArrowDown', run: moveLineDown, preventDefault: true }
];

export function createCarbonEditor(options) {
  return createCodeMirrorEditor({
    ...options,
    theme: carbonTheme,
    highlightStyle: carbonHighlightStyle,
    enableAutocomplete: false,
    extraKeymap: carbonKeymap
  });
}