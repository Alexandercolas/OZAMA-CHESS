'use strict';

const express              = require('express');
const User                 = require('../models/User');
const Match                = require('../models/Match');
const DamasMatch           = require('../models/DamasMatch');
const Room                 = require('../models/Room');
const Event                = require('../models/Event');
const Report                = require('../models/Report');
const { requireAuth, optionalAuth, userIsAdmin } = require('../middleware/auth');
const { ACHIEVEMENTS, ACHIEVEMENT_MAP, levelFromXp, xpIntoLevel } = require('../services/achievements');
const { titleForLevel } = require('../services/titles');
const { detectOpening } = require('../services/openings');
const { FRAMES, framesFor, isValidFrame, isUnlocked } = require('../services/cosmetics');
const { currentSeason } = require('../services/seasons');

const router = express.Router();

function validUsername(value) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(String(value || ''));
}

function serverError(res, scope, err) {
  console.error(`[User] ${scope}:`, err.message);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Busqueda de usuario por nombre exacto (sin importar mayus/minus).
// Antes se repetia este mismo regex en cada endpoint que necesitaba
// resolver un username -- factorizado aca para no seguir duplicando
// (Fase 10 sumo 2 endpoints mas que lo necesitan).
function findUserByUsername(username, select) {
  return User.findOne({ username: { $regex: `^${escapeRegex(username)}$`, $options: 'i' } }).select(select);
}

// Un plan 'premium' vencido (nadie baja el campo `plan` a mano cuando
// PayPal deja de cobrar) NO cuenta como activo -- siempre hay que
// chequear la fecha, nunca confiar solo en el string del plan.
function isPremiumActive(user) {
  if (user?.plan !== 'premium') return false;
  const premiumUntil = user?.premiumUntil ? new Date(user.premiumUntil) : null;
  return !premiumUntil || premiumUntil > new Date();
}

function premiumCapabilities(user) {
  const premiumUntil = user?.premiumUntil ? new Date(user.premiumUntil) : null;
  const premiumActive = isPremiumActive(user);
  return {
    plan: user?.plan || 'free',
    premiumActive,
    premiumUntil,
    subscriptionStatus: user?.subscriptionStatus || 'none',
    benefits: premiumActive ? [
      'Marco dorado + insignia PREMIUM en tu avatar',
      'Temas de tablero exclusivos (Ebano y Caoba)',
      'Set de piezas Dorado en Ajedrez y fichas Bronce Real en Damas',
      'Exportar tus partidas en formato PGN',
      'Estadisticas avanzadas: color con mas victorias, duracion y aperturas',
      'Analisis post-partida en Ajedrez y Damas: deteccion de errores graves e imprecisiones',
    ] : [],
  };
}

// Libro de aperturas reducido -- alcanza para reconocer las aperturas
// mas jugadas sin necesitar una base ECO completa. Se matchea contra
// el prefijo de jugadas de la partida (mas jugadas coincidentes =
// nombre mas especifico gana).
// El catalogo de aperturas (antes vivia aca adentro) se movio a
// services/openings.js para poder reusarlo tambien en el explorador
// publico de aperturas (Fase 9) sin mantener dos copias -- ver ese
// archivo para el catalogo completo y detectOpening().

function publicLeaderboardFilter() {
  return {
    isActive: true,
    username: {
      $nin: ['imgsrconeerror'],
      $not: /^sec[A-D]_\d{8}$/i,
    },
  };
}

// GET /api/user/me - own profile
router.get('/me', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // isAdmin se calcula server-side contra ADMIN_EMAILS (env), nunca se
  // almacena en el documento del usuario: solo el dueno del servidor
  // puede otorgar este flag, cambiando esa variable de entorno.
  res.json({
    user: {
      ...req.user.toJSON(),
      isAdmin: userIsAdmin(req.user),
      globalTitle: titleForLevel(levelFromXp(req.user.xp)),
      season: currentSeason(),
    },
  });
});

router.get('/plan', requireAuth, async (req, res) => {
  res.json(premiumCapabilities(req.user));
});

// Catalogo de temas de tablero -- lista blanca a proposito (Fase 2 del
// roadmap PRO): agregar un tema nuevo mas adelante es sumar una linea
// aca, nunca tocar el resto de la app. free:false = requiere Premium
// activo (se revalida siempre server-side, nunca se confia en lo que
// mande el cliente).
const BOARD_THEMES = {
  colonial: { free: true },
  marmol:   { free: true },
  ebano:    { free: false },
  caoba:    { free: false },
};

// Mismo criterio que BOARD_THEMES, para los sets de piezas de Ajedrez
// (Fase 2 de personalizacion). 'dorado' reusa un set 3D que ya vivia
// en assets/pieces/blender/gold/ sin usarse en ningun lado -- ver
// public/preferences.js para el detalle de por que.
const PIECE_SETS = {
  clasico:     { free: true },
  ornamentado: { free: true },
  dorado:      { free: false },
};

// Fichas de Damas -- catalogo propio, ver public/preferences.js.
const DAMAS_PIECE_SETS = {
  clasico: { free: true },
  marmol:  { free: true },
  bronce:  { free: false },
};

