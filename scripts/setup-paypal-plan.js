'use strict';

// Corre esto UNA sola vez para crear el producto + plan mensual de
// OZAMA Premium en tu cuenta de PayPal. Necesita PAYPAL_CLIENT_ID y
// PAYPAL_CLIENT_SECRET en tu .env (los mismos que vas a poner en
// Render). Imprime el Plan ID al final -- ese va en PAYPAL_PLAN_ID.
//
// Uso:
//   node scripts/setup-paypal-plan.js
//   node scripts/setup-paypal-plan.js --price=9.99 --currency=USD
//
// Por defecto usa PAYPAL_ENV=sandbox (no cobra nada real) a menos que
// pongas PAYPAL_ENV=live en el .env cuando ya estes list@ para produccion.

require('dotenv').config();
const { createPremiumProductAndPlan, paypalConfigured } = require('../services/paypal');

async function main() {
  if (!paypalConfigured()) {
    console.error('Falta PAYPAL_CLIENT_ID y/o PAYPAL_CLIENT_SECRET en tu .env');
    process.exit(1);
  }

  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, '').split('=');
      return [key, value];
    })
  );

  const price = args.price || '4.99';
  const currency = args.currency || 'USD';
  const env = String(process.env.PAYPAL_ENV || 'sandbox').trim() || 'sandbox';

  console.log(`Creando producto + plan en PayPal (${env}), precio ${price} ${currency}/mes...`);
  const { product, plan } = await createPremiumProductAndPlan({ price, currency });

  console.log('\nListo.');
  console.log('Product ID:', product.id);
  console.log('Plan ID:   ', plan.id);
  console.log('\nAgrega esto a tus variables de entorno (Render y tu .env local):');
  console.log(`PAYPAL_PLAN_ID=${plan.id}`);
}

main().catch((err) => {
  console.error('Error creando el plan:', err.message);
  if (err.details) console.error(JSON.stringify(err.details, null, 2));
  process.exit(1);
});
