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

  // Sets de piezas de Ajedrez (Fase 2 de personalizacion). 'clasico' y
  // 'ornamentado' ya existian como los dos estilos de siempre --
  // 'clasico' era el default fijo (USE_BLENDER_PIECES en script.js) y
  // 'ornamentado' el set SVG que solo se usaba como fallback. 'dorado'
  // reusa un set de piezas 3D que ya estaba en
  // assets/pieces/blender/gold/ sin usarse en ningun lado del juego.
  const PIECE_SETS = {
    clasico:     { free: true,  label: 'Clásico' },
    ornamentado: { free: true,  label: 'Ornamentado' },
    dorado:      { free: false, label: 'Dorado' },
  };
  const PIECE_SET_ORDER = ['clasico', 'ornamentado', 'dorado'];
  const DEFAULT_PIECE_SET = 'clasico';
  const PIECE_SET_CACHE_KEY = 'ozama-piece-set';

  // Fichas de Damas -- concepto separado de PIECE_SETS de arriba (son
  // discos de CSS, no piezas 3D/SVG), asi que llave y catalogo propios
  // en vez de reusar 'pieceSet' para dos cosas distintas.
  const DAMAS_PIECE_SETS = {
    clasico: { free: true,  label: 'Clásico' },
    marmol:  { free: true,  label: 'Mármol' },
    bronce:  { free: false, label: 'Bronce Real' },
  };
  const DAMAS_PIECE_SET_ORDER = ['clasico', 'marmol', 'bronce'];
  const DEFAULT_DAMAS_PIECE_SET = 'clasico';
  const DAMAS_PIECE_SET_CACHE_KEY = 'ozama-damas-piece-set';

  // Temas de plataforma (Fase 25) -- ver el bloque [data-app-theme] al
  // inicio de theme.css para el detalle de que cambia y que NO cambia.
  const PLATFORM_THEMES = {
    ambar:   { free: true,  label: 'Ámbar', swatch: '#C8983C' },
    malecon: { free: false, label: 'Malecón', swatch: '#3E82C4' },
    carmin:  { free: false, label: 'Carmín', swatch: '#C0392B' },
  };
  const PLATFORM_THEME_ORDER = ['ambar', 'malecon', 'carmin'];
  const DEFAULT_PLATFORM_THEME = 'ambar';
  const PLATFORM_THEME_CACHE_KEY = 'ozama-platform-theme';

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

    let pieceSet = localStorage.getItem(PIECE_SET_CACHE_KEY) || fromServer.pieceSet || DEFAULT_PIECE_SET;
    const pieceSetDef = PIECE_SETS[pieceSet];
    if (!pieceSetDef || (!pieceSetDef.free && !isPremiumActive(user))) pieceSet = DEFAULT_PIECE_SET;

    let damasPieceSet = localStorage.getItem(DAMAS_PIECE_SET_CACHE_KEY) || fromServer.damasPieceSet || DEFAULT_DAMAS_PIECE_SET;
    const damasPieceSetDef = DAMAS_PIECE_SETS[damasPieceSet];
    if (!damasPieceSetDef || (!damasPieceSetDef.free && !isPremiumActive(user))) damasPieceSet = DEFAULT_DAMAS_PIECE_SET;

    let platformTheme = localStorage.getItem(PLATFORM_THEME_CACHE_KEY) || fromServer.platformTheme || DEFAULT_PLATFORM_THEME;
    const platformThemeDef = PLATFORM_THEMES[platformTheme];
    if (!platformThemeDef || (!platformThemeDef.free && !isPremiumActive(user))) platformTheme = DEFAULT_PLATFORM_THEME;

    const soundMuted = localStorage.getItem(SOUND_MUTED_KEY) !== null
      ? localStorage.getItem(SOUND_MUTED_KEY) === 'true'
      : !!fromServer.soundMuted;
    const storedVolume = localStorage.getItem(SOUND_VOLUME_KEY);
    const soundVolume = storedVolume !== null
      ? Math.max(0, Math.min(1, Number(storedVolume)))
      : (Number.isFinite(fromServer.soundVolume) ? fromServer.soundVolume : DEFAULT_VOLUME);

    return { boardTheme, pieceSet, damasPieceSet, platformTheme, soundMuted, soundVolume };
  }

  function applyToDocument(prefs) {
    const p = prefs || current();
    document.body?.setAttribute('data-board-theme', p.boardTheme);
    document.body?.setAttribute('data-damas-piece-set', p.damasPieceSet);
    // En :root (<html>), no en <body> -- theme.css define el bloque
    // [data-app-theme] como :root[data-app-theme=...] para que el
    // acento este disponible desde el primer paint, antes de que
    // <body> exista siquiera.
    document.documentElement?.setAttribute('data-app-theme', p.platformTheme);
    if (typeof window.setSoundMuted === 'function') window.setSoundMuted(p.soundMuted);
    if (typeof window.setSoundVolumeGlobal === 'function') window.setSoundVolumeGlobal(p.soundVolume);
  }

  async function save(partial) {
    if (partial.boardTheme !== undefined) localStorage.setItem(THEME_CACHE_KEY, partial.boardTheme);
    if (partial.pieceSet !== undefined) localStorage.setItem(PIECE_SET_CACHE_KEY, partial.pieceSet);
    if (partial.damasPieceSet !== undefined) localStorage.setItem(DAMAS_PIECE_SET_CACHE_KEY, partial.damasPieceSet);
    if (partial.platformTheme !== undefined) localStorage.setItem(PLATFORM_THEME_CACHE_KEY, partial.platformTheme);
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

  function availablePieceSets(user) {
    const premiumActive = isPremiumActive(user || readStoredUser());
    return PIECE_SET_ORDER.map((key) => ({ key, ...PIECE_SETS[key], locked: !PIECE_SETS[key].free && !premiumActive }));
  }

  function availableDamasPieceSets(user) {
    const premiumActive = isPremiumActive(user || readStoredUser());
    return DAMAS_PIECE_SET_ORDER.map((key) => ({ key, ...DAMAS_PIECE_SETS[key], locked: !DAMAS_PIECE_SETS[key].free && !premiumActive }));
  }

  function availablePlatformThemes(user) {
    const premiumActive = isPremiumActive(user || readStoredUser());
    return PLATFORM_THEME_ORDER.map((key) => ({ key, ...PLATFORM_THEMES[key], locked: !PLATFORM_THEMES[key].free && !premiumActive }));
  }

  // Vistas previas compartidas (Fase H, roadmap PRO 2.0) -- usadas por
  // settings.html (para elegir) Y collection.html (para mostrar la
  // coleccion completa), asi ninguna de las dos reinventa los mismos
  // mapas de color.
  function themeSwatchColor(themeKey, which) {
    const colors = {
      colonial: { light: '#C9B79C', dark: '#5C3A1E' },
      marmol:   { light: '#EDE7DC', dark: '#8B8478' },
      ebano:    { light: '#3A3630', dark: '#14120F' },
      caoba:    { light: '#D9B98C', dark: '#6B2E1F' },
    };
    return colors[themeKey]?.[which] || '#888';
  }

  // 'clasico'/'dorado' son el set 3D de verdad (assets/pieces/blender/...),
  // 'ornamentado' se previsualiza con un glifo (el set SVG en si vive
  // dentro de script.js, que no tiene sentido cargar aca solo para esto).
  function pieceSetPreviewHtml(key) {
    if (key === 'ornamentado') return '♛';
    const style = key === 'dorado' ? 'gold' : 'white-matte';
    return `<img src="/assets/pieces/blender/${style}/queen.png" alt="">`;
  }

  // Mismos colores que las reglas body[data-damas-piece-set=...] de
  // damas.html, para que la vista previa combine con lo que se ve de
  // verdad en el tablero.
  function damasPieceSetPreviewHtml(key) {
    const colors = {
      clasico: { w: 'radial-gradient(circle at 35% 28%, #FBF3DE, #C8983C 78%)', b: 'radial-gradient(circle at 35% 28%, #4a4038, #050403 82%)' },
      marmol:  { w: 'radial-gradient(circle at 35% 28%, #FFFFFF, #8B8478 80%)', b: 'radial-gradient(circle at 35% 28%, #5C5850, #0D0B08 82%)' },
      bronce:  { w: 'radial-gradient(circle at 35% 28%, #F6D9A0, #6B4712 78%)', b: 'radial-gradient(circle at 35% 28%, #5A2A2A, #100505 82%)' },
    };
    const c = colors[key] || colors.clasico;
    return `<span style="display:flex;gap:4px;"><span style="width:20px;height:20px;border-radius:50%;background:${c.w};box-shadow:0 1px 3px rgba(0,0,0,0.4);"></span><span style="width:20px;height:20px;border-radius:50%;background:${c.b};box-shadow:0 1px 3px rgba(0,0,0,0.4);"></span></span>`;
  }

  return {
    current, applyToDocument, save, availableThemes, cycleBoardTheme, BOARD_THEMES, THEME_ORDER, isPremiumActive,
    availablePieceSets, PIECE_SETS, PIECE_SET_ORDER,
    availableDamasPieceSets, DAMAS_PIECE_SETS, DAMAS_PIECE_SET_ORDER,
    availablePlatformThemes, PLATFORM_THEMES, PLATFORM_THEME_ORDER,
    themeSwatchColor, pieceSetPreviewHtml, damasPieceSetPreviewHtml,
  };
})();

// Aplicar apenas se puede (antes de que el usuario interactue, para
// no mostrar un flash del tema por defecto).
if (document.body) OZAMA_PREFS.applyToDocument();
else document.addEventListener('DOMContentLoaded', () => OZAMA_PREFS.applyToDocument(), { once: true });