// PATCH /api/user/preferences - personalizacion (tablero, sonido...).
// Whitelist explicita de claves conocidas -- una preferencia nueva se
// agrega sumando un caso aca, nunca reescribiendo el endpoint entero.
router.patch('/preferences', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    const premiumActive = isPremiumActive(req.user);

    if (body.boardTheme !== undefined) {
      const theme = String(body.boardTheme || '').trim();
      const themeDef = BOARD_THEMES[theme];
      if (!themeDef) return res.status(400).json({ error: 'Tema de tablero invalido.' });
      if (!themeDef.free && !premiumActive) {
        return res.status(403).json({ error: 'Ese tema de tablero es exclusivo de OZAMA Premium.' });
      }
      updates['preferences.boardTheme'] = theme;
    }

    if (body.pieceSet !== undefined) {
      const pieceSet = String(body.pieceSet || '').trim();
      const pieceSetDef = PIECE_SETS[pieceSet];
      if (!pieceSetDef) return res.status(400).json({ error: 'Set de piezas invalido.' });
      if (!pieceSetDef.free && !premiumActive) {
        return res.status(403).json({ error: 'Ese set de piezas es exclusivo de OZAMA Premium.' });
      }
      updates['preferences.pieceSet'] = pieceSet;
    }

    if (body.damasPieceSet !== undefined) {
      const damasPieceSet = String(body.damasPieceSet || '').trim();
      const damasPieceSetDef = DAMAS_PIECE_SETS[damasPieceSet];
      if (!damasPieceSetDef) return res.status(400).json({ error: 'Set de fichas invalido.' });
      if (!damasPieceSetDef.free && !premiumActive) {
        return res.status(403).json({ error: 'Ese set de fichas es exclusivo de OZAMA Premium.' });
      }
      updates['preferences.damasPieceSet'] = damasPieceSet;
    }

    if (body.soundMuted !== undefined) {
      if (typeof body.soundMuted !== 'boolean') return res.status(400).json({ error: 'Valor invalido para soundMuted.' });
      updates['preferences.soundMuted'] = body.soundMuted;
    }

    if (body.soundVolume !== undefined) {
      const volume = Number(body.soundVolume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        return res.status(400).json({ error: 'El volumen debe estar entre 0 y 1.' });
      }
      updates['preferences.soundVolume'] = volume;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nada para actualizar.' });
    }

    await User.updateOne({ _id: req.user._id }, { $set: updates });
    const fresh = await User.findById(req.user._id);
    res.json({ preferences: fresh.preferences || {} });
  } catch (err) {
    serverError(res, 'Update preferences', err);
  }
});

// GET /api/user/stats/advanced - beneficio Premium: color con el que
// mas gana, duracion promedio de partida y aperturas mas jugadas.
// Todo se calcula de partidas ya guardadas, no hace falta trackear
// nada nuevo por partida.
router.get('/stats/advanced', requireAuth, async (req, res) => {
  try {
    if (!isPremiumActive(req.user)) {
      return res.status(403).json({ error: 'Las estadisticas avanzadas son un beneficio Premium.', premiumRequired: true });
    }

    res.set('Cache-Control', 'no-store');
    const game = req.query.game === 'damas' ? 'damas' : 'chess';
    const userId = req.user._id;
    const Model = game === 'damas' ? DamasMatch : Match;
    const filter = {
      $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
      result: { $in: ['white_win', 'black_win', 'draw'] },
    };
    const projection = game === 'damas'
      ? 'whitePlayer.userId blackPlayer.userId result reason startedAt endedAt'
      : 'whitePlayer.userId blackPlayer.userId result endReason pgn startedAt endedAt';

    const matches = await Model.find(filter).select(projection).lean();

    const asWhite = { wins: 0, losses: 0, draws: 0 };
    const asBlack = { wins: 0, losses: 0, draws: 0 };
    let totalDurationMs = 0;
    let durationSamples = 0;
    const openingCounts = new Map();
    const winReasonCounts = new Map();
    let winsWithReason = 0;
    let totalWins = 0;

    // Damas: 'no-pieces'/'no-moves' son las dos formas reales de ganar
    // (le quitaste todas las piezas / se quedo sin jugada legal) --
    // 'admin-closed' se excluye del desglose (no es un resultado real
    // de juego). Ajedrez: 'fifty_move'/'stalemate'/'draw_agreed' son
    // razones de TABLAS, no de victoria, se excluyen aca.
    const WIN_REASON_LABELS = {
      checkmate: 'Jaque mate',
      timeout: 'Tiempo agotado',
      resign: 'Abandono del rival',
      abandoned: 'Rival desconectado',
      'no-pieces': 'Capturaste todas las piezas',
      'no-moves': 'Rival sin jugadas',
      'opponent-left': 'Rival desconectado',
    };

    for (const m of matches) {
      const isWhite = String(m.whitePlayer?.userId) === String(userId);
      const bucket = isWhite ? asWhite : asBlack;
      const won = (m.result === 'white_win' && isWhite) || (m.result === 'black_win' && !isWhite);
      if (m.result === 'draw') bucket.draws++;
      else if (won) bucket.wins++;
      else bucket.losses++;

      if (won) {
        totalWins++;
        const reasonKey = game === 'damas' ? m.reason : m.endReason;
        const label = WIN_REASON_LABELS[reasonKey];
        if (label) {
          winsWithReason++;
          winReasonCounts.set(label, (winReasonCounts.get(label) || 0) + 1);
        }
      }

      if (m.startedAt && m.endedAt) {
        const ms = new Date(m.endedAt) - new Date(m.startedAt);
        if (ms > 0 && ms < 24 * 60 * 60 * 1000) { totalDurationMs += ms; durationSamples++; }
      }

      if (game === 'chess' && isWhite && m.pgn) {
        const name = detectOpening(m.pgn);
        if (name) openingCounts.set(name, (openingCounts.get(name) || 0) + 1);
      }
    }

    const rate = (b) => (b.wins + b.losses + b.draws) ? Math.round((b.wins / (b.wins + b.losses + b.draws)) * 100) : 0;
    const topOpenings = [...openingCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // No inventar: si casi ninguna victoria tiene una razon guardada
    // (partidas de antes de que se empezara a trackear endReason en
    // Ajedrez), no se muestra el desglose como si fuera confiable.
    const winReasons = winsWithReason >= 5
      ? [...winReasonCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }))
      : null;

    res.json({
      game,
      totalGames: matches.length,
      asWhite: { ...asWhite, winRate: rate(asWhite) },
      asBlack: { ...asBlack, winRate: rate(asBlack) },
      avgDurationSec: durationSamples ? Math.round(totalDurationMs / durationSamples / 1000) : null,
      topOpenings,
      winReasons,
      totalWins,
    });
  } catch (err) {
    serverError(res, 'Advanced stats', err);
  }
});

