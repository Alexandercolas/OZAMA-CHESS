'use strict';

// ================================================================
// SECTION 0: SOUND SYSTEM — Web Audio API
// ================================================================
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; _audioCtx = new AC(); }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
document.addEventListener('click', () => getAudioCtx(), { once: true });

function playSound(name) {
  try {
    const ctx = getAudioCtx();
    switch (name) {
      case 'move':     _soundMove(ctx);     break;
      case 'capture':  _soundCapture(ctx);  break;
      case 'check':    _soundCheck(ctx);    break;
      case 'castle':   _soundCastle(ctx);   break;
      case 'gameover': _soundGameover(ctx); break;
    }
  } catch(e) {}
}

function _soundMove(ctx) {
  _noise(ctx,{duration:.055,vol:.13,filter:520,type:'lowpass'});
  _tone(ctx,{type:'triangle',freq:210,endFreq:128,vol:.16,duration:.12});
  _tone(ctx,{type:'sine',freq:920,endFreq:620,vol:.045,duration:.055,delay:.018});
}
function _soundCapture(ctx) {
  _noise(ctx,{duration:.035,vol:.34,filter:2600,type:'highpass'});
  _noise(ctx,{duration:.16,vol:.24,filter:620,type:'lowpass',delay:.012});
  _tone(ctx,{type:'sawtooth',freq:170,endFreq:58,vol:.28,duration:.25,delay:.006});
  _tone(ctx,{type:'square',freq:1420,endFreq:780,vol:.08,duration:.055,delay:.018});
  _tone(ctx,{type:'triangle',freq:420,endFreq:210,vol:.08,duration:.12,delay:.06});
}
function _soundCheck(ctx) {
  _tone(ctx,{type:'square',freq:520,endFreq:520,vol:.11,duration:.09});
  _tone(ctx,{type:'square',freq:690,endFreq:690,vol:.11,duration:.09,delay:.105});
  _tone(ctx,{type:'sine',freq:1380,endFreq:910,vol:.055,duration:.22,delay:.02});
}
function _soundCastle(ctx) {
  _noise(ctx,{duration:.09,vol:.16,filter:430,type:'lowpass'});
  _tone(ctx,{type:'triangle',freq:180,endFreq:96,vol:.18,duration:.15});
  _noise(ctx,{duration:.07,vol:.13,filter:580,type:'lowpass',delay:.12});
  _tone(ctx,{type:'triangle',freq:240,endFreq:118,vol:.16,duration:.14,delay:.12});
}
function _soundGameover(ctx) {
  _noise(ctx,{duration:.5,vol:.08,filter:360,type:'lowpass',delay:.04});
  [{freq:260,delay:0},{freq:207,delay:.18},{freq:155,delay:.36},{freq:98,delay:.56}]
    .forEach(({freq,delay})=>_tone(ctx,{type:'triangle',freq,endFreq:Math.max(50,freq*.62),vol:.14,duration:.82,delay}));
  _tone(ctx,{type:'sine',freq:740,endFreq:420,vol:.055,duration:.9,delay:.08});
}
function _tone(ctx,{type,freq,endFreq,vol,duration,delay=0}){
  const t=ctx.currentTime+delay, osc=ctx.createOscillator(), env=ctx.createGain();
  osc.connect(env); env.connect(ctx.destination);
  osc.type=type; osc.frequency.setValueAtTime(freq,t);
  if(endFreq!==freq) osc.frequency.exponentialRampToValueAtTime(endFreq,t+duration);
  env.gain.setValueAtTime(vol,t); env.gain.exponentialRampToValueAtTime(.0001,t+duration);
  osc.start(t); osc.stop(t+duration+.01);
}
function _noise(ctx,{duration,vol,filter,type='bandpass',delay=0}){
  const t=ctx.currentTime+delay;
  const buffer=ctx.createBuffer(1,Math.max(1,Math.floor(ctx.sampleRate*duration)),ctx.sampleRate);
  const data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*(1-i/data.length);
  const src=ctx.createBufferSource(), biquad=ctx.createBiquadFilter(), env=ctx.createGain();
  src.buffer=buffer; biquad.type=type; biquad.frequency.setValueAtTime(filter,t);
  src.connect(biquad); biquad.connect(env); env.connect(ctx.destination);
  env.gain.setValueAtTime(vol,t); env.gain.exponentialRampToValueAtTime(.0001,t+duration);
  src.start(t); src.stop(t+duration+.01);
}

// ================================================================
// SECTION 1: CONFIG & CONSTANTS
// ================================================================
const CONFIG = { BOARD_SIZE:8, PIECE_PATH:'./assets/pieces/', USE_INLINE_SVG:true, BOARD_FLIPPED:false };
const PIECE  = { PAWN:'p', KNIGHT:'n', BISHOP:'b', ROOK:'r', QUEEN:'q', KING:'k' };
const COLOR  = { WHITE:'w', BLACK:'b' };
const STATUS = { PLAYING:'playing', CHECK:'check', CHECKMATE:'checkmate', STALEMATE:'stalemate', DRAW:'draw' };

