'use strict';

const express              = require('express');
const User                 = require('../models/User');
const Match                = require('../models/Match');
const DamasMatch           = require('../models/DamasMatch');
const Room                 = require('../models/Room');
const Event                = require('../models/Event');
const { requireAuth, userIsAdmin } = require('../middleware/auth');

const router = express.Router();

function validUsername(value) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(String(value || ''));
}

function serverError(res, scope, err) {
  console.error(`[User] ${scope}:`, err.message);
  return res.status(500).json({ error: 'Error interno del servidor.' });
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
      'Exportar tus partidas en formato PGN',
      'Estadisticas avanzadas: color con mas victorias, duracion y aperturas',
      'Analisis post-partida: deteccion de errores graves e imprecisiones',
    ] : [],
  };
}

// Libro de aperturas reducido -- alcanza para reconocer las aperturas
// mas jugadas sin necesitar una base ECO completa. Se matchea contra
// el prefijo de jugadas de la partida (mas jugadas coincidentes =
// nombre mas especifico gana).
const OPENING_BOOK = [
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], name: 'Ruy Lopez' },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: 'Italiana' },
  { moves: ['e4', 'e5', 'Nf3', 'Nf6'], name: 'Petrov' },
  { moves: ['e4', 'e5', 'Nc3'], name: 'Vienesa' },
  { moves: ['e4', 'e5'], name: 'Apertura Abierta (1.e4 e5)' },
  { moves: ['e4', 'c5'], name: 'Siciliana' },
  { moves: ['e4', 'e6'], name: 'Francesa' },
  { moves: ['e4', 'c6'], name: 'Caro-Kann' },
  { moves: ['e4', 'd5'], name: 'Escandinava' },
  { moves: ['e4', 'd6'], name: 'Pirc / Moderna' },
  { moves: ['e4', 'Nf6'], name: 'Alekhine' },
  { moves: ['e4', 'g6'], name: 'Moderna' },
  { moves: ['e4'], name: 'Apertura de Rey (1.e4)' },
  { moves: ['d4', 'd5', 'c4', 'e6'], name: 'Gambito de Dama Rehusado' },
  { moves: ['d4', 'd5', 'c4'], name: 'Gambito de Dama' },
  { moves: ['d4', 'Nf6', 'c4', 'g6'], name: 'India del Rey' },
  { moves: ['d4', 'Nf6', 'c4', 'e6'], name: 'Nimzoindia / India' },
  { moves: ['d4', 'f5'], name: 'Holandesa' },
  { moves: ['d4', 'd5'], name: 'Apertura de Dama Cerrada' },
  { moves: ['d4', 'Nf6'], name: 'Defensa India' },
  { moves: ['d4'], name: 'Apertura de Dama (1.d4)' },
  { moves: ['Nf3'], name: 'Apertura Reti' },
  { moves: ['c4'], name: 'Apertura Inglesa' },
  { moves: ['g3'], name: 'Fianchetto' },
  { moves: ['b3'], name: 'Nimzowitsch-Larsen' },
  { moves: ['f4'], name: 'Gambito Bird' },
];

function detectOpening(pgnText) {
  const tokens = String(pgnText || '')
    .split(/\s+/)
    .filter((t) => t && !/^\d+\.$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .slice(0, 6);
  if (!tokens.length) return null;
  let best = null;
  for (const entry of OPENING_BOOK) {
    if (entry.moves.length > tokens.length) continue;
    let ok = true;
    for (let i = 0; i < entry.moves.length; i++) {
      if (tokens[i] !== entry.moves[i]) { ok = false; break; }
    }
    if (ok && (!best || entry.moves.length > best.moves.length)) best = entry;
  }
  return best ? best.name : null;
}

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
  res.json({ user: { ...req.user.toJSON(), isAdmin: userIsAdmin(req.user) } });
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
      ? 'whitePlayer.userId blackPlayer.userId result startedAt endedAt'
      : 'whitePlayer.userId blackPlayer.userId result pgn startedAt endedAt';

    const matches = await Model.find(filter).select(projection).lean();

    const asWhite = { wins: 0, losses: 0, draws: 0 };
    const asBlack = { wins: 0, losses: 0, draws: 0 };
    let totalDurationMs = 0;
    let durationSamples = 0;
    const openingCounts = new Map();

    for (const m of matches) {
      const isWhite = String(m.whitePlayer?.userId) === String(userId);
      const bucket = isWhite ? asWhite : asBlack;
      if (m.result === 'draw') bucket.draws++;
      else if ((m.result === 'white_win' && isWhite) || (m.result === 'black_win' && !isWhite)) bucket.wins++;
      else bucket.losses++;

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

    res.json({
      game,
      totalGames: matches.length,
      asWhite: { ...asWhite, winRate: rate(asWhite) },
      asBlack: { ...asBlack, winRate: rate(asBlack) },
      avgDurationSec: durationSamples ? Math.round(totalDurationMs / durationSamples / 1000) : null,
      topOpenings,
    });
  } catch (err) {
    serverError(res, 'Advanced stats', err);
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
router.get('/leaderboard', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const players = await User.find(publicLeaderboardFilter())
      .sort({ elo: -1 })
      .limit(20)
      .select('username country avatar avatarImage elo stats plan premiumUntil');

    res.json({ players: players.map((player) => {
      const json = player.toJSON();
      json.premiumActive = isPremiumActive(player);
      delete json.plan;
      delete json.premiumUntil;
      return json;
    }) });
  } catch (err) {
    serverError(res, 'Leaderboard', err);
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

    const friend = await User.findOne({ username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })
      .select('username country avatar avatarImage elo stats');

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
    const friend = await User.findOne({ username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).select('_id');
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

router.get('/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });

    const user = await User.findOne({ username })
      .select('username country avatar avatarImage elo stats plan premiumUntil createdAt');

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const json = user.toJSON();
    json.premiumActive = isPremiumActive(user);
    delete json.plan;
    delete json.premiumUntil;

    res.json({ user: json });
  } catch (err) {
    serverError(res, 'Public profile', err);
  }
});

module.exports = router;