// GET /api/user/coach-insights?game=chess|damas - "Entrenador personal"
// (Fase G, roadmap PRO 2.0). Reglas de la fase: nada de recomendaciones
// inventadas -- cada insight sale de datos que YA se guardan (mismo
// query base que /stats/advanced, mas razones de DERROTA y el
// analysisSummary de Fase F) y cada uno tiene su propio umbral minimo
// de muestra antes de mostrarse. Si no hay suficiente, no se inventa
// texto generico: simplemente ese insight no aparece.
router.get('/coach-insights', requireAuth, async (req, res) => {
  try {
    if (!isPremiumActive(req.user)) {
      return res.status(403).json({ error: 'El entrenador personal es un beneficio Premium.', premiumRequired: true });
    }
    res.set('Cache-Control', 'no-store');
    const game = req.query.game === 'damas' ? 'damas' : 'chess';
    const userId = req.user._id;
    const Model = game === 'damas' ? DamasMatch : Match;
    const filter = {
      $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
      result: { $in: ['white_win', 'black_win', 'draw'] },
    };
    const projection = game === 'damas'
      ? 'whitePlayer.userId blackPlayer.userId result reason startedAt endedAt analysisSummary'
      : 'whitePlayer.userId blackPlayer.userId result endReason pgn startedAt endedAt analysisSummary';
    const matches = await Model.find(filter).select(projection).lean();

    const LOSS_REASON_LABELS = game === 'damas'
      ? { 'no-pieces': 'te capturaron todas las piezas', 'no-moves': 'te quedaste sin jugadas', resign: 'te rendiste', 'opponent-left': null }
      : { checkmate: 'jaque mate', timeout: 'se te acabó el tiempo', resign: 'te rendiste', abandoned: null };

    const asWhite = { wins: 0, losses: 0, draws: 0 };
    const asBlack = { wins: 0, losses: 0, draws: 0 };
    const lossReasonCounts = new Map();
    let lossesWithReason = 0, totalLosses = 0;
    let errorSum = 0, analyzedCount = 0;

    for (const m of matches) {
      const isWhite = String(m.whitePlayer?.userId) === String(userId);
      const bucket = isWhite ? asWhite : asBlack;
      const won = (m.result === 'white_win' && isWhite) || (m.result === 'black_win' && !isWhite);
      const lost = !won && m.result !== 'draw';
      if (m.result === 'draw') bucket.draws++;
      else if (won) bucket.wins++;
      else bucket.losses++;

      if (lost) {
        totalLosses++;
        const reasonKey = game === 'damas' ? m.reason : m.endReason;
        const label = LOSS_REASON_LABELS[reasonKey];
        if (label) { lossesWithReason++; lossReasonCounts.set(label, (lossReasonCounts.get(label) || 0) + 1); }
      }

      if (m.analysisSummary?.blunders != null) {
        analyzedCount++;
        errorSum += (m.analysisSummary.blunders + (m.analysisSummary.inaccuracies || 0));
      }
    }

    const rate = (b) => (b.wins + b.losses + b.draws) ? Math.round((b.wins / (b.wins + b.losses + b.draws)) * 100) : 0;
    const whiteGames = asWhite.wins + asWhite.losses + asWhite.draws;
    const blackGames = asBlack.wins + asBlack.losses + asBlack.draws;
    const whiteRate = rate(asWhite), blackRate = rate(asBlack);

    const insights = [];

    // Desequilibrio de color: solo si hay muestra decente de ambos
    // lados Y la diferencia es real (no ruido de pocas partidas).
    if (whiteGames >= 5 && blackGames >= 5 && Math.abs(whiteRate - blackRate) >= 15) {
      const better = whiteRate > blackRate ? 'blancas' : 'negras';
      const worse = whiteRate > blackRate ? 'negras' : 'blancas';
      const betterRate = Math.max(whiteRate, blackRate);
      const worseRate = Math.min(whiteRate, blackRate);
      insights.push({
        icon: '⚖️',
        text: `Jugás bastante mejor con ${better} (${betterRate}% de efectividad) que con ${worse} (${worseRate}%). Practicá más partidas con ${worse} para parejar tu nivel.`,
      });
    }

    // Razon de derrota mas comun: mismo umbral que winReasons en
    // /stats/advanced (>=5), por la misma razon (partidas viejas sin
    // endReason guardado no deben inflar ni faltar en el conteo).
    if (lossesWithReason >= 5) {
      const [topLabel, topCount] = [...lossReasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      const pct = Math.round((topCount / lossesWithReason) * 100);
      if (pct >= 40) {
        insights.push({
          icon: '📉',
          text: `En el ${pct}% de tus derrotas con razón registrada, ${topLabel}. ${topLabel.includes('tiempo') ? 'Practicá jugar con más ritmo para no quedarte corto de reloj.' : 'Prestale atención a ese patrón en tus próximas partidas.'}`,
        });
      }
    }

    // Errores promedio en partidas analizadas: solo si el jugador ya
    // uso "Analizar partida" lo suficiente como para que el promedio
    // signifique algo.
    if (analyzedCount >= 3) {
      const avg = Math.round((errorSum / analyzedCount) * 10) / 10;
      insights.push({
        icon: '🔍',
        text: `En tus últimas ${analyzedCount} partidas analizadas, promediás ${avg} error${avg === 1 ? '' : 'es'} grave${avg === 1 ? '' : 's'} e imprecisiones por partida. Seguí usando "Analizar partida" para ver si ese número baja con el tiempo.`,
      });
    }

    if (!insights.length) {
      return res.json({ game, insights: [], needMoreData: true });
    }
    res.json({ game, insights, needMoreData: false });
  } catch (err) {
    serverError(res, 'Coach insights', err);
  }
});

// POST /api/user/analysis/:game/:roomCode - guarda el resultado del
// analisis post-partida (Premium) sobre la partida ya jugada, para
// que "Mi Analisis" (Fase F) pueda mostrar "partidas con mas errores"
// de verdad -- antes de esto el analisis se perdia apenas se cerraba
// la pagina. Solo online: bot/local nunca tienen un Match guardado al
// que atarlo. Se identifica por roomCode (lo unico que el cliente
// conoce) y se toma la partida MAS RECIENTE de ese codigo donde el
// usuario jugo -- correcto porque el analisis siempre corre justo
// despues de que esa partida termino, antes de que el codigo de sala
// se reuse en una revancha.
router.post('/analysis/:game/:roomCode', requireAuth, async (req, res) => {
  try {
    if (!isPremiumActive(req.user)) {
      return res.status(403).json({ error: 'El analisis post-partida es un beneficio Premium.' });
    }
    const game = req.params.game === 'damas' ? 'damas' : 'chess';
    const roomCode = String(req.params.roomCode || '').toUpperCase().trim();
    if (!roomCode) return res.status(400).json({ error: 'Partida invalida.' });
    const blunders = Number(req.body?.blunders);
    const inaccuracies = Number(req.body?.inaccuracies);
    if (!Number.isInteger(blunders) || blunders < 0 || !Number.isInteger(inaccuracies) || inaccuracies < 0) {
      return res.status(400).json({ error: 'Datos de analisis invalidos.' });
    }

    const Model = game === 'damas' ? DamasMatch : Match;
    const userId = req.user._id;
    const match = await Model.findOne({
      roomCode,
      result: { $ne: 'in_progress' },
      $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
    }).sort({ endedAt: -1, createdAt: -1 }).select('_id');
    if (!match) return res.status(404).json({ error: 'Partida no encontrada.' });

    await Model.updateOne({ _id: match._id }, { $set: {
      analysisSummary: { blunders, inaccuracies, analyzedAt: new Date() },
    }});
    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'Save analysis', err);
  }
});

