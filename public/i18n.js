'use strict';

// Infraestructura de idiomas (Fase 29, roadmap "OZAMA PRO"): auditoria
// previa encontro CERO infraestructura de i18n -- todo el texto vive
// hardcodeado en español directo en el markup. Esta es la base real:
// diccionarios por idioma cargados una sola vez, aplicados via
// [data-i18n] en el markup estatico, y un helper t() para el texto que
// las paginas generan dinamicamente en su propio <script>.
//
// Alcance deliberado de esta fase (ver auditoria): la landing, login/
// registro y el lobby quedan completamente traducidos como v1 real y
// verificada. Los mensajes de error que vienen DEL SERVIDOR (data.error
// en cada fetch) siguen en español -- traducir esos toca cientos de
// strings sueltos en mas de 15 archivos de rutas, un trabajo aparte y
// mucho mas grande que esta fase. El resto de paginas se puede migrar
// despues siguiendo exactamente el mismo patron ([data-i18n] + t()).
(() => {
  const SUPPORTED = ['es', 'en'];
  const DEFAULT_LANG = 'es';
  const STORAGE_KEY = 'ozama-lang';

  const state = {
    lang: DEFAULT_LANG,
    dict: {},
    fallbackDict: {}, // 'es' siempre cargado como respaldo si a un key le falta traduccion en el idioma activo
    ready: null,
  };

  function detectInitialLanguage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.includes(stored)) return stored;
    } catch (_) {}

    try {
      const user = JSON.parse(localStorage.getItem('ozama-user') || 'null');
      const saved = user?.preferences?.language;
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (_) {}

    const nav = String(navigator.language || navigator.userLanguage || '').toLowerCase();
    if (nav.startsWith('en')) return 'en';
    return DEFAULT_LANG;
  }

  async function fetchDict(lang) {
    try {
      // Cache normal del navegador (con revalidacion condicional via
      // ETag/Last-Modified, que express.static ya manda por defecto),
      // no force-cache -- probado en vivo: force-cache sirve una copia
      // vieja para siempre una vez cacheada, aunque el archivo en el
      // servidor ya cambio, porque nunca revalida.
      const res = await fetch(`/locales/${lang}.json`);
      if (!res.ok) return {};
      return await res.json();
    } catch (_) {
      return {};
    }
  }

  // "a.b.c" -> dict.a.b.c, sin depender de que el key exista aplanado.
  function lookup(dict, key) {
    let node = dict;
    for (const part of key.split('.')) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[part];
    }
    return typeof node === 'string' ? node : undefined;
  }

  function interpolate(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
  }

  function t(key, vars) {
    const value = lookup(state.dict, key) ?? lookup(state.fallbackDict, key);
    if (value === undefined) return key;
    return interpolate(value, vars);
  }

  function applyTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    document.documentElement.lang = state.lang;
  }

  async function persistToServer(lang) {
    const token = window.OZAMA_RUNTIME?.getAuthToken?.() || '';
    let hasSession = Boolean(token);
    if (!hasSession) {
      try { hasSession = Boolean(JSON.parse(localStorage.getItem('ozama-user') || 'null')); } catch (_) {}
    }
    if (!hasSession) return;
    try {
      await fetch('/api/user/preferences', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ language: lang }),
      });
    } catch (_) { /* preferencia local ya quedo guardada, no es critico si esto falla */ }
  }

  async function setLanguage(lang, { persist = true } = {}) {
    if (!SUPPORTED.includes(lang) || lang === state.lang) {
      if (lang === state.lang) return;
    }
    if (!SUPPORTED.includes(lang)) return;
    state.lang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    state.dict = lang === DEFAULT_LANG ? state.fallbackDict : await fetchDict(lang);
    applyTranslations();
    renderSwitcher();
    document.dispatchEvent(new CustomEvent('ozama:language-changed', { detail: { lang } }));
    if (persist) persistToServer(lang);
  }

  function switcherLabel(lang) {
    return lang === 'en' ? 'EN' : 'ES';
  }

  function renderSwitcher() {
    const slot = document.getElementById('lang-switch');
    if (!slot) return;
    slot.innerHTML = '';
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', 'Idioma / Language');
    for (const lang of SUPPORTED) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'oz-lang-btn' + (lang === state.lang ? ' active' : '');
      btn.textContent = switcherLabel(lang);
      btn.setAttribute('aria-pressed', String(lang === state.lang));
      btn.addEventListener('click', () => setLanguage(lang));
      slot.appendChild(btn);
    }
  }

  function addSwitcherStyles() {
    if (document.querySelector('style[data-ozama-i18n]')) return;
    const style = document.createElement('style');
    style.dataset.ozamaI18n = 'true';
    style.textContent = `
      #lang-switch { display: inline-flex; gap: 2px; border: 1px solid rgba(200,152,60,0.35); border-radius: 3px; padding: 2px; background: rgba(0,0,0,0.2); }
      .oz-lang-btn { min-width: 30px; min-height: 26px; padding: 0 6px; border: 0; border-radius: 2px; color: rgba(233,228,218,0.62); background: transparent; font: 800 10px/1 Inter, Arial, sans-serif; letter-spacing: 0.5px; cursor: pointer; transition: color 160ms ease, background 160ms ease; }
      .oz-lang-btn:hover { color: #E2B960; }
      .oz-lang-btn.active { color: #0D0B08; background: linear-gradient(180deg, #E2B960, #A9771C); }
    `;
    document.head.appendChild(style);
  }

  async function init() {
    addSwitcherStyles();
    state.lang = detectInitialLanguage();
    state.fallbackDict = await fetchDict(DEFAULT_LANG);
    state.dict = state.lang === DEFAULT_LANG ? state.fallbackDict : await fetchDict(state.lang);
    applyTranslations();
    renderSwitcher();
  }

  state.ready = init();

  window.OZAMA_I18N = {
    t,
    setLanguage,
    getLanguage: () => state.lang,
    applyTranslations,
    ready: state.ready,
  };

  document.addEventListener('DOMContentLoaded', () => {
    state.ready.then(() => { applyTranslations(); renderSwitcher(); });
  });
})();
