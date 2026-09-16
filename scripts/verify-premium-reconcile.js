'use strict';

// Prueba de "Premium/PRO" (Fase 24 del roadmap "OZAMA PRO"): la
// auditoria de Fase 0 ya encontro este sistema como IMPLEMENTADO y
// solido (PayPal siempre reverificado server-side, webhook firmado,
// ningun beneficio Premium toca ELO/matchmaking) con un solo hueco
// real: "no hay reconciliacion periodica que resincronice el estado
// si un webhook de PayPal se pierde". Concretamente, si
// PAYMENT.SALE.COMPLETED (la renovacion mensual) nunca llega,
// premiumUntil no se extiende y un usuario que SIGUE pagando pierde el
// acceso igual.
//
// services/paypal.js:maybeReconcilePremium() cierra ese hueco con el
// MISMO principio que services/seasons.js (nunca un cron de verdad --
// se reconsulta contra PayPal solo cuando hace falta, con throttle en
// memoria por usuario). Se prueba llamando la funcion directo (sin
// levantar server.js -- no depende de sockets/HTTP, igual que
// verify-seasons-flow.js) contra una Mongo real aislada y temporal,
// con un fetchFn inyectado en vez de pegarle a la API real de PayPal:
//
//   - premiumUntil ya vencido + subscriptionStatus 'active' (webhook
//     de renovacion perdido) + PayPal dice que la suscripcion SIGUE
//     ACTIVE -> extiende premiumUntil, el usuario recupera el acceso;
//   - throttle: dos llamadas seguidas para el mismo usuario solo le
//     pegan a PayPal una vez;
//   - premiumUntil todavia vigente -> nunca llama a PayPal (nada que
//     reconciliar, cero trafico de mas en el camino comun);
//   - subscriptionStatus ya 'cancelled' (webhook de cancelacion SI
//     llego) -> nunca llama a PayPal, isPremiumActive ya lo maneja
//     por fecha;
//   - PayPal confirma que la suscripcion ya NO esta activa de verdad
//     -> sincroniza subscriptionStatus a 'cancelled';
//   - PayPal no responde (null) -> no toca nada, nunca le apaga el
//     premium a alguien por un error transitorio de red.
//
// Uso: node scripts/verify-premium-reconcile.js