// GET /api/user/my-analysis?game=chess|damas - "Mi Analisis" (Fase F):
// listas honestas construidas a partir de datos que YA existen --
// nunca se inventa una evaluacion. "Con mas errores" solo mira
// partidas que el jugador (o su rival) realmente analizo.
router.get('/my-analysis', requireAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const game = req.query.game === 'damas' ? 'damas' : 'chess';
    const userId = req.user._id;
    const Model = game === 'damas' ? DamasMatch : Match;
    const filter = {
      $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
      result: { $in: ['white_win', 'black_win', 'draw'] },
    };
    const projection = game === 'damas'
      ? 'whitePlayer blackPlayer result winner startedAt endedAt analysisSummary'
      : 'whitePlayer blackPlayer result winner moves startedAt endedAt analysisSummary';

    const matches = await Model.find(filter).select(projection).sort({ endedAt: -1 }).limit(300).lean();

    function summarize(m) {
      const isWhite = String(m.whitePlayer?.userId) === String(userId);
      const opponent = isWhite ? m.blackPlayer : m.whitePlayer;
      const outcome = m.result === 'draw' ? 'draw'
        : ((m.result === 'white_win' && isWhite) || (m.result === 'black_win' && !isWhite)) ? 'win' : 'loss';
      const durationSec = (m.startedAt && m.endedAt) ? Math.round((new Date(m.endedAt) - new Date(m.startedAt)) / 1000) : null;
      return {
        id: m._id,
        opponentName: opponent?.name || 'Jugador',
        outcome,
        moveCount: game === 'chess' ? (Array.isArray(m.moves) ? m.moves.length : 0) : null,
        durationSec: (durationSec && durationSec > 0 && durationSec < 24 * 3600) ? durationSec : null,
        endedAt: m.endedAt,
        errors: m.analysisSummary?.blunders != null ? (m.analysisSummary.blunders + (m.analysisSummary.inaccuracies || 0)) : null,
      };
    }

    const summarized = matches.map(summarize);
    const recent = summarized.slice(0, 8);
    const withDuration = summarized.filter((m) => m.durationSec != null);
    const longest = [...withDuration].sort((a, b) => b.durationSec - a.durationSec).slice(0, 5);
    const shortest = [...withDuration].sort((a, b) => a.durationSec - b.durationSec).slice(0, 5);
    const analyzed = summarized.filter((m) => m.errors != null);
    const mostErrors = [...analyzed].sort((a, b) => b.errors - a.errors).slice(0, 5);

    res.json({
      game,
      totalGames: summarized.length,
      recent,
      longest,
      shortest,
      mostErrors,
      analyzedCount: analyzed.length,
    });
  } catch (err) {
    serverError(res, 'My analysis', err);
  }
});

