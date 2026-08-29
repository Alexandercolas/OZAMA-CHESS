'use strict';

// reCAPTCHA v3 (invisible, basada en puntuacion) para el registro --
// protege contra registro masivo automatizado sin ponerle un
// rompecabezas a alguien que se registra normal. Mismo patron que
// services/google-auth.js: la clave publica (site key) sale de un
// endpoint /providers, la clave secreta nunca sale del servidor.
//
// Si RECAPTCHA_SECRET_KEY no esta configurada (dev local, o mientras
// se termina de armar en produccion), la verificacion se salta por
// completo -- igual que el login con Google, es una capa opcional,
// no algo que deba romper el registro si no esta configurada.

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const MIN_SCORE = 0.5;

function recaptchaProviderConfig() {
  const siteKey = String(process.env.RECAPTCHA_SITE_KEY || '').trim();
  return {
    enabled: Boolean(siteKey),
    siteKey,
  };
}

// Devuelve true si el registro puede seguir, false si hay que
// rechazarlo. Nunca tira -- un error de red o de Google no debe
// tumbar el registro completo, simplemente no bloquea (fail-open),
// igual de estricto que dejar la proteccion apagada.
async function verifyRecaptchaToken(token, { action = 'register', remoteip } = {}) {
  const secret = String(process.env.RECAPTCHA_SECRET_KEY || '').trim();
  if (!secret) return true; // proteccion no configurada, no bloquea

  const clean = String(token || '').trim();
  if (!clean || clean.length > 4000) return false;

  try {
    const params = new URLSearchParams({ secret, response: clean });
    if (remoteip) params.set('remoteip', remoteip);

    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!response.ok) return true; // Google no respondio bien -- no tumbar el registro por eso

    const data = await response.json();
    if (!data.success) return false;
    if (action && data.action && data.action !== action) return false;
    if (typeof data.score === 'number' && data.score < MIN_SCORE) return false;
    return true;
  } catch (_) {
    return true; // error de red hacia Google -- no tumbar el registro por eso
  }
}

module.exports = {
  recaptchaProviderConfig,
  verifyRecaptchaToken,
};