require('dotenv').config();
const mongoose = require('mongoose');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_premium' });

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  await mongoose.connect(isolatedMongo.uri, { dbName: isolatedMongo.dbName });
  console.log(`DB=${isolatedMongo.dbName}`);

  const User = require('../models/User');
  const { maybeReconcilePremium } = require('../services/paypal');

  try {
    const suffix = String(Date.now()).slice(-8);
    const yesterday = new Date(Date.now() - 86400000);
    const tomorrow = new Date(Date.now() + 86400000);

    // ═══════ Webhook de renovacion perdido -- PayPal dice que sigue ACTIVE ═══════
    const u1 = await User.create({
      username: `premU1_${suffix}`, email: `premu1_${suffix}@example.test`, password: 'CorrectHorse99!',
      plan: 'premium', premiumUntil: yesterday, subscriptionStatus: 'active', paypalSubscriptionId: `SUB-1-${suffix}`,
    });
    let calls1 = 0;
    const nextBilling = new Date(Date.now() + 30 * 86400000);
    const fetchFn1 = async () => { calls1++; return { status: 'ACTIVE', billing_info: { next_billing_time: nextBilling.toISOString() } }; };

    await maybeReconcilePremium(u1, { fetchFn: fetchFn1 });
    assert(calls1 === 1, `deberia haber consultado PayPal una vez, consulto ${calls1}`);
    const u1After = await User.findById(u1._id).select('premiumUntil subscriptionStatus').lean();
    assert(new Date(u1After.premiumUntil).getTime() === nextBilling.getTime(), `premiumUntil deberia extenderse a la nueva fecha, quedo ${u1After.premiumUntil}`);
    assert(u1After.subscriptionStatus === 'active', 'subscriptionStatus deberia seguir active');
    assert(new Date(u1.premiumUntil).getTime() === nextBilling.getTime(), 'el objeto en memoria (usado para la respuesta HTTP) tambien deberia reflejar el arreglo');
    console.log('reconcile: webhook de renovacion perdido -> premiumUntil se extiende, el usuario recupera el acceso.');

    // ═══════ Throttle: una segunda llamada inmediata no vuelve a pegarle a PayPal ═══════
    await User.updateOne({ _id: u1._id }, { $set: { premiumUntil: yesterday } }); // simula que volvio a vencer
    u1.premiumUntil = yesterday;
    await maybeReconcilePremium(u1, { fetchFn: fetchFn1 });
    assert(calls1 === 1, `el throttle deberia evitar una segunda consulta tan pronto, consulto ${calls1} veces en total`);
    console.log('reconcile: throttle en memoria evita pegarle a PayPal dos veces seguidas para el mismo usuario.');

    // ═══════ premiumUntil vigente -- nunca consulta PayPal ═══════
    const u2 = await User.create({
      username: `premU2_${suffix}`, email: `premu2_${suffix}@example.test`, password: 'CorrectHorse99!',
      plan: 'premium', premiumUntil: tomorrow, subscriptionStatus: 'active', paypalSubscriptionId: `SUB-2-${suffix}`,
    });
    let calls2 = 0;
    await maybeReconcilePremium(u2, { fetchFn: async () => { calls2++; return null; } });
    assert(calls2 === 0, `premiumUntil vigente no deberia generar trafico a PayPal, se llamo ${calls2} veces`);
    console.log('reconcile: premiumUntil todavia vigente -> cero trafico a PayPal (camino comun, sin overhead).');

    // ═══════ subscriptionStatus ya 'cancelled' (webhook SI llego) -- nunca consulta PayPal ═══════
    const u3 = await User.create({
      username: `premU3_${suffix}`, email: `premu3_${suffix}@example.test`, password: 'CorrectHorse99!',
      plan: 'premium', premiumUntil: yesterday, subscriptionStatus: 'cancelled', paypalSubscriptionId: `SUB-3-${suffix}`,
    });
    let calls3 = 0;
    await maybeReconcilePremium(u3, { fetchFn: async () => { calls3++; return null; } });
    assert(calls3 === 0, `ya sincronizado por webhook, no deberia consultar PayPal, se llamo ${calls3} veces`);
    console.log('reconcile: cancelacion ya confirmada por webhook -> tampoco genera trafico de mas.');

    // ═══════ PayPal confirma que de verdad ya no esta activa ═══════
    const u4 = await User.create({
      username: `premU4_${suffix}`, email: `premu4_${suffix}@example.test`, password: 'CorrectHorse99!',
      plan: 'premium', premiumUntil: yesterday, subscriptionStatus: 'active', paypalSubscriptionId: `SUB-4-${suffix}`,
    });
    await maybeReconcilePremium(u4, { fetchFn: async () => ({ status: 'CANCELLED' }) });
    const u4After = await User.findById(u4._id).select('subscriptionStatus').lean();
    assert(u4After.subscriptionStatus === 'cancelled', `PayPal confirmo que no esta activa -> subscriptionStatus deberia sincronizarse a 'cancelled', quedo '${u4After.subscriptionStatus}'`);
    console.log('reconcile: PayPal confirma la cancelacion real -> subscriptionStatus se sincroniza.');

    // ═══════ PayPal no responde -- no toca nada ═══════
    const u5 = await User.create({
      username: `premU5_${suffix}`, email: `premu5_${suffix}@example.test`, password: 'CorrectHorse99!',
      plan: 'premium', premiumUntil: yesterday, subscriptionStatus: 'active', paypalSubscriptionId: `SUB-5-${suffix}`,
    });
    await maybeReconcilePremium(u5, { fetchFn: async () => null });
    const u5After = await User.findById(u5._id).select('premiumUntil subscriptionStatus').lean();
    assert(new Date(u5After.premiumUntil).getTime() === yesterday.getTime(), 'PayPal inalcanzable -> premiumUntil no deberia tocarse');
    assert(u5After.subscriptionStatus === 'active', "PayPal inalcanzable -> subscriptionStatus no deberia tocarse");
    console.log('reconcile: PayPal no responde -> no se le apaga el premium a nadie por un error transitorio.');

    console.log('\n✅ PREMIUM_RECONCILE_OK');
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ PREMIUM_RECONCILE_FAILED:', err.message);
  process.exit(1);
});