// Rango cosmetico segun ELO -- mismos nombres que ya usan los niveles
// del bot, para que el ladder de rangos se sienta parte de la misma
// familia (Centinela es el nivel de bot por defecto Y el rango de
// arranque, con el ELO inicial de 1200). Puramente de exhibicion, no
// cambia ningun calculo de ELO real.
const RANK_TIERS = [
  { min: 1800, name: 'Alcázar' },
  { min: 1400, name: 'Maestro' },
  { min: 1000, name: 'Centinela' },
  { min: -Infinity, name: 'Aprendiz' },
];
function rankTier(elo) {
  return (RANK_TIERS.find((t) => elo >= t.min) || RANK_TIERS[RANK_TIERS.length - 1]).name;
}

// GET /api/user/profile-stats - tarjeta de identidad del jugador
// (Fase 3 del roadmap PRO). A diferencia de /stats/advanced, esto es
// gratis para todos -- son datos de identidad del perfil, no un
// beneficio Premium.
router.get('/profile-stats', requireAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const userId = req.user._id;
    const finishedFilter = {
      $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
      result: { $in: ['white_win', 'black_win', 'draw'] },
    };

    const [chessMatches, damasMatches] = await Promise.all([
      Match.find(finishedFilter).select('startedAt endedAt moves').lean(),
      DamasMatch.find(finishedFilter).select('startedAt endedAt').lean(),
    ]);

    function durationSecOf(list) {
      let totalMs = 0;
      for (const m of list) {
        if (!m.startedAt || !m.endedAt) continue;
        const ms = new Date(m.endedAt) - new Date(m.startedAt);
        if (ms > 0 && ms < 24 * 60 * 60 * 1000) totalMs += ms;
      }
      return totalMs / 1000;
    }

    const chessTimeSec = durationSecOf(chessMatches);
    const damasTimeSec = durationSecOf(damasMatches);
    const totalGames = chessMatches.length + damasMatches.length;

    const avgMoves = chessMatches.length
      ? Math.round(chessMatches.reduce((sum, m) => sum + (Array.isArray(m.moves) ? m.moves.length : 0), 0) / chessMatches.length)
      : null;

    let favoriteMode = null;
    if (chessMatches.length || damasMatches.length) {
      favoriteMode = chessMatches.length === damasMatches.length ? 'parejo' : (chessMatches.length > damasMatches.length ? 'chess' : 'damas');
    }

    res.json({
      rank: rankTier(req.user.elo),
      damasRank: rankTier(req.user.damasElo),
      totalGames,
      totalTimePlayedSec: Math.round(chessTimeSec + damasTimeSec),
      favoriteMode,
      chessGames: chessMatches.length,
      damasGames: damasMatches.length,
      xp: req.user.xp || 0,
      level: levelFromXp(req.user.xp),
      xpIntoLevel: xpIntoLevel(req.user.xp),
      globalTitle: titleForLevel(levelFromXp(req.user.xp)),
      achievementsUnlocked: (req.user.achievements || []).length,
      achievementsTotal: ACHIEVEMENTS.length,
      style: {
        avgMovesPerGame: avgMoves,
        // Todavia no se trackea posicion/complejidad por jugada, asi
        // que en vez de inventar un numero, esto queda explicitamente
        // sin dato -- el frontend muestra "Sin datos suficientes".
        aggressiveness: null,
        endgamePerformance: null,
        timePressurePerformance: null,
      },
    });
  } catch (err) {
    serverError(res, 'Profile stats', err);
  }
});

// GET /api/user/achievements - catalogo completo (Fase 4 del roadmap
// PRO), con cuales ya desbloqueo el jugador -- asi el perfil puede
// mostrar los bloqueados tambien, no solo los conseguidos.
router.get('/achievements', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const unlockedMap = new Map((req.user.achievements || []).map((a) => [a.key, a.unlockedAt]));
  res.json({
    achievements: ACHIEVEMENTS.map((a) => ({
      key: a.key,
      name: a.name,
      description: a.description,
      icon: a.icon,
      unlocked: unlockedMap.has(a.key),
      unlockedAt: unlockedMap.get(a.key) || null,
    })),
  });
});

// GET /api/user/frames - coleccion de marcos de perfil (Fase 13).
router.get('/frames', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ frames: framesFor(req.user, levelFromXp) });
});

// PATCH /api/user/frames/:key - equipar un marco ya desbloqueado.
router.patch('/frames/:key', requireAuth, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!isValidFrame(key)) return res.status(400).json({ error: 'Marco invalido.' });

    const frame = FRAMES.find((f) => f.key === key);
    const level = levelFromXp(req.user.xp);
    const achievementKeys = new Set((req.user.achievements || []).map((a) => a.key));
    if (!isUnlocked(frame, { level, achievementKeys })) {
      return res.status(403).json({ error: 'Todavia no desbloqueaste ese marco.' });
    }

    await User.updateOne({ _id: req.user._id }, { $set: { equippedFrame: key } });
    res.json({ equippedFrame: key });
  } catch (err) {
    serverError(res, 'Equip frame', err);
  }
});

