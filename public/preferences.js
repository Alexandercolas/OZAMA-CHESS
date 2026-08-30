'use strict';

// Personalizacion compartida (Fase 2 del roadmap PRO): un solo lugar
// para leer/aplicar/guardar preferencias, para que game.html,
// damas.html y settings.html usen exactamente la misma logica en vez
// de cada uno reinventar su propio guardado.
//
// El sonido reusa las MISMAS llaves de localStorage que script.js ya
// leia de entrada ('ozama-sound-muted' / 'ozama-sound-volume') --
// nunca se agrega una llave nueva en paralelo para lo mismo. El tema
// de tablero no tenia una llave dedicada (antes era un toggle binario
// 'ozama-board-theme': 'ebony'/'default'), asi que ese si vive en un
// cache propio, migrando el valor viejo la primera vez.
const OZAMA_PREFS = (() => {
  const THEME_CACHE_KEY = 'ozama-board-theme-v2';
  const LEGACY_THEME_KEY = 'ozama-board-theme';
  const SOUND_MUTED_KEY = 'ozama-sound-muted';
  const SOUND_VOLUME_KEY = 'ozama-sound-volume';

  const BOARD_THEMES = {
    colonial: { free: true,  label: 'Zona Colonial' },
    marmol:   { free: true,  label: 'Mármol' },
    ebano:    { free: false, label: 'Ébano' },
    caoba:    { free: false, label: 'Caoba' },
  };
  const THEME_ORDER = ['colonial', 'marmol', 'ebano', 'caoba'];
  const DEFAULT_THEME = 'colonial';
  const DEFAULT_VOLUME = 0.82;

  function readStoredUser() {
    try { return JSON.parse(localStorage.getItem('ozama-user') || 'null'); }
    catch { return null; }
  }

  (function migrateLegacyTheme() {
    try {
      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      if (legacy === 'ebony' && !localStorage.getItem(THEME_CACHE_KEY)) {
        localStorage.setItem(THEME_CACHE_KEY, 'ebano');
      }
      localStorage.removeItem(LEGACY_THEME_KEY);
    } catch (_) {}
  })();

  function isPremiumActive(user) {
    const premiumUntil = user?.premiumUntil ? new Date(user.premiumUntil) : null;
    return user?.plan === 'premium' && (!premiumUntil || premiumUntil > new Date());
  }

  // El cache local (ultimo cambio hecho en este navegador) manda sobre
  // lo que trajo el ultimo /me -- asi un cambio se ve al toque aunque
  // el guardado al servidor todavia no haya terminado.
  function current() {
    const user = readStoredUser();
    const fromServer = user?.preferences && typeof user.preferences === 'object' ? user.preferences : {};

    let boardTheme = localStorage.getItem(THEME_CACHE_KEY) || fromServer.boardTheme || DEFAULT_THEME;
    const themeDef = BOARD_THEMES[boardTheme];
    // Un tema Premium guardado no se aplica si la suscripcion ya no
    // esta activa -- se degrada solo al tema gratis (no se borra la
    // preferencia, vuelve sola si renueva).
    if (!themeDef || (!themeDef.free && !isPremiumActive(user))) boardTheme = DEFAULT_THEME;

    const soundMuted = localStorage.getItem(SOUND_MUTED_KEY) !== null
      ? localStorage.getItem(SOUND_MUTED_KEY) === 'true'
      : !!fromServer.soundMuted;
    const storedVolume = localStorage.getItem(SOUND_VOLUME_KEY);
    const soundVolume = storedVolume !== null
      ? Math.max(0, Math.min(1, Number(storedVolume)))
      : (Number.isFinite(fromServer.soundVolume) ? fromServer.soundVolume : DEFAULT_VOLUME);

    return { boardTheme, soundMuted, soundVolume };
  }

  function applyToDocument(prefs) {
    const p = prefs || current();
    document.body?.setAttribute('data-board-theme', p.boardTheme);
    if (typeof window.setSoundMuted === 'function') window.setSoundMuted(p.soundMuted);
    if (typeof window.setSoundVolumeGlobal === 'function') window.setSoundVolumeGlobal(p.soundVolume);
  }

  async function save(partial) {
    if (partial.boardTheme !== undefined) localStorage.setItem(THEME_CACHE_KEY, partial.boardTheme);
    if (partial.soundMuted !== undefined) localStorage.setItem(SOUND_MUTED_KEY, String(partial.soundMuted));
    if (partial.soundVolume !== undefined) localStorage.setItem(SOUND_VOLUME_KEY, String(partial.soundVolume));
    applyToDocument(current());

    try {
      const token = window.OZAMA_RUNTIME?.getAuthToken?.() || '';
      const res = await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(partial),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar.');

      const user = readStoredUser();
      if (user) {
        user.preferences = { ...user.preferences, ...data.preferences };
        localStorage.setItem('ozama-user', JSON.stringify(user));
      }
      return { ok: true };
    } catch (err) {
      // Guest o sin conexion: el cambio ya quedo aplicado localmente
      // (arriba), solo no se sincronizo al perfil todavia.
      return { ok: false, error: err.message || 'No se pudo guardar la preferencia.' };
    }
  }

  function availableThemes(user) {
    const premiumActive = isPremiumActive(user || readStoredUser());
    return THEME_ORDER.map((key) => ({ key, ...BOARD_THEMES[key], locked: !BOARD_THEMES[key].free && !premiumActive }));
  }

  function cycleBoardTheme() {
    const user = readStoredUser();
    const premiumActive = isPremiumActive(user);
    const allowed = THEME_ORDER.filter((key) => BOARD_THEMES[key].free || premiumActive);
    const idx = allowed.indexOf(current().boardTheme);
    const next = allowed[(idx + 1) % allowed.length];
    save({ boardTheme: next });
    return next;
  }

  return { current, applyToDocument, save, availableThemes, cycleBoardTheme, BOARD_THEMES, THEME_ORDER, isPremiumActive };
})();

// Aplicar apenas se puede (antes de que el usuario interactue, para
// no mostrar un flash del tema por defecto).
if (document.body) OZAMA_PREFS.applyToDocument();
else document.addEventListener('DOMContentLoaded', () => OZAMA_PREFS.applyToDocument(), { once: true });
