const api = typeof browser !== 'undefined' ? browser : chrome;
const RULES_KEY = 'autoRefreshRules';
const ALARM_PREFIX = 'rule:';
const MIN_PERIOD_MINUTES = 1; // Firefox MV3 enforces >=1 minute alarms.
const DEFAULT_INTERVAL_MIN = 60;
const TICK_MS = 2000;
const TICK_ALARM = 'autoRefreshTick';
const DEFAULT_INTERVAL_KEY = 'autoRefreshDefaultInterval';

const timers = new Map();
let updating = false;

const getRules = async () => {
  const stored = await api.storage.sync.get(RULES_KEY);
  return stored[RULES_KEY] || [];
};

const setRules = async (rules) => {
  await api.storage.sync.set({ [RULES_KEY]: rules });
};

const getDefaultIntervalMinutes = async () => {
  const stored = await api.storage.sync.get(DEFAULT_INTERVAL_KEY);
  const value = parseFloat(stored[DEFAULT_INTERVAL_KEY]);
  if (!Number.isFinite(value) || value <= 0) {
    await api.storage.sync.set({ [DEFAULT_INTERVAL_KEY]: DEFAULT_INTERVAL_MIN });
    return DEFAULT_INTERVAL_MIN;
  }
  return value;
};

const matchesRule = (url, baseUrl) => {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return url.startsWith(baseUrl);
};

const normalizeBaseUrl = (url) => {
  if (!url) return '';
  try {
    const { origin, pathname } = new URL(url);
    const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
    return `${origin}${path}`;
  } catch (e) {
    return '';
  }
};

const normalizeOrigin = (url) => {
  if (!url) return '';
  try {
    const { origin } = new URL(url);
    return `${origin}/`;
  } catch (e) {
    return '';
  }
};

const toggleRuleForUrl = async (url, mode = 'full') => {
  const baseUrl = mode === 'base' ? normalizeOrigin(url) : normalizeBaseUrl(url);
  if (!baseUrl) return { ok: false };

  const rules = await getRules();
  const existing = rules.find((r) => r.baseUrl === baseUrl);
  const defaultInterval = await getDefaultIntervalMinutes();
  const nextRules = existing
    ? rules.filter((r) => r.id !== existing.id)
    : [
        ...rules,
        {
          id: crypto.randomUUID?.() || String(Date.now()),
          baseUrl,
          intervalMinutes: defaultInterval,
        },
      ];
  await setRules(nextRules);
  await updateTimers();
  return { ok: true, added: !existing };
};

const getActiveTabUrl = async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
};

const pickRuleForUrl = (rules, url) => {
  // Choose the longest matching base to make rules predictable.
  return rules
    .filter((r) => matchesRule(url, r.baseUrl))
    .sort((a, b) => b.baseUrl.length - a.baseUrl.length)[0];
};

const refreshTab = async (tabId) => {
  try {
    await api.tabs.reload(tabId);
  } catch (e) {
    // Ignore tabs that cannot be refreshed (e.g., about://, permissions)
  }
};

const pruneTimers = (liveTabIds) => {
  for (const id of timers.keys()) {
    if (!liveTabIds.has(id)) timers.delete(id);
  }
};

const ensureTickAlarm = () => {
  api.alarms.create(TICK_ALARM, { periodInMinutes: Math.max(MIN_PERIOD_MINUTES, 1) });
};

const updateTimers = async () => {
  if (updating) return;
  updating = true;
  try {
    const rules = await getRules();
    if (!rules.length) {
      timers.clear();
      return;
    }

    const tabs = await api.tabs.query({});
    const now = Date.now();
    const liveIds = new Set();
    const validRuleIds = new Set(rules.map((r) => r.id));

    for (const tab of tabs) {
      const rule = pickRuleForUrl(rules, tab.url);
      if (!rule) continue;

      liveIds.add(tab.id);
      const entry = timers.get(tab.id) || {
        tabId: tab.id,
        baseUrl: rule.baseUrl,
        ruleId: rule.id,
        intervalMinutes: rule.intervalMinutes,
        startedAt: now,
        title: tab.title || '',
        url: tab.url,
        isActive: false,
      };

      const isActive = tab.active && tab.highlighted !== false; // treat active tabs as focused

      // Reset timer when user views the tab or rule changes
      if (isActive || rule.baseUrl !== entry.baseUrl) {
        entry.startedAt = now;
        entry.baseUrl = rule.baseUrl;
        entry.ruleId = rule.id;
        entry.intervalMinutes = rule.intervalMinutes;
      }

      entry.title = tab.title || entry.title;
      entry.url = tab.url || entry.url;
      entry.isActive = isActive;

      const elapsed = now - entry.startedAt;
      const intervalMs = Math.max(
        (rule.intervalMinutes || DEFAULT_INTERVAL_MIN) * 60 * 1000,
        MIN_PERIOD_MINUTES * 60 * 1000
      );

      if (!isActive && elapsed >= intervalMs) {
        await refreshTab(tab.id);
        entry.startedAt = Date.now();
      }

      timers.set(tab.id, entry);
    }

    pruneTimers(liveIds);
    // Drop timers tied to rules that no longer exist (extra safety)
    for (const [tabId, entry] of timers.entries()) {
      if (!validRuleIds.has(entry.ruleId)) timers.delete(tabId);
    }
  } finally {
    updating = false;
  }
};

const buildTimersSnapshot = async () => {
  await updateTimers();
  const now = Date.now();
  return Array.from(timers.values()).map((entry) => {
    const intervalMs = Math.max(
      (entry.intervalMinutes || DEFAULT_INTERVAL_MIN) * 60 * 1000,
      MIN_PERIOD_MINUTES * 60 * 1000
    );
    return {
      tabId: entry.tabId,
      title: entry.title,
      url: entry.url,
      baseUrl: entry.baseUrl,
      intervalMinutes: entry.intervalMinutes,
      elapsedMs: Math.max(0, now - entry.startedAt),
      remainingMs: Math.max(0, intervalMs - (now - entry.startedAt)),
      isActive: !!entry.isActive,
    };
  });
};

api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TICK_ALARM) {
    await updateTimers();
    return;
  }
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    // Legacy alarms no longer used; clear if present
    await api.alarms.clear(alarm.name);
  }
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'rulesUpdated') {
      await updateTimers();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'shortcutTriggered' && message.url) {
      const result = await toggleRuleForUrl(message.url, message.mode || 'full');
      sendResponse(result);
      return;
    }

    if (message?.type === 'getTimers') {
      const snapshot = await buildTimersSnapshot();
      sendResponse({ ok: true, timers: snapshot });
      return;
    }
  })();

  return true; // keep channel open for async responses
});

api.commands.onCommand.addListener(async (command) => {
  const url = await getActiveTabUrl();
  if (!url) return;
  if (command === 'toggle-current-rule') {
    await toggleRuleForUrl(url, 'full');
  } else if (command === 'toggle-base-rule') {
    await toggleRuleForUrl(url, 'base');
  }
});

api.tabs.onRemoved.addListener((tabId) => {
  timers.delete(tabId);
});

api.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    updateTimers();
  }
});

api.tabs.onActivated.addListener(() => {
  updateTimers();
});

api.runtime.onInstalled.addListener(() => {
  ensureTickAlarm();
  updateTimers();
});

api.runtime.onStartup.addListener(() => {
  ensureTickAlarm();
  updateTimers();
});

setInterval(() => {
  updateTimers();
}, TICK_MS);