// PATCH /api/user/me - update profile
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const allowed = ['country', 'avatar', 'avatarImage'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.avatarImage !== undefined) {
      const image = String(updates.avatarImage || '');
      if (image && !/^data:image\/(png|jpeg|webp);base64,/.test(image)) {
        return res.status(400).json({ error: 'Formato de foto invalido.' });
      }
      if (image.length > 450000) {
        return res.status(413).json({ error: 'La foto es demasiado grande.' });
      }
      updates.avatarImage = image;
    }
    if (updates.country !== undefined) {
      const country = String(updates.country || '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: 'Pais invalido.' });
      updates.country = country;
    }
    if (updates.avatar !== undefined) {
      const avatar = Number(updates.avatar);
      if (!Number.isInteger(avatar) || avatar < 0 || avatar > 12) {
        return res.status(400).json({ error: 'Avatar invalido.' });
      }
      updates.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({ user });
  } catch (err) {
    console.error('[User] Update profile:', err.message);
    res.status(400).json({ error: 'Datos de perfil invalidos.' });
  }
});

// GET /api/user/history - match history
router.get('/history', requireAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const userId = req.user._id;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(20, parseInt(req.query.limit) || 10);

    const filter = {
      $or: [
        { 'whitePlayer.userId': userId },
        { 'blackPlayer.userId': userId },
      ],
      result: { $ne: 'in_progress' },
    };

    const [matches, total] = await Promise.all([
      Match.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Match.countDocuments(filter),
    ]);

    res.json({ matches, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    serverError(res, 'History', err);
  }
});

// GET /api/user/damas-history - historial de Damas (ranking propio,
// separado del de ajedrez)
router.get('/damas-history', requireAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const userId = req.user._id;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(20, parseInt(req.query.limit) || 10);

    const filter = {
      $or: [
        { 'whitePlayer.userId': userId },
        { 'blackPlayer.userId': userId },
      ],
    };

    const [matches, total] = await Promise.all([
      DamasMatch.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DamasMatch.countDocuments(filter),
    ]);

    res.json({ matches, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    serverError(res, 'DamasHistory', err);
  }
});

// GET /api/user/leaderboard - top 20 by ELO
router.get('/leaderboard', optionalAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const players = await User.find(publicLeaderboardFilter())
      .sort({ elo: -1 })
      .limit(20)
      .select('username country avatar avatarImage elo stats plan premiumUntil');

    const payload = {
      season: currentSeason(),
      players: players.map((player) => {
        const json = player.toJSON();
        json.premiumActive = isPremiumActive(player);
        delete json.plan;
        delete json.premiumUntil;
        return json;
      }),
    };

    // Si el que pide el ranking esta logueado y no aparece en el top
    // 20, le decimos igual en que puesto esta -- para eso no hace
    // falta traer a todo el mundo, solo contar cuantos le ganan.
    if (req.user) {
      const isInTop = payload.players.some((p) => String(p._id) === String(req.user._id));
      if (!isInTop) {
        const ahead = await User.countDocuments({ ...publicLeaderboardFilter(), elo: { $gt: req.user.elo } });
        payload.yourRank = ahead + 1;
        payload.yourElo = req.user.elo;
      }
    }

    res.json(payload);
  } catch (err) {
    serverError(res, 'Leaderboard', err);
  }
});

// GET /api/user/leaderboard/climbers?period=week|month - quienes mas
// ELO subieron en los ultimos 7/30 dias. Distinto del ranking
// general a proposito (no es solo el top de siempre filtrado) --
// reconstruye el ELO de arranque del periodo a partir de las partidas
// ya guardadas, sin trackear nada nuevo por partida.
router.get('/leaderboard/climbers', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const period = req.query.period === 'month' ? 'month' : 'week';
    const days = period === 'month' ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    async function baselinesFor(Model, isChess) {
      const matches = await Model.find({
        endedAt: { $gte: cutoff },
        result: { $in: ['white_win', 'black_win', 'draw'] },
      }).sort({ endedAt: 1 }).select('whitePlayer.userId whitePlayer.elo blackPlayer.userId blackPlayer.elo eloChange').lean();

      const baseline = new Map(); // userId -> elo justo antes de su primera partida del periodo
      for (const m of matches) {
        for (const side of ['white', 'black']) {
          const player = m[`${side}Player`];
          const uid = player?.userId ? String(player.userId) : null;
          if (!uid || baseline.has(uid)) continue;
          const snapshotElo = Number(player.elo || 0);
          const change = Number(m.eloChange?.[side] || 0);
          // Ajedrez guarda el ELO YA actualizado en el snapshot de la
          // partida; Damas guarda el de ANTES -- ver comentario en
          // finishDamasGame(). Se normaliza aca para que ambos den la
          // misma base: el ELO justo antes de esta partida.
          baseline.set(uid, isChess ? snapshotElo - change : snapshotElo);
        }
      }
      return baseline;
    }

    const [chessBaseline, damasBaseline] = await Promise.all([
      baselinesFor(Match, true),
      baselinesFor(DamasMatch, false),
    ]);

    const userIds = new Set([...chessBaseline.keys(), ...damasBaseline.keys()]);
    if (!userIds.size) return res.json({ period, climbers: [] });

    const users = await User.find({ _id: { $in: [...userIds] }, ...publicLeaderboardFilter() })
      .select('username country avatar avatarImage elo damasElo');

    const climbers = users.map((u) => {
      const id = String(u._id);
      const chessGain = chessBaseline.has(id) ? u.elo - chessBaseline.get(id) : null;
      const damasGain = damasBaseline.has(id) ? u.damasElo - damasBaseline.get(id) : null;
      const gain = Math.max(chessGain ?? -Infinity, damasGain ?? -Infinity);
      return {
        username: u.username, country: u.country, avatar: u.avatar, avatarImage: u.avatarImage,
        gain, chessGain, damasGain,
      };
    })
      .filter((c) => c.gain > 0)
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 20);

    res.json({ period, climbers });
  } catch (err) {
    serverError(res, 'Climbers leaderboard', err);
  }
});

