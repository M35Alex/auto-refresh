const RULES_KEY = 'autoRefreshRules';
const SHORTCUT_KEY = 'autoRefreshShortcut';
const DEFAULT_INTERVAL_KEY = 'autoRefreshDefaultInterval';
const DEFAULT_SHORTCUT = 'alt+shift+r';
const DEFAULT_INTERVAL_MINUTES = 60;
const PANEL_SIZE_KEY = 'autoRefreshPanelSize';
const DEFAULT_PANEL_SIZE = { width: 720, height: 520 };

const form = document.getElementById('rule-form');
const baseInput = document.getElementById('baseUrl');
const intervalInput = document.getElementById('interval');
const rulesList = document.getElementById('rules-list');
const shortcutInput = document.getElementById('shortcut-input');
const defaultIntervalInput = document.getElementById('default-interval');
const saveSettingsBtn = document.getElementById('save-settings');
const app = document.getElementById('app');
const timersList = document.getElementById('timers-list');
const tabButtons = Array.from(document.querySelectorAll('.tab'));
const panels = {
  rules: document.getElementById('rules-panel'),
  timers: document.getElementById('timers-panel'),
  settings: document.getElementById('settings-panel'),
};

const readRules = async () => {
  const stored = await chrome.storage.sync.get(RULES_KEY);
  return stored[RULES_KEY] || [];
};

const saveRules = async (rules) => {
  await chrome.storage.sync.set({ [RULES_KEY]: rules });
  chrome.runtime.sendMessage({ type: 'rulesUpdated' });
};

const readShortcut = async () => {
  const stored = await chrome.storage.sync.get(SHORTCUT_KEY);
  return (stored[SHORTCUT_KEY] || DEFAULT_SHORTCUT).toLowerCase();
};

const saveShortcut = async (shortcut) => {
  const normalized = shortcut.trim().toLowerCase();
  if (!normalized) return;
  await chrome.storage.sync.set({ [SHORTCUT_KEY]: normalized });
};

const readDefaultInterval = async () => {
  const stored = await chrome.storage.sync.get(DEFAULT_INTERVAL_KEY);
  const value = parseFloat(stored[DEFAULT_INTERVAL_KEY]);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_INTERVAL_MINUTES;
  return value;
};

const saveDefaultInterval = async (value) => {
  const minutes = parseFloat(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  await chrome.storage.sync.set({ [DEFAULT_INTERVAL_KEY]: minutes });
};

const readPanelSize = async () => {
  const stored = await chrome.storage.sync.get(PANEL_SIZE_KEY);
  const size = stored[PANEL_SIZE_KEY];
  if (!size || !size.width || !size.height) return DEFAULT_PANEL_SIZE;
  return size;
};

const savePanelSize = async (size) => {
  await chrome.storage.sync.set({ [PANEL_SIZE_KEY]: size });
};

const renderRules = async () => {
  const rules = await readRules();
  rulesList.innerHTML = '';
  if (!rules.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No rules yet. Add one above.';
    empty.style.color = '#475569';
    empty.style.fontSize = '13px';
    rulesList.appendChild(empty);
    return;
  }

  rules.forEach((rule) => {
    const item = document.createElement('li');
    item.className = 'rule';

    const view = document.createElement('div');
    view.className = 'rule-view';
    const viewBase = document.createElement('div');
    viewBase.textContent = rule.baseUrl;
    const viewInterval = document.createElement('small');
    viewInterval.textContent = `Every ${rule.intervalMinutes} min`;
    view.appendChild(viewBase);
    view.appendChild(viewInterval);

    const actions = document.createElement('div');
    actions.className = 'rule-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.className = 'edit';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'delete';

    const headerRow = document.createElement('div');
    headerRow.className = 'rule-row-head';
    headerRow.appendChild(view);
    headerRow.appendChild(actions);

    const edit = document.createElement('div');
    edit.className = 'rule-edit';
    edit.hidden = true;

    const row = document.createElement('div');
    row.className = 'rule-row';

    const baseField = document.createElement('input');
    baseField.type = 'text';
    baseField.value = rule.baseUrl;

    const intervalField = document.createElement('input');
    intervalField.type = 'number';
    intervalField.min = '0.1';
    intervalField.step = '0.1';
    intervalField.value = rule.intervalMinutes;

    row.appendChild(baseField);
    row.appendChild(intervalField);

    const editActions = document.createElement('div');
    editActions.className = 'rule-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.className = 'save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'cancel';

    const setEditing = (on) => {
      edit.hidden = !on;
      headerRow.hidden = on;
      saveBtn.hidden = !on;
      cancelBtn.hidden = !on;
      if (on) {
        baseField.focus();
        baseField.select();
      }
    };

    editBtn.addEventListener('click', () => setEditing(true));

    saveBtn.addEventListener('click', async () => {
      const nextBase = normalizeBaseUrl(baseField.value);
      const nextInterval = parseFloat(intervalField.value);
      if (!nextBase || !Number.isFinite(nextInterval) || nextInterval <= 0) return;
      const rulesLatest = await readRules();
      const updated = rulesLatest.map((r) =>
        r.id === rule.id
          ? { ...r, baseUrl: nextBase, intervalMinutes: parseFloat(nextInterval.toFixed(2)) }
          : r
      );
      await saveRules(updated);
      setEditing(false);
      renderRules();
    });

    cancelBtn.addEventListener('click', () => {
      baseField.value = rule.baseUrl;
      intervalField.value = rule.intervalMinutes;
      setEditing(false);
    });

    deleteBtn.addEventListener('click', async () => {
      const next = (await readRules()).filter((r) => r.id !== rule.id);
      await saveRules(next);
      renderRules();
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    editActions.appendChild(saveBtn);
    editActions.appendChild(cancelBtn);

    edit.appendChild(row);
    edit.appendChild(editActions);

    item.appendChild(headerRow);
    item.appendChild(edit);
    rulesList.appendChild(item);
  });
};

const normalizeBaseUrl = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

const formatTime = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const hydrateDefaults = async () => {
  const defaultInterval = await readDefaultInterval();
  if (intervalInput) intervalInput.value = defaultInterval;
  if (defaultIntervalInput) defaultIntervalInput.value = defaultInterval;
};

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const baseUrl = normalizeBaseUrl(baseInput.value);
    const intervalMinutes = parseFloat(intervalInput.value);
    if (!baseUrl) {
      baseInput.focus();
      return;
    }
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      intervalInput.focus();
      return;
    }

    const rules = await readRules();
    const existing = rules.find((rule) => rule.baseUrl === baseUrl);
    const newRule = {
      id: existing?.id || crypto.randomUUID?.() || String(Date.now()),
      baseUrl,
      intervalMinutes: parseFloat(intervalMinutes.toFixed(2)),
    };

    const nextRules = existing
      ? rules.map((rule) => (rule.id === existing.id ? newRule : rule))
      : [...rules, newRule];

    await saveRules(nextRules);
    await renderRules();
    form.reset();
    await hydrateDefaults();
  });
}