// ================================================================
// SECTION 2: SVG PIECE ASSETS
// ================================================================
const PIECE_SVGS = {
  wp:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wpg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wph" cx="28%" cy="22%" r="45%"><stop offset="0%" stop-color="rgba(255,250,230,0.7)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><rect x="9.5" y="35.5" width="26" height="4.5" rx="1" fill="url(#wpg)" stroke="#7A5218" stroke-width="1.3"/><rect x="9.5" y="35.5" width="26" height="1.2" rx="0.5" fill="rgba(255,245,210,0.3)"/><path d="M18.5 35Q17 26.5 22.5 23Q28 26.5 26.5 35Z" fill="url(#wpg)" stroke="#7A5218" stroke-width="1.3"/><ellipse cx="22.5" cy="24" rx="4.5" ry="1.2" fill="#C89040" stroke="#7A5218" stroke-width="0.8"/><circle cx="22.5" cy="10.5" r="8" fill="url(#wpg)" stroke="#7A5218" stroke-width="1.4"/><circle cx="22.5" cy="10.5" r="8" fill="url(#wph)"/><ellipse cx="19.5" cy="7.5" rx="3" ry="2" fill="rgba(255,252,235,0.5)"/></svg>`,
  wn:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wng" cx="38%" cy="30%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wnh" cx="30%" cy="25%" r="50%"><stop offset="0%" stop-color="rgba(255,250,230,0.6)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><path d="M21.5 39H8.5L10.5 30Q7.5 24 9.5 17Q11.5 10.5 17.5 7.5Q20 5.5 23.5 7.5Q28.5 5.5 30.5 10.5Q32.5 14.5 29.5 18L34.5 22Q32.5 27.5 27.5 29L26.5 39Z" fill="url(#wng)" stroke="#7A5218" stroke-width="1.4"/><path d="M21.5 39H8.5L10.5 30Q7.5 24 9.5 17Q11.5 10.5 17.5 7.5Q20 5.5 23.5 7.5Q28.5 5.5 30.5 10.5Q32.5 14.5 29.5 18L34.5 22Q32.5 27.5 27.5 29L26.5 39Z" fill="url(#wnh)"/><circle cx="19.5" cy="13.5" r="2.5" fill="#5C3A0A"/><circle cx="19.5" cy="13.5" r="1" fill="#3A2006"/><path d="M17.5 8.5Q15.5 5 11.5 6.5Q9.5 9.5 13.5 13" fill="url(#wng)" stroke="#7A5218" stroke-width="1"/><path d="M14 26Q18.5 24 24 25" stroke="rgba(122,82,24,0.35)" stroke-width="1" fill="none"/></svg>`,
  wb:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wbg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wbh" cx="30%" cy="22%" r="50%"><stop offset="0%" stop-color="rgba(255,250,230,0.65)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><rect x="8.5" y="36" width="28" height="4" rx="1" fill="url(#wbg)" stroke="#7A5218" stroke-width="1.3"/><path d="M14.5 36Q12.5 34 12.5 33L32.5 33Q32.5 34 30.5 36Z" fill="url(#wbg)" stroke="#7A5218" stroke-width="1"/><path d="M22.5 12.5Q29 17 30 23Q31 30.5 27.5 33L17.5 33Q14 30.5 15 23Q16 17 22.5 12.5Z" fill="url(#wbg)" stroke="#7A5218" stroke-width="1.3"/><path d="M22.5 12.5Q29 17 30 23Q31 30.5 27.5 33L17.5 33Q14 30.5 15 23Q16 17 22.5 12.5Z" fill="url(#wbh)"/><line x1="17.5" y1="24" x2="27.5" y2="24" stroke="rgba(122,82,24,0.32)" stroke-width="1"/><ellipse cx="22.5" cy="14" rx="3.5" ry="1.2" fill="#C89040" stroke="#7A5218" stroke-width="0.8"/><circle cx="22.5" cy="8.5" r="4.5" fill="url(#wbg)" stroke="#7A5218" stroke-width="1.3"/><circle cx="22.5" cy="8.5" r="4.5" fill="url(#wbh)"/><circle cx="22.5" cy="6" r="1.5" fill="#C89040" stroke="#7A5218" stroke-width="0.7"/><ellipse cx="20" cy="7" rx="2" ry="1.3" fill="rgba(255,252,235,0.5)"/></svg>`,
  wr:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wrg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><linearGradient id="wrh" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="rgba(255,250,230,0.28)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></linearGradient></defs><rect x="8" y="35" width="29" height="5" rx="1" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><path d="M10 34L13.5 34L13.5 17L31.5 17L31.5 34L35 34L35 15L10 15Z" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><path d="M10 34L13.5 34L13.5 17L31.5 17L31.5 34L35 34L35 15L10 15Z" fill="url(#wrh)"/><line x1="20.5" y1="19" x2="20.5" y2="33" stroke="rgba(122,82,24,0.28)" stroke-width="0.9"/><line x1="24.5" y1="19" x2="24.5" y2="33" stroke="rgba(122,82,24,0.28)" stroke-width="0.9"/><rect x="9" y="7.5" width="7" height="9" rx="0.8" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><rect x="19.5" y="7.5" width="6" height="9" rx="0.8" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><rect x="29.5" y="7.5" width="7" height="9" rx="0.8" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><rect x="10" y="8.5" width="5" height="1.5" rx="0.3" fill="rgba(255,248,220,0.35)"/></svg>`,
  wq:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wqg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wqh" cx="30%" cy="25%" r="50%"><stop offset="0%" stop-color="rgba(255,250,230,0.55)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><rect x="7.5" y="35.5" width="30" height="4.5" rx="1" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.3"/><path d="M10.5 35.5Q15.5 34 22.5 34.5Q29.5 34 34.5 35.5L34.5 33.5Q29.5 31.5 22.5 32Q15.5 31.5 10.5 33.5Z" fill="url(#wqg)" stroke="#7A5218" stroke-width="1"/><path d="M8 14.5L10.5 32Q16 28.5 22.5 30Q29 28.5 34.5 32L37 14.5L31 22L22.5 12L14 22Z" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.4"/><path d="M8 14.5L10.5 32Q16 28.5 22.5 30Q29 28.5 34.5 32L37 14.5L31 22L22.5 12L14 22Z" fill="url(#wqh)"/><circle cx="7.5" cy="12.5" r="4" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.3"/><circle cx="7.5" cy="12.5" r="4" fill="url(#wqh)"/><circle cx="15" cy="9.5" r="3.2" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.2"/><circle cx="22.5" cy="7.5" r="4" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.3"/><circle cx="22.5" cy="7.5" r="4" fill="url(#wqh)"/><circle cx="30" cy="9.5" r="3.2" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.2"/><circle cx="37.5" cy="12.5" r="4" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.3"/><circle cx="37.5" cy="12.5" r="4" fill="url(#wqh)"/><circle cx="20.5" cy="5.5" r="1.6" fill="rgba(255,252,235,0.55)"/></svg>`,
  wk:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wkg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wkh" cx="30%" cy="25%" r="55%"><stop offset="0%" stop-color="rgba(255,250,230,0.55)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><rect x="9" y="35.5" width="27" height="4.5" rx="1" fill="url(#wkg)" stroke="#7A5218" stroke-width="1.3"/><path d="M11.5 35.5Q10 25 13.5 20Q17.5 16 22.5 16Q27.5 16 31.5 20Q35 25 33.5 35.5Z" fill="url(#wkg)" stroke="#7A5218" stroke-width="1.4"/><path d="M11.5 35.5Q10 25 13.5 20Q17.5 16 22.5 16Q27.5 16 31.5 20Q35 25 33.5 35.5Z" fill="url(#wkh)"/><line x1="13" y1="24" x2="32" y2="24" stroke="rgba(122,82,24,0.28)" stroke-width="0.9"/><rect x="14" y="14.5" width="17" height="3.5" rx="1" fill="#C89040" stroke="#7A5218" stroke-width="0.9"/><rect x="20.5" y="2" width="4.5" height="15" rx="1.8" fill="url(#wkg)" stroke="#7A5218" stroke-width="1.4"/><rect x="20.5" y="2" width="4.5" height="15" rx="1.8" fill="url(#wkh)"/><rect x="14.5" y="5.5" width="16" height="5" rx="1.8" fill="url(#wkg)" stroke="#7A5218" stroke-width="1.4"/><rect x="14.5" y="5.5" width="16" height="5" rx="1.8" fill="url(#wkh)"/><rect x="21.5" y="3" width="2" height="5" rx="1" fill="rgba(255,252,235,0.55)"/></svg>`,
  bp:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="bpg" cx="32%" cy="26%" r="70%"><stop offset="0%" stop-color="#3A3028"/><stop offset="40%" stop-color="#1C1610"/><stop offset="75%" stop-color="#100D08"/><stop offset="100%" stop-color="#060504"/></radialGradient><radialGradient id="bph" cx="28%" cy="22%" r="45%"><stop offset="0%" stop-color="rgba(200,152,60,0.32)"/><stop offset="100%" stop-color="rgba(200,152,60,0)"/></radialGradient></defs><rect x="9.5" y="35.5" width="26" height="4.5" rx="1" fill="url(#bpg)" stroke="#C8983C" stroke-width="1.6"/><rect x="9.5" y="35.5" width="26" height="1.2" rx="0.5" fill="rgba(200,152,60,0.25)"/><path d="M18.5 35Q17 26.5 22.5 23Q28 26.5 26.5 35Z" fill="url(#bpg)" stroke="#C8983C" stroke-width="1.5"/><ellipse cx="22.5" cy="24" rx="4.5" ry="1.2" fill="#6B5018" stroke="#C8983C" stroke-width="0.9"/><circle cx="22.5" cy="10.5" r="8" fill="url(#bpg)" stroke="#C8983C" stroke-width="1.6"/><circle cx="22.5" cy="10.5" r="8" fill="url(#bph)"/><ellipse cx="19" cy="7.5" rx="3" ry="2" fill="rgba(200,152,60,0.22)"/></svg>`,
  bn:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="bng" cx="35%" cy="28%" r="70%"><stop offset="0%" stop-color="#3A3028"/><stop offset="40%" stop-color="#1C1610"/><stop offset="75%" stop-color="#100D08"/><stop offset="100%" stop-color="#060504"/></radialGradient><radialGradient id="bnh" cx="30%" cy="22%" r="50%"><stop offset="0%" stop-color="rgba(200,152,60,0.28)"/><stop offset="100%" stop-color="rgba(200,152,60,0)"/></radialGradient></defs><path d="M21.5 39H8.5L10.5 30Q7.5 24 9.5 17Q11.5 10.5 17.5 7.5Q20 5.5 23.5 7.5Q28.5 5.5 30.5 10.5Q32.5 14.5 29.5 18L34.5 22Q32.5 27.5 27.5 29L26.5 39Z" fill="url(#bng)" stroke="#C8983C" stroke-width="1.6"/><path d="M21.5 39H8.5L10.5 30Q7.5 24 9.5 17Q11.5 10.5 17.5 7.5Q20 5.5 23.5 7.5Q28.5 5.5 30.5 10.5Q32.5 14.5 29.5 18L34.5 22Q32.5 27.5 27.5 29L26.5 39Z" fill="url(#bnh)"/><circle cx="19.5" cy="13.5" r="2.5" fill="#C8983C"/><circle cx="19.5" cy="13.5" r="1.1" fill="#7A5518"/><path d="M17.5 8.5Q15.5 5 11.5 6.5Q9.5 9.5 13.5 13" fill="url(#bng)" stroke="#C8983C" stroke-width="1.1"/><path d="M14 26Q18.5 24 24 25" stroke="rgba(200,152,60,0.3)" stroke-width="1" fill="none"/><ellipse cx="27" cy="21" rx="3.5" ry="2" fill="rgba(200,152,60,0.18)" transform="rotate(-20 27 21)"/></svg>`,
  bb:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="bbg" cx="32%" cy="26%" r="70%"><stop offset="0%" stop-color="#3A3028"/><stop offset="40%" stop-color="#1C1610"/><stop offset="75%" stop-color="#100D08"/><stop offset="100%" stop-color="#060504"/></radialGradient><radialGradient id="bbh" cx="28%" cy="22%" r="50%"><stop offset="0%" stop-color="rgba(200,152,60,0.28)"/><stop offset="100%" stop-color="rgba(200,152,60,0)"/></radialGradient></defs><rect x="8.5" y="36" width="28" height="4" rx="1" fill="url(#bbg)" stroke="#C8983C" stroke-width="1.6"/><path d="M14.5 36Q12.5 34 12.5 33L32.5 33Q32.5 34 30.5 36Z" fill="url(#bbg)" stroke="#C8983C" stroke-width="1.1"/><path d="M22.5 12.5Q29 17 30 23Q31 30.5 27.5 33L17.5 33Q14 30.5 15 23Q16 17 22.5 12.5Z" fill="url(#bbg)" stroke="#C8983C" stroke-width="1.5"/><path d="M22.5 12.5Q29 17 30 23Q31 30.5 27.5 33L17.5 33Q14 30.5 15 23Q16 17 22.5 12.5Z" fill="url(#bbh)"/><line x1="17.5" y1="24" x2="27.5" y2="24" stroke="rgba(200,152,60,0.4)" stroke-width="1.2"/><ellipse cx="22.5" cy="14" rx="3.5" ry="1.2" fill="#6B5018" stroke="#C8983C" stroke-width="0.9"/><circle cx="22.5" cy="8.5" r="4.5" fill="url(#bbg)" stroke="#C8983C" stroke-width="1.5"/><circle cx="22.5" cy="8.5" r="4.5" fill="url(#bbh)"/><circle cx="22.5" cy="6" r="1.5" fill="#C8983C"/><ellipse cx="20" cy="7" rx="2" ry="1.3" fill="rgba(200,152,60,0.22)"/></svg>`,
  br:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="brg" cx="32%" cy="26%" r="70%"><stop offset="0%" stop-color="#3A3028"/><stop offset="40%" stop-color="#1C1610"/><stop offset="75%" stop-color="#100D08"/><stop offset="100%" stop-color="#060504"/></radialGradient><linearGradient id="brh" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="rgba(200,152,60,0.25)"/><stop offset="100%" stop-color="rgba(200,152,60,0)"/></linearGradient></defs><rect x="8" y="35" width="29" height="5" rx="1" fill="url(#brg)" stroke="#C8983C" stroke-width="1.6"/><rect x="8" y="35" width="29" height="1.5" rx="0.5" fill="rgba(200,152,60,0.22)"/><path d="M10 34L13.5 34L13.5 17L31.5 17L31.5 34L35 34L35 15L10 15Z" fill="url(#brg)" stroke="#C8983C" stroke-width="1.5"/><path d="M10 34L13.5 34L13.5 17L31.5 17L31.5 34L35 34L35 15L10 15Z" fill="url(#brh)"/><line x1="20.5" y1="19" x2="20.5" y2="33" stroke="rgba(200,152,60,0.25)" stroke-width="0.9"/><line x1="24.5" y1="19" x2="24.5" y2="33" stroke="rgba(200,152,60,0.25)" stroke-width="0.9"/><line x1="13.5" y1="25" x2="31.5" y2="25" stroke="rgba(200,152,60,0.2)" stroke-width="0.9"/><rect x="9" y="7.5" width="7" height="9" rx="0.8" fill="url(#brg)" stroke="#C8983C" stroke-width="1.6"/><rect x="19.5" y="7.5" width="6" height="9" rx="0.8" fill="url(#brg)" stroke="#C8983C" stroke-width="1.6"/><rect x="29.5" y="7.5" width="7" height="9" rx="0.8" fill="url(#brg)" stroke="#C8983C" stroke-width="1.6"/><rect x="10" y="8.5" width="5" height="1.5" rx="0.3" fill="rgba(200,152,60,0.22)"/></svg>`,
  bq:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="bqg" cx="32%" cy="26%" r="70%"><stop offset="0%" stop-color="#3A3028"/><stop offset="40%" stop-color="#1C1610"/><stop offset="75%" stop-color="#100D08"/><stop offset="100%" stop-color="#060504"/></radialGradient><radialGradient id="bqh" cx="28%" cy="22%" r="50%"><stop offset="0%" stop-color="rgba(200,152,60,0.25)"/><stop offset="100%" stop-color="rgba(200,152,60,0)"/></radialGradient></defs><rect x="7.5" y="35.5" width="30" height="4.5" rx="1" fill="url(#bqg)" stroke="#C8983C" stroke-width="1.6"/><rect x="7.5" y="35.5" width="30" height="1.2" rx="0.5" fill="rgba(200,152,60,0.22)"/><path d="M10.5 35.5Q15.5 34 22.5 34.5Q29.5 34 34.5 35.5L34.5 33.5Q29.5 31.5 22.5 32Q15.5 31.5 10.5 33.5Z" fill="url(#bqg)" stroke="#C8983C" stroke-width="1.1"/><path d="M8 14.5L10.5 32Q16 28.5 22.5 30Q29 28.5 34.5 32L37 14.5L31 22L22.5 12L14 22Z" fill="url(#bqg)" stroke="#C8983C" stroke-width="1.6"/><path d="M8 14.5L10.5 32Q16 28.5 22.5 30Q29 28.5 34.5 32L37 14.5L31 22L22.5 12L14 22Z" fill="url(#bqh)"/><circle cx="7.5" cy="12.5" r="4" fill="url(#bqg)" stroke="#C8983C" stroke-width="1.6"/><circle cx="7.5" cy="12.5" r="4" fill="url(#bqh)"/><circle cx="15" cy="9.5" r="3.2" fill="url(#bqg)" stroke="#C8983C" stroke-width="1.4"/><circle cx="22.5" cy="7.5" r="4" fill="url(#bqg)" stroke="#C8983C" stroke-width="1.6"/><circle cx="22.5" cy="7.5" r="4" fill="url(#bqh)"/><circle cx="30" cy="9.5" r="3.2" fill="url(#bqg)" stroke="#C8983C" stroke-width="1.4"/><circle cx="37.5" cy="12.5" r="4" fill="url(#bqg)" stroke="#C8983C" stroke-width="1.6"/><circle cx="37.5" cy="12.5" r="4" fill="url(#bqh)"/><circle cx="20.5" cy="5.8" r="1.5" fill="rgba(200,152,60,0.38)"/></svg>`,
  bk:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="bkg" cx="32%" cy="26%" r="70%"><stop offset="0%" stop-color="#3A3028"/><stop offset="40%" stop-color="#1C1610"/><stop offset="75%" stop-color="#100D08"/><stop offset="100%" stop-color="#060504"/></radialGradient><radialGradient id="bkh" cx="28%" cy="22%" r="55%"><stop offset="0%" stop-color="rgba(200,152,60,0.25)"/><stop offset="100%" stop-color="rgba(200,152,60,0)"/></radialGradient></defs><rect x="9" y="35.5" width="27" height="4.5" rx="1" fill="url(#bkg)" stroke="#C8983C" stroke-width="1.6"/><rect x="9" y="35.5" width="27" height="1.2" rx="0.5" fill="rgba(200,152,60,0.22)"/><path d="M11.5 35.5Q10 25 13.5 20Q17.5 16 22.5 16Q27.5 16 31.5 20Q35 25 33.5 35.5Z" fill="url(#bkg)" stroke="#C8983C" stroke-width="1.6"/><path d="M11.5 35.5Q10 25 13.5 20Q17.5 16 22.5 16Q27.5 16 31.5 20Q35 25 33.5 35.5Z" fill="url(#bkh)"/><line x1="13" y1="24" x2="32" y2="24" stroke="rgba(200,152,60,0.28)" stroke-width="0.9"/><line x1="12" y1="29" x2="33" y2="29" stroke="rgba(200,152,60,0.2)" stroke-width="0.9"/><rect x="14" y="14.5" width="17" height="3.5" rx="1" fill="#6B5018" stroke="#C8983C" stroke-width="0.9"/><rect x="20.5" y="2" width="4.5" height="15" rx="1.8" fill="url(#bkg)" stroke="#C8983C" stroke-width="1.6"/><rect x="20.5" y="2" width="4.5" height="15" rx="1.8" fill="url(#bkh)"/><rect x="14.5" y="5.5" width="16" height="5" rx="1.8" fill="url(#bkg)" stroke="#C8983C" stroke-width="1.6"/><rect x="14.5" y="5.5" width="16" height="5" rx="1.8" fill="url(#bkh)"/><rect x="21.5" y="3" width="2" height="5" rx="1" fill="rgba(200,152,60,0.3)"/></svg>`,
};

// ================================================================
// SECTION 3: GAME STATE
// ================================================================
const ROOM_CODE = sessionStorage.getItem('ozama-room') || '';
const RAW_PLAYER_COLOR = sessionStorage.getItem('ozama-color') || '';
const PLAYER_COLOR = RAW_PLAYER_COLOR === 'white' ? COLOR.WHITE
  : RAW_PLAYER_COLOR === 'black' ? COLOR.BLACK
  : RAW_PLAYER_COLOR;
let IS_ONLINE = !!(ROOM_CODE && (PLAYER_COLOR === COLOR.WHITE || PLAYER_COLOR === COLOR.BLACK));
const IS_BOT_MODE = !IS_ONLINE && sessionStorage.getItem('ozama-bot-mode') === 'true';
const BOT_COLOR = sessionStorage.getItem('ozama-bot-color') || COLOR.BLACK;
const BOT_LEVEL = sessionStorage.getItem('ozama-bot-difficulty') || 'medium';
let _botThinking = false;
let socket = null;
let _applyingRemoteMove = false;
let _onlineReady = !IS_ONLINE;

let state = {
  board:[], turn:COLOR.WHITE, selected:null, legalMoves:[],
  castlingRights:{ w:{kingside:true,queenside:true}, b:{kingside:true,queenside:true} },
  enPassantTarget:null, status:STATUS.PLAYING, winner:null,
  moveCount:0, halfMoveClock:0, moveHistory:[],
  promotionPending:null, _pendingHistoryEntry:null,
  lastMove:null, _autoPromotionPiece:null, _finishReported:false,
  _pendingOnlineMove:null,
  capturedByW:[], capturedByB:[],
};

// ================================================================
// SECTION 3.5: CLOCK SYSTEM
// ================================================================
const CLOCK = (() => {
  let _intervalId = null;
  let _times = { w: 600000, b: 600000 };

  function _fmt(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function _render() {
    const wText = _fmt(_times.w);
    const bText = _fmt(_times.b);
    ['clock-white', 'clock-white-v', 'oz-clock-white'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = wText; el.style.color = _times.w < 10000 ? '#ef4444' : ''; }
    });
    ['clock-black', 'clock-black-v', 'oz-clock-black'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = bText; el.style.color = _times.b < 10000 ? '#ef4444' : ''; }
    });
  }

  function stop() { if (_intervalId) { clearInterval(_intervalId); _intervalId = null; } }

  function start(color) {
    stop();
    _intervalId = setInterval(() => {
      _times[color] = Math.max(0, _times[color] - 1000);
      _render();
      const remaining = Math.ceil(_times[color] / 1000);
      if (remaining <= 10 && remaining > 0) {
        try {
          const ctx = getAudioCtx();
          _tone(ctx, { type:'sine', freq: remaining <= 3 ? 880 : 660, endFreq: remaining <= 3 ? 880 : 660, vol: 0.15, duration: 0.08 });
        } catch(e) {}
      }
      if (_times[color] === 0) stop();
    }, 1000);
  }

  function switchTo(color) { start(color); }
  function set(w, b) { _times.w = w; _times.b = b; _render(); }

  return { start, stop, switchTo, set };
})();

// ================================================================
// SECTION 4: BOARD INITIALIZATION
// ================================================================
function createInitialBoard() {
  const board=Array.from({length:8},()=>Array(8).fill(null));
  const br=[PIECE.ROOK,PIECE.KNIGHT,PIECE.BISHOP,PIECE.QUEEN,PIECE.KING,PIECE.BISHOP,PIECE.KNIGHT,PIECE.ROOK];
  br.forEach((type,col)=>{ board[0][col]={type,color:COLOR.BLACK}; board[7][col]={type,color:COLOR.WHITE}; });
  for(let col=0;col<8;col++){ board[1][col]={type:PIECE.PAWN,color:COLOR.BLACK}; board[6][col]={type:PIECE.PAWN,color:COLOR.WHITE}; }
  return board;
}

function startNewGame() {
  state.board=createInitialBoard(); state.turn=COLOR.WHITE; state.selected=null; state.legalMoves=[];
  state.castlingRights={w:{kingside:true,queenside:true},b:{kingside:true,queenside:true}};
  state.enPassantTarget=null; state.status=STATUS.PLAYING; state.winner=null;
  state.moveCount=0; state.halfMoveClock=0; state.moveHistory=[];
  state.promotionPending=null; state._pendingHistoryEntry=null;
  state.lastMove=null; state._autoPromotionPiece=null; state._finishReported=false;
  state._pendingOnlineMove=null;
  state.capturedByW=[]; state.capturedByB=[];
  renderBoard(); updateStatusDisplay();
  CLOCK.set(600000, 600000);
  if (!IS_ONLINE) CLOCK.start(COLOR.WHITE);
  setTimeout(()=>maybeScheduleBotMove(),120);
}

// ================================================================
// SECTION 5: UTILITY HELPERS
// ================================================================
function inBounds(r,c){return r>=0&&r<8&&c>=0&&c<8;}
function enemy(color){return color===COLOR.WHITE?COLOR.BLACK:COLOR.WHITE;}
function cloneBoard(b){return b.map(r=>r.map(c=>c ? {...c} : null));}

function normalizeBoardSnapshot(board){
  if(!Array.isArray(board)||board.length!==8) return null;
  const normalized=board.map(row=>{
    if(!Array.isArray(row)||row.length!==8) return null;
    return row.map(piece=>{
      if(!piece) return null;
      if(!Object.values(PIECE).includes(piece.type)||!Object.values(COLOR).includes(piece.color)) return null;
      return {type:piece.type,color:piece.color};
    });
  });
  return normalized.some(row=>!row)?null:normalized;
}

function capturedFromBoard(board){
  const base={p:8,n:2,b:2,r:2,q:1,k:1};
  const seen={w:{p:0,n:0,b:0,r:0,q:0,k:0},b:{p:0,n:0,b:0,r:0,q:0,k:0}};
  board.flat().forEach(piece=>{ if(piece) seen[piece.color][piece.type]=(seen[piece.color][piece.type]||0)+1; });
  const capturedByW=[], capturedByB=[];
  [PIECE.QUEEN,PIECE.ROOK,PIECE.BISHOP,PIECE.KNIGHT,PIECE.PAWN].forEach(type=>{
    const missingWhite=Math.max(0,(base[type]||0)-(seen.w[type]||0));
    const missingBlack=Math.max(0,(base[type]||0)-(seen.b[type]||0));
    for(let i=0;i<missingBlack;i++) capturedByW.push({type,color:COLOR.BLACK});
    for(let i=0;i<missingWhite;i++) capturedByB.push({type,color:COLOR.WHITE});
  });
  return {capturedByW,capturedByB};
}

function restoreGameSnapshot(snapshot,{clockW,clockB}={}){
  const board=normalizeBoardSnapshot(snapshot?.board);
  if(!board) return false;
  state.board=board;
  state.turn=snapshot.turn===COLOR.BLACK?COLOR.BLACK:COLOR.WHITE;
  state.selected=null; state.legalMoves=[];
  state.castlingRights=snapshot.castlingRights||{w:{kingside:true,queenside:true},b:{kingside:true,queenside:true}};
  state.enPassantTarget=snapshot.enPassantTarget||null;
  state.status=STATUS.PLAYING; state.winner=null;
  state.moveCount=Number(snapshot.moveCount)||0;
  state.halfMoveClock=Number(snapshot.halfMoveClock)||0;
  state.moveHistory=[];
  state.promotionPending=null; state._pendingHistoryEntry=null;
  state.lastMove=snapshot.lastMove||null;
  state._autoPromotionPiece=null; state._finishReported=false; state._pendingOnlineMove=null;
  const captures=capturedFromBoard(board);
  state.capturedByW=captures.capturedByW;
  state.capturedByB=captures.capturedByB;
  CLOCK.stop();
  if(Number.isFinite(clockW)&&Number.isFinite(clockB)) CLOCK.set(clockW,clockB);
  renderBoard(); updateStatusDisplay();
  return true;
}

function findKing(board,color){
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(board[r][c]?.type===PIECE.KING&&board[r][c]?.color===color) return{row:r,col:c};
  return null;
}

function toAlgebraic(r,c){return'abcdefgh'[c]+String(8-r);}

function getMoveNotation(entry){
  const{from,to,piece,captured,castling,enPassant,promotion,check,checkmate,boardBefore,epTargetBefore}=entry;
  const SYM={p:'',n:'N',b:'B',r:'R',q:'Q',k:'K'};
  const suffix=checkmate?'#':check?'+':'';
  const isCap=!!(captured||enPassant);
  if(castling==='kingside')  return'O-O'+suffix;
  if(castling==='queenside') return'O-O-O'+suffix;
  const dest=toAlgebraic(to.row,to.col), capX=isCap?'x':'';
  if(piece.type===PIECE.PAWN){
    let n=isCap?'abcdefgh'[from.col]+'x'+dest:dest;
    if(promotion) n+='='+(SYM[promotion].toUpperCase()||'Q');
    return n+suffix;
  }
  let disambig='';
  if(boardBefore){
    const tr={castlingRights:{w:{kingside:false,queenside:false},b:{kingside:false,queenside:false}},enPassantTarget:epTargetBefore||null};
    const amb=[];
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      if(r===from.row&&c===from.col) continue;
      const p=boardBefore[r][c];
      if(p?.type===piece.type&&p.color===piece.color){
        const lm=getLegalMovesForSquare(boardBefore,r,c,tr);
        if(lm.some(m=>m.row===to.row&&m.col===to.col)) amb.push({row:r,col:c});
      }
    }
    if(amb.length>0){
      const sf=amb.some(p=>p.col===from.col), sr=amb.some(p=>p.row===from.row);
      if(!sf) disambig='abcdefgh'[from.col];
      else if(!sr) disambig=String(8-from.row);
      else disambig=toAlgebraic(from.row,from.col);
    }
  }
  return SYM[piece.type]+disambig+capX+dest+suffix;
}

// ================================================================
// SECTION 6: MOVE GENERATION
// ================================================================
function getPseudoLegalMoves(board,row,col,gsr){
  const piece=board[row][col]; if(!piece) return [];
  switch(piece.type){
    case PIECE.PAWN:   return getPawnMoves(board,row,col,piece.color,gsr);
    case PIECE.KNIGHT: return getKnightMoves(board,row,col,piece.color);
    case PIECE.BISHOP: return getSlidingMoves(board,row,col,piece.color,[[-1,-1],[-1,1],[1,-1],[1,1]]);
    case PIECE.ROOK:   return getSlidingMoves(board,row,col,piece.color,[[-1,0],[1,0],[0,-1],[0,1]]);
    case PIECE.QUEEN:  return getSlidingMoves(board,row,col,piece.color,[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    case PIECE.KING:   return getKingMoves(board,row,col,piece.color,gsr);
    default: return [];
  }
}

function getPawnMoves(board,row,col,color,gsr){
  const moves=[],dir=color===COLOR.WHITE?-1:1,sr=color===COLOR.WHITE?6:1,r1=row+dir;
  if(inBounds(r1,col)&&!board[r1][col]){
    moves.push({row:r1,col});
    const r2=row+dir*2;
    if(row===sr&&!board[r2][col]) moves.push({row:r2,col});
  }
  for(const dc of[-1,1]){const c=col+dc; if(inBounds(r1,c)&&board[r1][c]?.color&&board[r1][c]?.color!==color) moves.push({row:r1,col:c});}
  if(gsr.enPassantTarget){const ep=gsr.enPassantTarget; if(ep.row===r1&&Math.abs(ep.col-col)===1) moves.push({row:r1,col:ep.col,enPassant:true});}
  return moves;
}

function getKnightMoves(board,row,col,color){
  return[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].map(([dr,dc])=>({row:row+dr,col:col+dc})).filter(({row:r,col:c})=>inBounds(r,c)&&board[r][c]?.color!==color);
}

function getSlidingMoves(board,row,col,color,dirs){
  const moves=[];
  for(const[dr,dc]of dirs){let r=row+dr,c=col+dc; while(inBounds(r,c)){if(board[r][c]){if(board[r][c].color!==color)moves.push({row:r,col:c});break;} moves.push({row:r,col:c}); r+=dr;c+=dc;}}
  return moves;
}

function getKingMoves(board,row,col,color,gsr){
  const moves=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].map(([dr,dc])=>({row:row+dr,col:col+dc})).filter(({row:r,col:c})=>inBounds(r,c)&&board[r][c]?.color!==color);
  if(gsr) moves.push(...getCastlingMoves(board,row,col,color,gsr));
  return moves;
}

// ================================================================
// SECTION 7: ATTACK DETECTION
// ================================================================
function isSquareAttacked(board,row,col,byColor){
  for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){const r=row+dr,c=col+dc; if(inBounds(r,c)&&board[r][c]?.color===byColor&&board[r][c]?.type===PIECE.KNIGHT)return true;}
  for(const[dr,dc]of[[-1,-1],[-1,1],[1,-1],[1,1]]){let r=row+dr,c=col+dc; while(inBounds(r,c)){if(board[r][c]){if(board[r][c].color===byColor&&(board[r][c].type===PIECE.BISHOP||board[r][c].type===PIECE.QUEEN))return true;break;}r+=dr;c+=dc;}}
  for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]]){let r=row+dr,c=col+dc; while(inBounds(r,c)){if(board[r][c]){if(board[r][c].color===byColor&&(board[r][c].type===PIECE.ROOK||board[r][c].type===PIECE.QUEEN))return true;break;}r+=dr;c+=dc;}}
  const pr=row+(byColor===COLOR.WHITE?1:-1);
  for(const dc of[-1,1]) if(inBounds(pr,col+dc)&&board[pr][col+dc]?.color===byColor&&board[pr][col+dc]?.type===PIECE.PAWN)return true;
  for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]){const r=row+dr,c=col+dc; if(inBounds(r,c)&&board[r][c]?.color===byColor&&board[r][c]?.type===PIECE.KING)return true;}
  return false;
}

function isInCheck(board,color){const king=findKing(board,color); return king ? isSquareAttacked(board,king.row,king.col,enemy(color)) : false;}

function wouldLeaveKingInCheck(board,from,to,color,gsr){
  const tb=cloneBoard(board);
  if(to.enPassant&&gsr.enPassantTarget) tb[from.row][gsr.enPassantTarget.col]=null;
  tb[to.row][to.col]=tb[from.row][from.col]; tb[from.row][from.col]=null;
  if(tb[to.row][to.col]?.type===PIECE.KING&&Math.abs(to.col-from.col)===2){
    if(to.col>from.col){tb[to.row][5]=tb[to.row][7];tb[to.row][7]=null;}
    else{tb[to.row][3]=tb[to.row][0];tb[to.row][0]=null;}
  }
  return isInCheck(tb,color);
}

function getLegalMovesForSquare(board,row,col,gsr){
  const piece=board[row][col]; if(!piece)return[];
  return getPseudoLegalMoves(board,row,col,gsr).filter(to=>!wouldLeaveKingInCheck(board,{row,col},to,piece.color,gsr));
}

// ================================================================
// SECTION 8: GAME STATUS
// ================================================================
function hasAnyLegalMove(board,color,gsr){
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(board[r][c]?.color===color&&getLegalMovesForSquare(board,r,c,gsr).length>0)return true;
  return false;
}

function evaluateGameStatus(board,color,gsr){
  const inCheck=isInCheck(board,color),canMove=hasAnyLegalMove(board,color,gsr);
  if(inCheck&&!canMove)  return STATUS.CHECKMATE;
  if(!inCheck&&!canMove) return STATUS.STALEMATE;
  if((gsr.halfMoveClock ? gsr.halfMoveClock : 0)>=100) return STATUS.DRAW;
  if(inCheck) return STATUS.CHECK;
  return STATUS.PLAYING;
}

// ================================================================
// SECTION 9: SPECIAL MOVES & PROMOTION
// ================================================================
function getCastlingMoves(board,row,col,color,gsr){
  const moves=[],rights=gsr.castlingRights[color];
  if(!rights||isInCheck(board,color))return moves;
  if(rights.kingside){const rk=board[row][7]; if(rk?.type===PIECE.ROOK&&rk.color===color&&!board[row][5]&&!board[row][6]&&!isSquareAttacked(board,row,5,enemy(color))&&!isSquareAttacked(board,row,6,enemy(color)))moves.push({row,col:6,castling:'kingside'});}
  if(rights.queenside){const rq=board[row][0]; if(rq?.type===PIECE.ROOK&&rq.color===color&&!board[row][1]&&!board[row][2]&&!board[row][3]&&!isSquareAttacked(board,row,3,enemy(color))&&!isSquareAttacked(board,row,2,enemy(color)))moves.push({row,col:2,castling:'queenside'});}
  return moves;
}

function checkPawnPromotion(board,row,col,color){
  const backRank=color===COLOR.WHITE?0:7;
  if(board[row][col]?.type===PIECE.PAWN&&row===backRank){
    if(state._autoPromotionPiece) applyPromotion(row,col,color,state._autoPromotionPiece,true);
    else showPromotionDialog(row,col,color);
    return true;
  }
  return false;
}

function showPromotionDialog(row, col, color) {
  state.promotionPending = { row, col, color };
  const dlg = document.getElementById('promotion-dialog');
  if (dlg) dlg.style.display = 'flex';
}

function applyPromotion(row,col,color,chosenType,isRemoteMove=false){
  if(!state.promotionPending && !isRemoteMove) return;
  state.board[row][col] = { type: chosenType, color };
  state.promotionPending = null;
  
  const dlg = document.getElementById('promotion-dialog');
  if (dlg) dlg.style.display = 'none';

  if (state._pendingHistoryEntry) {
    state._pendingHistoryEntry.promotion = chosenType;
  }
  
  finishMoveExecution();
  if (state._pendingOnlineMove && !_applyingRemoteMove) {
    emitOnlineMove(state._pendingOnlineMove.from, state._pendingOnlineMove.to, chosenType);
    state._pendingOnlineMove = null;
  }
}

function finishMoveExecution() {
  state.turn = enemy(state.turn);
  const status = evaluateGameStatus(state.board, state.turn, state);
  state.status = status;

  if (status === STATUS.CHECKMATE) {
    state.winner = enemy(state.turn);
    playSound('gameover');
    CLOCK.stop();
  } else if (status === STATUS.STALEMATE || status === STATUS.DRAW) {
    playSound('gameover');
    CLOCK.stop();
  } else if (status === STATUS.CHECK) {
    playSound('check');
    CLOCK.switchTo(state.turn);
  } else {
    CLOCK.switchTo(state.turn);
  }

  renderBoard();
  updateStatusDisplay();
  setTimeout(() => maybeScheduleBotMove(), 120);
}

function recordCapturedPiece(capturedPiece, captorColor) {
  if (!capturedPiece || capturedPiece.type === PIECE.KING) return;
  const bucket = captorColor === COLOR.WHITE ? state.capturedByW : state.capturedByB;
  bucket.push({ type: capturedPiece.type, color: capturedPiece.color });
}

function maybeScheduleBotMove() {
  if (!IS_BOT_MODE || _botThinking || state.promotionPending) return;
  if (!(state.status === STATUS.PLAYING || state.status === STATUS.CHECK)) return;
  if (state.turn !== BOT_COLOR) return;
  if (typeof BOT === 'undefined' || typeof BOT.move !== 'function') {
    console.warn('[BOT] bot.js no está disponible.');
    return;
  }

  _botThinking = true;
  updateStatusDisplay();

  BOT.move(state.board, BOT_COLOR, BOT_LEVEL, {
    castlingRights: state.castlingRights,
    enPassantTarget: state.enPassantTarget,
    halfMoveClock: state.halfMoveClock,
  }, (move) => {
    _botThinking = false;
    if (!move || state.turn !== BOT_COLOR || state.promotionPending) {
      updateStatusDisplay();
      return;
    }

    const piece = state.board[move.from.row][move.from.col];
    if (piece?.type === PIECE.PAWN && (move.to.row === 0 || move.to.row === 7)) {
      state._autoPromotionPiece = PIECE.QUEEN;
    }
    executeMove(move.from, move.to);
    state._autoPromotionPiece = null;
  });
}

// ================================================================
// SECTION 10: RENDERING & UI UPDATES
// ================================================================
function renderBoard() {
  const container = document.getElementById('board');
  if (!container) return;
  container.innerHTML = '';

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      sq.dataset.row = r;
      sq.dataset.col = c;

      if (state.selected && state.selected.row === r && state.selected.col === c) {
        sq.classList.add('selected');
      }

      if (state.lastMove?.from?.row === r && state.lastMove.from.col === c) {
        sq.classList.add('last-move-from');
      }
      if (state.lastMove?.to?.row === r && state.lastMove.to.col === c) {
        sq.classList.add('last-move-to');
      }

      const legalMove = state.legalMoves.find(m => m.row === r && m.col === c);
      if (legalMove) {
        sq.classList.add('highlight');
      }

      const p = state.board[r][c];
      if (p) {
        const key = `${p.color}${p.type}`;
        if (CONFIG.USE_INLINE_SVG && PIECE_SVGS[key]) {
          sq.innerHTML = `<span class="piece piece-${p.color === COLOR.WHITE ? 'white' : 'black'} piece-${p.type}">${PIECE_SVGS[key]}</span>`;
        }
      }

      if (legalMove) {
        const marker = document.createElement('span');
        const isCapture = !!state.board[r][c] || !!legalMove.enPassant;
        marker.className = isCapture ? 'legal-capture' : 'legal-dot';
        sq.appendChild(marker);
      }

      sq.addEventListener('click', () => handleSquareClick(r, c));
      container.appendChild(sq);
    }
  }

  if (typeof window !== 'undefined' && typeof window.renderCapturedPieces === 'function') {
    window.renderCapturedPieces();
  }
}

function handleSquareClick(r, c) {
  if (state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE) return;
  if (IS_ONLINE && !_onlineReady) return;
  if (IS_ONLINE && state.turn !== PLAYER_COLOR) return;
  if (IS_BOT_MODE && (state.turn === BOT_COLOR || _botThinking)) return;

  const clickedPiece = state.board[r][c];

  if (state.selected) {
    const move = state.legalMoves.find(m => m.row === r && m.col === c);
    if (move) {
      executeMove(state.selected, move);
      return;
    }
  }

  if (clickedPiece && clickedPiece.color === state.turn) {
    state.selected = { row: r, col: c };
    state.legalMoves = getLegalMovesForSquare(state.board, r, c, state);
    renderBoard();
  } else {
    state.selected = null;
    state.legalMoves = [];
    renderBoard();
  }
}

function executeMove(from, to) {
  const piece = state.board[from.row][from.col];
  if (!piece) return false;
  const captured = state.board[to.row][to.col];
  const enPassantCaptured = to.enPassant && state.enPassantTarget
    ? state.board[from.row][state.enPassantTarget.col]
    : null;
  const capturedPiece = captured || enPassantCaptured;

  if (capturedPiece) {
    playSound('capture');
  } else if (to.castling) {
    playSound('castle');
  } else {
    playSound('move');
  }

  recordCapturedPiece(capturedPiece, piece.color);

  // Actualizar tablero
  state.board[to.row][to.col] = piece;
  state.board[from.row][from.col] = null;

  // Manejar enroque
  if (to.castling) {
    if (to.castling === 'kingside') {
      state.board[from.row][5] = state.board[from.row][7];
      state.board[from.row][7] = null;
    } else if (to.castling === 'queenside') {
      state.board[from.row][3] = state.board[from.row][0];
      state.board[from.row][0] = null;
    }
  }

  // Manejar captura al paso
  if (to.enPassant && state.enPassantTarget) {
    state.board[from.row][state.enPassantTarget.col] = null;
  }

  // Actualizar objetivos al paso
  if (piece.type === PIECE.PAWN && Math.abs(to.row - from.row) === 2) {
    state.enPassantTarget = { row: (from.row + to.row) / 2, col: from.col };
  } else {
    state.enPassantTarget = null;
  }

  state.selected = null;
  state.legalMoves = [];
  state.lastMove = {
    from: { row: from.row, col: from.col },
    to: { row: to.row, col: to.col },
  };

  const shouldEmitOnline = IS_ONLINE && !_applyingRemoteMove && piece.color === PLAYER_COLOR;
  if (shouldEmitOnline) {
    state._pendingOnlineMove = {
      from: { row: from.row, col: from.col },
      to: { row: to.row, col: to.col },
    };
  }

  // Verificar si hay promoción de peón
  if (!checkPawnPromotion(state.board, to.row, to.col, piece.color)) {
    finishMoveExecution();
    if (shouldEmitOnline) {
      emitOnlineMove(from, to, null);
      state._pendingOnlineMove = null;
    }
  }
  return true;
}

function updateStatusDisplay() {
  let message = '';

  if (state.status === STATUS.CHECKMATE) {
    message = `¡Jaque Mate! Ganan las ${state.winner === COLOR.WHITE ? 'Blancas' : 'Negras'}.`;
  } else if (state.status === STATUS.STALEMATE) {
    message = 'Tablas por ahogado.';
  } else if (state.status === STATUS.CHECK) {
    message = IS_BOT_MODE && state.turn === BOT_COLOR
      ? `Ozama Bot piensa (${BOT_LEVEL})...`
      : `¡Jaque a las ${state.turn === COLOR.WHITE ? 'Blancas' : 'Negras'}!`;
  } else if (IS_BOT_MODE && state.turn === BOT_COLOR) {
    message = `Ozama Bot piensa (${BOT_LEVEL})...`;
  } else {
    message = `Turno de las ${state.turn === COLOR.WHITE ? 'Blancas' : 'Negras'}`;
  }

  ['game-status', 'status-message', 'bc-banner'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
  });

  const gameBanner = document.getElementById('game-banner');
  if (gameBanner && IS_BOT_MODE) gameBanner.textContent = `OZAMA CHESS · VS OZAMA BOT · ${BOT_LEVEL.toUpperCase()}`;

  document.getElementById('white-turn')?.classList.toggle('on', state.turn === COLOR.WHITE);
  document.getElementById('black-turn')?.classList.toggle('on', state.turn === COLOR.BLACK);
}

function exportMoveList() {
  let pgn = '';
  let moveNo = 1;
  for (const entry of state.moveHistory || []) {
    if (entry.piece?.color === COLOR.WHITE) pgn += `${moveNo}. ${entry.notation || ''} `;
    else { pgn += `${entry.notation || ''} `; moveNo++; }
  }
  return pgn.trim();
}

function emitOnlineMove(from, to, promotion = null) {
  if (!IS_ONLINE || !socket) return;
  socket.emit('player-move', {
    room: ROOM_CODE,
    from: { row: from.row, col: from.col },
    to: { row: to.row, col: to.col },
    promotion,
  });
}

function completeMoveTarget(from, to) {
  const legalMoves = getLegalMovesForSquare(state.board, from.row, from.col, state);
  return legalMoves.find((move) => move.row === to.row && move.col === to.col) || to;
}

function clearOnlineSession() {
  [
    'ozama-room',
    'ozama-color',
    'ozama-names',
    'ozama-player-info',
    'ozama-myname',
    'ozama-token',
    'ozama-bot-mode',
    'ozama-bot-color',
    'ozama-bot-difficulty',
    'ozama-time-control',
  ].forEach((key) => sessionStorage.removeItem(key));
}

function showGameEnd(title, subtitle, { online = false, canPlayAgain = true } = {}) {
  const overlay = document.getElementById('game-over-overlay');
  const icon = document.getElementById('game-over-icon');
  const titleEl = document.getElementById('game-over-title');
  const subEl = document.getElementById('game-over-subtitle');
  const playAgain = document.getElementById('play-again-btn');
  const onlineButtons = document.getElementById('online-end-buttons');

  if (icon) icon.textContent = 'OC';
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  if (playAgain) playAgain.classList.toggle('hidden', !canPlayAgain);
  if (onlineButtons) onlineButtons.classList.toggle('hidden', !online);
  overlay?.classList.remove('hidden');
}

function hideGameEnd() {
  document.getElementById('game-over-overlay')?.classList.add('hidden');
}

function resignGame() {
  if (state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE || state.status === STATUS.DRAW) return;
  if (state.promotionPending) return;
  if (!window.confirm('Seguro que quieres rendirte?')) return;

  CLOCK.stop();
  playSound('gameover');

  if (IS_ONLINE) {
    socket?.emit('player-resign', { room: ROOM_CODE, pgn: exportMoveList() });
    state.status = STATUS.CHECKMATE;
    state.winner = enemy(PLAYER_COLOR);
    updateStatusDisplay();
    showGameEnd('TE RENDISTE', 'La partida fue entregada.', { online: true, canPlayAgain: false });
    return;
  }

  const loser = state.turn;
  state.status = STATUS.CHECKMATE;
  state.winner = enemy(loser);
  renderBoard();
  updateStatusDisplay();
  showGameEnd('RENDICION', `Ganan las ${state.winner === COLOR.WHITE ? 'Blancas' : 'Negras'}.`, {
    online: false,
    canPlayAgain: true,
  });
}

function setupControls() {
  document.getElementById('resign-btn')?.addEventListener('click', resignGame);
  document.getElementById('new-game-btn')?.addEventListener('click', () => {
    if (IS_ONLINE) return;
    hideGameEnd();
    startNewGame();
  });
  document.getElementById('play-again-btn')?.addEventListener('click', () => {
    if (IS_ONLINE) return;
    hideGameEnd();
    startNewGame();
  });
  document.getElementById('lobby-btn')?.addEventListener('click', () => {
    clearOnlineSession();
    window.location.href = '/lobby.html';
  });
  document.getElementById('rematch-btn')?.addEventListener('click', () => {
    if (IS_ONLINE && socket) socket.emit('rematch-request', { room: ROOM_CODE });
  });
  document.getElementById('rematch-accept-btn')?.addEventListener('click', () => {
    document.getElementById('rematch-overlay')?.classList.add('hidden');
    if (IS_ONLINE && socket) socket.emit('rematch-accept', { room: ROOM_CODE });
  });
  document.getElementById('rematch-decline-btn')?.addEventListener('click', () => {
    document.getElementById('rematch-overlay')?.classList.add('hidden');
    if (IS_ONLINE && socket) socket.emit('rematch-decline', { room: ROOM_CODE });
  });
}

function setupOnlineSocket() {
  if (!IS_ONLINE || typeof io !== 'function') return;
  socket = io({ auth: { token: sessionStorage.getItem('ozama-token') || localStorage.getItem('ozama-token') || '' } });

  function rejoin() {
    socket.emit('rejoin', {
      roomCode: ROOM_CODE,
      color: PLAYER_COLOR,
      playerName: sessionStorage.getItem('ozama-myname') || '',
    });
  }

  socket.on('opponent-resigned', ({ playerName } = {}) => {
    CLOCK.stop();
    playSound('gameover');
    state.status = STATUS.CHECKMATE;
    state.winner = PLAYER_COLOR;
    updateStatusDisplay();
    showGameEnd('VICTORIA', `${playerName || 'Tu rival'} se rindio.`, { online: true, canPlayAgain: false });
  });

  socket.on('opponent-move', ({ from, to, promotion } = {}) => {
    if (!from || !to) return;
    const target = completeMoveTarget(from, to);
    _applyingRemoteMove = true;
    state._autoPromotionPiece = promotion || null;
    try {
      executeMove(from, target);
    } finally {
      state._autoPromotionPiece = null;
      _applyingRemoteMove = false;
    }
  });

  socket.on('move-rejected', (message) => {
    console.warn('[OZAMA] Movimiento rechazado:', message);
  });

  socket.on('rematch-requested', ({ playerName } = {}) => {
    const sub = document.getElementById('rematch-sub');
    if (sub) sub.textContent = `${playerName || 'Tu rival'} quiere la revancha`;
    document.getElementById('rematch-overlay')?.classList.remove('hidden');
  });

  socket.on('rematch-declined', () => {
    document.getElementById('rematch-overlay')?.classList.add('hidden');
  });

  socket.on('rematch-start', ({ clockW, clockB } = {}) => {
    hideGameEnd();
    document.getElementById('rematch-overlay')?.classList.add('hidden');
    _onlineReady = true;
    startNewGame();
    CLOCK.set(clockW || 600000, clockB || 600000);
  });

  socket.on('rejoin-ok', ({ currentTurn, clockW, clockB, game } = {}) => {
    const restored = restoreGameSnapshot(game, { clockW, clockB });
    _onlineReady = true;
    if (!restored) {
      state.turn = currentTurn === COLOR.BLACK ? COLOR.BLACK : COLOR.WHITE;
      CLOCK.stop();
      CLOCK.set(clockW || 600000, clockB || 600000);
      renderBoard();
      updateStatusDisplay();
    }
  });

  socket.on('rejoin-failed', (message) => {
    console.warn('[OZAMA] Rejoin fallido:', message);
    clearOnlineSession();
    window.location.href = '/lobby.html';
  });

  socket.on('connect', rejoin);
  if (socket.connected) rejoin();
}

// Iniciar juego al cargar la página
window.addEventListener('DOMContentLoaded', () => {
  setupOnlineSocket();
  setupControls();
  startNewGame();
});
