const SHORTCUT_KEY = 'autoRefreshShortcut';
const DEFAULT_SHORTCUT = 'alt+shift+r';
const BASE_SHORTCUT = 'alt+r';

const state = {
  shortcut: DEFAULT_SHORTCUT,
  baseShortcut: BASE_SHORTCUT,
};

const loadShortcut = async () => {
  const stored = await chrome.storage.sync.get(SHORTCUT_KEY);
  state.shortcut = (stored[SHORTCUT_KEY] || DEFAULT_SHORTCUT).toLowerCase();
};

const parseShortcut = (shortcut) => {
  const parts = shortcut.split('+').map((p) => p.trim()).filter(Boolean);
  const modifiers = new Set();
  let key = '';
  parts.forEach((part) => {
    if (['ctrl', 'control'].includes(part)) modifiers.add('ctrl');
    else if (['shift'].includes(part)) modifiers.add('shift');
    else if (['alt', 'option'].includes(part)) modifiers.add('alt');
    else if (['meta', 'cmd', 'command'].includes(part)) modifiers.add('meta');
    else key = part;
  });
  return { modifiers, key };
};

const matchesShortcut = (event, shortcut) => {
  const { modifiers, key } = parseShortcut(shortcut);
  const keyMatch = key ? event.key.toLowerCase() === key : false;
  return (
    keyMatch &&
    event.ctrlKey === modifiers.has('ctrl') &&
    event.shiftKey === modifiers.has('shift') &&
    event.altKey === modifiers.has('alt') &&
    event.metaKey === modifiers.has('meta')
  );
};

const shouldIgnoreTarget = (target) => {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
};

const handleKeydown = async (event) => {
  if (shouldIgnoreTarget(event.target)) return;
  if (matchesShortcut(event, state.shortcut)) {
    alert(`Full URL shortcut for ${window.location.href}`);
    chrome.runtime.sendMessage({ type: 'shortcutTriggered', url: window.location.href, mode: 'full' });
    return;
  }
  if (matchesShortcut(event, state.baseShortcut)) {
    alert(`Base URL shortcut for ${window.location.href}`);
    chrome.runtime.sendMessage({ type: 'shortcutTriggered', url: window.location.href, mode: 'base' });
  }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SHORTCUT_KEY]) {
    state.shortcut = (changes[SHORTCUT_KEY].newValue || DEFAULT_SHORTCUT).toLowerCase();
  }
});

(async () => {
  await loadShortcut();
  window.addEventListener('keydown', handleKeydown, true);
})();