// GET /api/user/elo-history?game=chess|damas - serie historica para
// graficar, reconstruida de las partidas ya guardadas (ver nota sobre
// ajedrez vs Damas en /leaderboard/climbers -- misma logica aca).
router.get('/elo-history', requireAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const game = req.query.game === 'damas' ? 'damas' : 'chess';
    const Model = game === 'damas' ? DamasMatch : Match;
    const userId = req.user._id;

    const matches = await Model.find({
      $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
      result: { $in: ['white_win', 'black_win', 'draw'] },
    }).sort({ endedAt: 1 }).limit(200).select('whitePlayer.userId whitePlayer.elo blackPlayer.elo eloChange endedAt').lean();

    const history = matches.map((m) => {
      const isWhite = String(m.whitePlayer?.userId) === String(userId);
      const snapshotElo = Number((isWhite ? m.whitePlayer?.elo : m.blackPlayer?.elo) || 0);
      const change = Number((isWhite ? m.eloChange?.white : m.eloChange?.black) || 0);
      const eloAfter = game === 'chess' ? snapshotElo : snapshotElo + change;
      return { date: m.endedAt, elo: eloAfter, change };
    });

    res.json({ game, history });
  } catch (err) {
    serverError(res, 'Elo history', err);
  }
});

// PUT /api/user/password - change password with active session
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Contrasena actual y nueva contrasena son obligatorias.' });
    }
    if (String(newPassword).length < 8 || String(newPassword).length > 128) {
      return res.status(400).json({ error: 'La nueva contrasena debe tener entre 8 y 128 caracteres.' });
    }

    const user = await User.findById(req.user._id).select('+password +tokenVersion');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ error: 'Contrasena actual incorrecta.' });

    user.password = newPassword;
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    await user.save();

    res.json({ message: 'Contrasena actualizada correctamente.' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.get('/friends', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'username country avatar avatarImage elo stats lastSeenAt')
      .select('friends')
      .lean();

    res.json({ friends: user?.friends || [] });
  } catch (err) {
    serverError(res, 'Friends list', err);
  }
});

router.post('/friends/:username', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Usuario requerido.' });
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });

    const friend = await findUserByUsername(username, 'username country avatar avatarImage elo stats');

    if (!friend) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (friend._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'No puedes agregarte a ti mismo.' });
    }

    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $addToSet: { friends: friend._id } }),
      User.updateOne({ _id: friend._id }, { $addToSet: { friends: req.user._id } }),
    ]);

    res.json({ friend });
  } catch (err) {
    serverError(res, 'Add friend', err);
  }
});

router.delete('/friends/:username', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });
    const friend = await findUserByUsername(username, '_id');
    if (!friend) return res.status(404).json({ error: 'Usuario no encontrado.' });

    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $pull: { friends: friend._id } }),
      User.updateOne({ _id: friend._id }, { $pull: { friends: req.user._id } }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'Remove friend', err);
  }
});

// POST /api/user/:username/report - denuncia (Fase 10). Se guarda
// para que un admin la revise (ver routes/admin.js) -- no toma
// ninguna accion automatica sobre la cuenta reportada.
router.post('/:username/report', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });

    const reported = await findUserByUsername(username, '_id');
    if (!reported) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (String(reported._id) === String(req.user._id)) {
      return res.status(400).json({ error: 'No puedes reportarte a ti mismo.' });
    }

    const reason = String(req.body?.reason || '').trim();
    if (!Report.REASONS.includes(reason)) return res.status(400).json({ error: 'Motivo invalido.' });
    const note = String(req.body?.note || '').trim().slice(0, 500);

    // Un reporte por dia por (denunciante, denunciado) -- evita spam
    // sin bloquear a alguien que de verdad necesita reportar de nuevo
    // otro dia.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await Report.findOne({ reporter: req.user._id, reported: reported._id, createdAt: { $gte: since } });
    if (recent) return res.status(429).json({ error: 'Ya reportaste a este jugador recientemente.' });

    await Report.create({ reporter: req.user._id, reported: reported._id, reason, note });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'Report user', err);
  }
});

// GET /api/user/blocked - lista de jugadores que bloqueaste.
router.get('/blocked', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('blockedUsers', 'username country avatar avatarImage').select('blockedUsers').lean();
    res.json({ blocked: user?.blockedUsers || [] });
  } catch (err) {
    serverError(res, 'Blocked list', err);
  }
});

// POST/DELETE /api/user/:username/block - bloqueo unidireccional
// (Fase 10). Hoy solo impide que la persona bloqueada te desafie
// (ver server.js, challenge-send) -- todavia no filtra emparejamiento
// automatico ni el chat en vivo, eso queda para una pasada futura.
router.post('/:username/block', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });
    const target = await findUserByUsername(username, '_id');
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (String(target._id) === String(req.user._id)) return res.status(400).json({ error: 'No puedes bloquearte a ti mismo.' });

    await User.updateOne({ _id: req.user._id }, { $addToSet: { blockedUsers: target._id } });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'Block user', err);
  }
});