const hydrateShortcut = async () => {
  const shortcut = await readShortcut();
  if (shortcutInput) shortcutInput.value = shortcut;
};

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', async () => {
    const defaultValue = defaultIntervalInput?.value || DEFAULT_INTERVAL_MINUTES;
    await saveDefaultInterval(defaultValue);
    const shortcutValue = shortcutInput?.value || DEFAULT_SHORTCUT;
    await saveShortcut(shortcutValue);
    await hydrateDefaults();
    await hydrateShortcut();
  });
}

const switchTab = (name) => {
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === name;
    btn.classList.toggle('active', isActive);
  });
  document.body.dataset.tab = name;
  Object.entries(panels).forEach(([key, panel]) => {
    if (!panel) return;
    panel.hidden = key !== name;
  });
  if (name === 'rules') {
    hydrateDefaults();
  }
  if (name === 'settings') {
    hydrateDefaults();
    hydrateShortcut();
  }
};

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

const applyPanelSize = (size) => {
  const clampedWidth = Math.min(Math.max(size.width, 540), 900);
  const clampedHeight = Math.min(Math.max(size.height, 420), 1000);
  app.style.width = `${clampedWidth}px`;
  app.style.height = `${clampedHeight}px`;
};

const hydratePanelSize = async () => {
  const size = await readPanelSize();
  applyPanelSize(size);
};

const observePanelSize = () => {
  let debounce;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        savePanelSize({ width: Math.round(width), height: Math.round(height) });
      }, 150);
    }
  });
  observer.observe(app);
};

const renderTimers = async () => {
  if (!timersList) return;
  const res = await chrome.runtime.sendMessage({ type: 'getTimers' });
  if (!res?.ok) return;
  const timers = res.timers || [];
  timersList.innerHTML = '';
  if (!timers.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No matching tabs yet.';
    empty.style.color = '#475569';
    empty.style.fontSize = '13px';
    timersList.appendChild(empty);
    return;
  }

  timers.forEach((t) => {
    const item = document.createElement('li');
    item.className = 'timer';

    const header = document.createElement('div');
    header.className = 'timer-header';
    header.textContent = t.title || t.url;

    const badge = document.createElement('span');
    badge.className = `badge${t.isActive ? ' active' : ''}`;
    badge.textContent = t.isActive ? 'Active' : 'Background';
    header.appendChild(badge);

    const meta = document.createElement('small');
    const elapsed = formatTime(t.elapsedMs);
    const remaining = formatTime(t.remainingMs);
    meta.textContent = `${t.baseUrl} • every ${t.intervalMinutes}m • elapsed ${elapsed} (remaining ${remaining})`;

    item.appendChild(header);
    item.appendChild(meta);
    timersList.appendChild(item);
  });
};

const startTimerPolling = () => {
  renderTimers();
  setInterval(() => {
    renderTimers();
  }, 2000);
};

hydrateDefaults();
renderRules();
hydrateShortcut();
hydratePanelSize().then(observePanelSize);
switchTab('rules');
startTimerPolling();