router.delete('/:username/block', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });
    const target = await findUserByUsername(username, '_id');
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });

    await User.updateOne({ _id: req.user._id }, { $pull: { blockedUsers: target._id } });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'Unblock user', err);
  }
});

// DELETE /api/user/me - permanently remove the account and personal data.
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const confirmation = String(req.body.confirmation || '').trim().toUpperCase();

    if (!currentPassword || confirmation !== 'ELIMINAR') {
      return res.status(400).json({ error: 'Confirma tu contrasena y escribe ELIMINAR.' });
    }
    if (currentPassword.length > 128) {
      return res.status(400).json({ error: 'Contrasena invalida.' });
    }

    const userId = req.user._id;
    const user = await User.findById(userId).select('+password');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const validPassword = await user.comparePassword(currentPassword);
    if (!validPassword) return res.status(401).json({ error: 'Contrasena incorrecta.' });

    const deletedPlayer = {
      userId: null,
      name: 'Jugador eliminado',
      country: '--',
      avatar: 0,
      avatarImage: '',
    };

    await Promise.all([
      User.updateMany({ friends: userId }, { $pull: { friends: userId } }),
      Match.updateMany({ 'whitePlayer.userId': userId }, {
        $set: {
          'whitePlayer.userId': deletedPlayer.userId,
          'whitePlayer.name': deletedPlayer.name,
          'whitePlayer.country': deletedPlayer.country,
          'whitePlayer.avatar': deletedPlayer.avatar,
          'whitePlayer.avatarImage': deletedPlayer.avatarImage,
        },
      }),
      Match.updateMany({ 'blackPlayer.userId': userId }, {
        $set: {
          'blackPlayer.userId': deletedPlayer.userId,
          'blackPlayer.name': deletedPlayer.name,
          'blackPlayer.country': deletedPlayer.country,
          'blackPlayer.avatar': deletedPlayer.avatar,
          'blackPlayer.avatarImage': deletedPlayer.avatarImage,
        },
      }),
      Room.updateMany({ 'players.white.userId': userId }, {
        $set: {
          'players.white.userId': null,
          'players.white.name': deletedPlayer.name,
          'players.white.country': deletedPlayer.country,
          'players.white.avatar': 0,
          'players.white.avatarImage': '',
        },
      }),
      Room.updateMany({ 'players.black.userId': userId }, {
        $set: {
          'players.black.userId': null,
          'players.black.name': deletedPlayer.name,
          'players.black.country': deletedPlayer.country,
          'players.black.avatar': 0,
          'players.black.avatarImage': '',
        },
      }),
      Event.updateMany({ createdBy: userId }, { $set: { createdBy: null } }),
    ]);

    await User.deleteOne({ _id: userId });

    const io = req.app.get('io');
    if (io?.sockets?.sockets) {
      for (const [, socket] of io.sockets.sockets) {
        if (String(socket.data?.userId || '') === String(userId)) socket.disconnect(true);
      }
    }

    return res.json({ ok: true, message: 'Cuenta eliminada correctamente.' });
  } catch (err) {
    return serverError(res, 'Delete account', err);
  }
});

// GET /api/user/:username - perfil publico (Fase 10 lo extendio con
// ELO/estadisticas de Damas, nivel y logros -- el shape original con
// solo ajedrez ya existia y quedo sin uso desde el cliente, asi que
// se pudo ampliar sin romper a nadie). Sin auth: pensado para
// compartir, igual que /api/matches/:id/public (Fase 6). optionalAuth
// solo se usa para poder marcar isSelf/isBlocked cuando hay sesion.
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });

    const user = await User.findOne({ username })
      .select('username country avatar avatarImage elo damasElo stats damasStats xp achievements plan premiumUntil createdAt isActive equippedFrame');

    if (!user || !user.isActive) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const json = user.toJSON();
    json.premiumActive = isPremiumActive(user);
    json.rank = rankTier(user.elo);
    json.damasRank = rankTier(user.damasElo);
    json.level = levelFromXp(user.xp);
    json.globalTitle = titleForLevel(json.level);
    json.achievementsUnlocked = (user.achievements || []).length;
    // Insignias para la tarjeta de jugador (Fase C del roadmap PRO
    // 2.0) -- los logros en si no son informacion privada (son para
    // mostrar), asi que se resuelven nombre/icono contra el catalogo y
    // se mandan los mas recientes. La FECHA de cada logro no se manda
    // (no aporta nada publico y es un dato mas para filtrar).
    json.badges = [...(user.achievements || [])]
      .sort((a, b) => new Date(b.unlockedAt) - new Date(a.unlockedAt))
      .slice(0, 8)
      .map((a) => ACHIEVEMENT_MAP.get(a.key))
      .filter(Boolean)
      .map((a) => ({ key: a.key, name: a.name, icon: a.icon }));
    delete json.plan;
    delete json.premiumUntil;
    delete json.achievements;

    const isBlocked = req.user ? (req.user.blockedUsers || []).some((id) => String(id) === String(user._id)) : false;

    res.json({
      user: json,
      isSelf: req.user ? String(req.user._id) === String(user._id) : false,
      isBlocked,
    });
  } catch (err) {
    serverError(res, 'Public profile', err);
  }
});

module.exports = router;
