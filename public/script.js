'use strict';

// ================================================================
// SECTION 0: SOUND SYSTEM — Web Audio API
// ================================================================
let _audioCtx = null;
let _audioMaster = null;
let _audioCompressor = null;
let _soundMuted = localStorage.getItem('ozama-sound-muted') === 'true';
let _soundVolume = Math.max(0, Math.min(1, Number(localStorage.getItem('ozama-sound-volume') || 0.82)));

function getAudioCtx() {
  if (!_audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    _audioCtx = new AC();
    _audioCompressor = _audioCtx.createDynamicsCompressor();
    _audioCompressor.threshold.setValueAtTime(-18, _audioCtx.currentTime);
    _audioCompressor.knee.setValueAtTime(18, _audioCtx.currentTime);
    _audioCompressor.ratio.setValueAtTime(5, _audioCtx.currentTime);
    _audioCompressor.attack.setValueAtTime(0.003, _audioCtx.currentTime);
    _audioCompressor.release.setValueAtTime(0.18, _audioCtx.currentTime);
    _audioMaster = _audioCtx.createGain();
    _audioMaster.gain.setValueAtTime(_soundMuted ? 0 : _soundVolume, _audioCtx.currentTime);
    _audioMaster.connect(_audioCompressor);
    _audioCompressor.connect(_audioCtx.destination);
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function updateSoundButton() {
  const btn = document.getElementById('sound-toggle-btn');
  if (!btn) return;
  btn.textContent = _soundMuted ? 'Sonido off' : 'Sonido on';
  btn.classList.toggle('muted', _soundMuted);
}

function setSoundMuted(muted) {
  _soundMuted = !!muted;
  localStorage.setItem('ozama-sound-muted', String(_soundMuted));
  if (_audioMaster && _audioCtx) {
    _audioMaster.gain.cancelScheduledValues(_audioCtx.currentTime);
    _audioMaster.gain.setTargetAtTime(_soundMuted ? 0 : _soundVolume, _audioCtx.currentTime, 0.015);
  }
  updateSoundButton();
}

function toggleSound() {
  getAudioCtx();
  setSoundMuted(!_soundMuted);
  if (!_soundMuted) playSound('move');
}

['pointerdown','touchstart','keydown'].forEach((eventName) => {
  document.addEventListener(eventName, () => getAudioCtx(), { once: true, passive: true });
});

function playSound(name) {
  try {
    if (_soundMuted) return;
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
  _noise(ctx,{duration:.026,vol:.24,filter:820,type:'bandpass'});
  _noise(ctx,{duration:.12,vol:.18,filter:280,type:'lowpass',delay:.012});
  _tone(ctx,{type:'triangle',freq:156,endFreq:82,vol:.20,duration:.16,delay:.006});
  _tone(ctx,{type:'sine',freq:66,endFreq:48,vol:.10,duration:.18,delay:.028});
}
function _soundCapture(ctx) {
  _noise(ctx,{duration:.018,vol:.58,filter:4200,type:'highpass'});
  _noise(ctx,{duration:.07,vol:.34,filter:1450,type:'bandpass',delay:.012});
  _noise(ctx,{duration:.22,vol:.30,filter:360,type:'lowpass',delay:.024});
  _tone(ctx,{type:'sawtooth',freq:210,endFreq:58,vol:.34,duration:.28,delay:.006});
  _tone(ctx,{type:'triangle',freq:92,endFreq:46,vol:.18,duration:.34,delay:.055});
}
function _soundCheck(ctx) {
  _noise(ctx,{duration:.05,vol:.20,filter:2100,type:'bandpass'});
  _tone(ctx,{type:'triangle',freq:392,endFreq:392,vol:.13,duration:.12});
  _tone(ctx,{type:'triangle',freq:523,endFreq:392,vol:.11,duration:.18,delay:.105});
  _tone(ctx,{type:'sine',freq:1046,endFreq:740,vol:.045,duration:.24,delay:.018});
}
function _soundCastle(ctx) {
  _noise(ctx,{duration:.10,vol:.22,filter:330,type:'lowpass'});
  _tone(ctx,{type:'triangle',freq:164,endFreq:74,vol:.20,duration:.18});
  _noise(ctx,{duration:.10,vol:.20,filter:390,type:'lowpass',delay:.135});
  _tone(ctx,{type:'triangle',freq:196,endFreq:88,vol:.18,duration:.18,delay:.135});
}
function _soundGameover(ctx) {
  _noise(ctx,{duration:.72,vol:.16,filter:240,type:'lowpass',delay:.02});
  [{freq:196,delay:0},{freq:147,delay:.20},{freq:110,delay:.43},{freq:73,delay:.70}]
    .forEach(({freq,delay})=>_tone(ctx,{type:'triangle',freq,endFreq:Math.max(40,freq*.52),vol:.15,duration:.95,delay}));
  _noise(ctx,{duration:.16,vol:.16,filter:960,type:'bandpass',delay:.09});
  _tone(ctx,{type:'sine',freq:62,endFreq:41,vol:.16,duration:.9,delay:.12});
}
function _tone(ctx,{type,freq,endFreq,vol,duration,delay=0}){
  const t=ctx.currentTime+delay, osc=ctx.createOscillator(), env=ctx.createGain();
  osc.connect(env); env.connect(_audioMaster || ctx.destination);
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
  src.connect(biquad); biquad.connect(env); env.connect(_audioMaster || ctx.destination);
  env.gain.setValueAtTime(vol,t); env.gain.exponentialRampToValueAtTime(.0001,t+duration);
  src.start(t); src.stop(t+duration+.01);
}

// ================================================================
// SECTION 1: CONFIG & CONSTANTS
// ================================================================
const CONFIG = {
  BOARD_SIZE: 8,
  PIECE_PATH: './assets/pieces/',
  USE_INLINE_SVG: true,
  USE_BLENDER_PIECES: true,
  BOARD_FLIPPED: false
};
const PIECE  = { PAWN:'p', KNIGHT:'n', BISHOP:'b', ROOK:'r', QUEEN:'q', KING:'k' };
const COLOR  = { WHITE:'w', BLACK:'b' };
const STATUS = { PLAYING:'playing', CHECK:'check', CHECKMATE:'checkmate', STALEMATE:'stalemate', DRAW:'draw' };
const BLENDER_PIECE_NAMES = { p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen', k:'king' };

// ================================================================
// SECTION 2: SVG PIECE ASSETS
// ================================================================
const PIECE_SVGS = {
  wp:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wpg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wph" cx="28%" cy="22%" r="45%"><stop offset="0%" stop-color="rgba(255,250,230,0.7)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><rect x="9.5" y="35.5" width="26" height="4.5" rx="1" fill="url(#wpg)" stroke="#7A5218" stroke-width="1.3"/><rect x="9.5" y="35.5" width="26" height="1.2" rx="0.5" fill="rgba(255,245,210,0.3)"/><path d="M18.5 35Q17 26.5 22.5 23Q28 26.5 26.5 35Z" fill="url(#wpg)" stroke="#7A5218" stroke-width="1.3"/><ellipse cx="22.5" cy="24" rx="4.5" ry="1.2" fill="#C89040" stroke="#7A5218" stroke-width="0.8"/><circle cx="22.5" cy="10.5" r="8" fill="url(#wpg)" stroke="#7A5218" stroke-width="1.4"/><circle cx="22.5" cy="10.5" r="8" fill="url(#wph)"/><ellipse cx="19.5" cy="7.5" rx="3" ry="2" fill="rgba(255,252,235,0.5)"/></svg>`,
  wn:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wng" cx="34%" cy="22%" r="76%"><stop offset="0%" stop-color="#FFF3D7"/><stop offset="30%" stop-color="#E8C27A"/><stop offset="64%" stop-color="#B77A26"/><stop offset="100%" stop-color="#6B4212"/></radialGradient><linearGradient id="wns" x1="18%" y1="6%" x2="88%" y2="100%"><stop offset="0%" stop-color="rgba(255,255,238,0.58)"/><stop offset="48%" stop-color="rgba(255,236,179,0.1)"/><stop offset="100%" stop-color="rgba(50,26,7,0.42)"/></linearGradient><radialGradient id="wne" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#1B0F05"/><stop offset="100%" stop-color="#050301"/></radialGradient></defs><path d="M8.2 39.6h29.2v-4.1H8.2z" fill="url(#wng)" stroke="#6F4712" stroke-width="1.25"/><path d="M11.2 35.7h23.2l-1.8-4.8H13.1z" fill="url(#wng)" stroke="#6F4712" stroke-width="1.12"/><path d="M17.7 30.9c.6-3.7 2.2-6.4 4.8-8.4 1.4-1.1 2.6-2 3.4-3.1-2.3.2-4.7-.2-7.1-1.2 1.8-3.2 4.1-5.6 7-7.3l-.7-5.4 4.6 2.9 3.2-2.7 1.1 5.9c2.4 1.7 3.8 4.2 4 7.2-1.3 1.7-3.1 2.8-5.6 3.3l-2.4 2.3c-.3 2.6-1.4 4.8-3.2 6.5z" fill="url(#wng)" stroke="#6F4712" stroke-width="1.38" stroke-linejoin="round"/><path d="M25.7 11.1c-3.5 2.2-5.7 4.7-6.9 7.1 2.5 1.1 5 1.5 7.6 1.1-1.2 1.8-2.7 3.3-4.5 4.4-1.9 1.2-3.2 3.6-3.9 7.1" fill="none" stroke="rgba(255,245,214,0.25)" stroke-width="1.05" stroke-linecap="round"/><path d="M29.6 8.8l2.1-1.7.8 4.1" fill="none" stroke="rgba(255,244,206,0.48)" stroke-width="1.05" stroke-linecap="round"/><path d="M29.1 12.5c2.8.9 4.5 2.9 5.1 5.8" fill="none" stroke="rgba(91,55,15,0.48)" stroke-width="1.05" stroke-linecap="round"/><ellipse cx="30.2" cy="15.2" rx="1.45" ry="1.65" fill="url(#wne)" transform="rotate(-16 30.2 15.2)"/><circle cx="30.6" cy="14.7" r=".42" fill="#EBCF91"/><path d="M33.2 18.8c1.2.1 2.4-.1 3.4-.7-.8 1.2-2 1.9-3.5 2.2" fill="none" stroke="#6F4712" stroke-width="1" stroke-linecap="round"/><path d="M31.1 12.2c-.4 4.2-.7 8.2-1.2 12.1M33.4 13.7c-.5 3.1-.9 5.8-1.4 8.1M27.7 11.4c-.3 2.7-.7 5.2-1.1 7.6" fill="none" stroke="rgba(91,55,15,0.38)" stroke-width=".9" stroke-linecap="round"/><path d="M8.2 39.6h29.2v-4.1H8.2zM11.2 35.7h23.2l-1.8-4.8H13.1zM17.7 30.9c.6-3.7 2.2-6.4 4.8-8.4 1.4-1.1 2.6-2 3.4-3.1-2.3.2-4.7-.2-7.1-1.2 1.8-3.2 4.1-5.6 7-7.3l-.7-5.4 4.6 2.9 3.2-2.7 1.1 5.9c2.4 1.7 3.8 4.2 4 7.2-1.3 1.7-3.1 2.8-5.6 3.3l-2.4 2.3c-.3 2.6-1.4 4.8-3.2 6.5z" fill="url(#wns)"/></svg>`,
  wb:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wbg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wbh" cx="30%" cy="22%" r="50%"><stop offset="0%" stop-color="rgba(255,250,230,0.65)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><rect x="8.5" y="36" width="28" height="4" rx="1" fill="url(#wbg)" stroke="#7A5218" stroke-width="1.3"/><path d="M14.5 36Q12.5 34 12.5 33L32.5 33Q32.5 34 30.5 36Z" fill="url(#wbg)" stroke="#7A5218" stroke-width="1"/><path d="M22.5 12.5Q29 17 30 23Q31 30.5 27.5 33L17.5 33Q14 30.5 15 23Q16 17 22.5 12.5Z" fill="url(#wbg)" stroke="#7A5218" stroke-width="1.3"/><path d="M22.5 12.5Q29 17 30 23Q31 30.5 27.5 33L17.5 33Q14 30.5 15 23Q16 17 22.5 12.5Z" fill="url(#wbh)"/><line x1="17.5" y1="24" x2="27.5" y2="24" stroke="rgba(122,82,24,0.32)" stroke-width="1"/><ellipse cx="22.5" cy="14" rx="3.5" ry="1.2" fill="#C89040" stroke="#7A5218" stroke-width="0.8"/><circle cx="22.5" cy="8.5" r="4.5" fill="url(#wbg)" stroke="#7A5218" stroke-width="1.3"/><circle cx="22.5" cy="8.5" r="4.5" fill="url(#wbh)"/><circle cx="22.5" cy="6" r="1.5" fill="#C89040" stroke="#7A5218" stroke-width="0.7"/><ellipse cx="20" cy="7" rx="2" ry="1.3" fill="rgba(255,252,235,0.5)"/></svg>`,
  wr:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wrg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><linearGradient id="wrh" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="rgba(255,250,230,0.28)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></linearGradient></defs><rect x="8" y="35" width="29" height="5" rx="1" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><path d="M10 34L13.5 34L13.5 17L31.5 17L31.5 34L35 34L35 15L10 15Z" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><path d="M10 34L13.5 34L13.5 17L31.5 17L31.5 34L35 34L35 15L10 15Z" fill="url(#wrh)"/><line x1="20.5" y1="19" x2="20.5" y2="33" stroke="rgba(122,82,24,0.28)" stroke-width="0.9"/><line x1="24.5" y1="19" x2="24.5" y2="33" stroke="rgba(122,82,24,0.28)" stroke-width="0.9"/><rect x="9" y="7.5" width="7" height="9" rx="0.8" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><rect x="19.5" y="7.5" width="6" height="9" rx="0.8" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><rect x="29.5" y="7.5" width="7" height="9" rx="0.8" fill="url(#wrg)" stroke="#7A5218" stroke-width="1.3"/><rect x="10" y="8.5" width="5" height="1.5" rx="0.3" fill="rgba(255,248,220,0.35)"/></svg>`,
  wq:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wqg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wqh" cx="30%" cy="25%" r="50%"><stop offset="0%" stop-color="rgba(255,250,230,0.55)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><rect x="7.5" y="35.5" width="30" height="4.5" rx="1" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.3"/><path d="M10.5 35.5Q15.5 34 22.5 34.5Q29.5 34 34.5 35.5L34.5 33.5Q29.5 31.5 22.5 32Q15.5 31.5 10.5 33.5Z" fill="url(#wqg)" stroke="#7A5218" stroke-width="1"/><path d="M8 14.5L10.5 32Q16 28.5 22.5 30Q29 28.5 34.5 32L37 14.5L31 22L22.5 12L14 22Z" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.4"/><path d="M8 14.5L10.5 32Q16 28.5 22.5 30Q29 28.5 34.5 32L37 14.5L31 22L22.5 12L14 22Z" fill="url(#wqh)"/><circle cx="7.5" cy="12.5" r="4" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.3"/><circle cx="7.5" cy="12.5" r="4" fill="url(#wqh)"/><circle cx="15" cy="9.5" r="3.2" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.2"/><circle cx="22.5" cy="7.5" r="4" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.3"/><circle cx="22.5" cy="7.5" r="4" fill="url(#wqh)"/><circle cx="30" cy="9.5" r="3.2" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.2"/><circle cx="37.5" cy="12.5" r="4" fill="url(#wqg)" stroke="#7A5218" stroke-width="1.3"/><circle cx="37.5" cy="12.5" r="4" fill="url(#wqh)"/><circle cx="20.5" cy="5.5" r="1.6" fill="rgba(255,252,235,0.55)"/></svg>`,
  wk:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="wkg" cx="36%" cy="28%" r="70%"><stop offset="0%" stop-color="#FDF0D5"/><stop offset="35%" stop-color="#E5C48A"/><stop offset="70%" stop-color="#C8994A"/><stop offset="100%" stop-color="#9A6E30"/></radialGradient><radialGradient id="wkh" cx="30%" cy="25%" r="55%"><stop offset="0%" stop-color="rgba(255,250,230,0.55)"/><stop offset="100%" stop-color="rgba(255,250,230,0)"/></radialGradient></defs><rect x="9" y="35.5" width="27" height="4.5" rx="1" fill="url(#wkg)" stroke="#7A5218" stroke-width="1.3"/><path d="M11.5 35.5Q10 25 13.5 20Q17.5 16 22.5 16Q27.5 16 31.5 20Q35 25 33.5 35.5Z" fill="url(#wkg)" stroke="#7A5218" stroke-width="1.4"/><path d="M11.5 35.5Q10 25 13.5 20Q17.5 16 22.5 16Q27.5 16 31.5 20Q35 25 33.5 35.5Z" fill="url(#wkh)"/><line x1="13" y1="24" x2="32" y2="24" stroke="rgba(122,82,24,0.28)" stroke-width="0.9"/><rect x="14" y="14.5" width="17" height="3.5" rx="1" fill="#C89040" stroke="#7A5218" stroke-width="0.9"/><rect x="20.5" y="2" width="4.5" height="15" rx="1.8" fill="url(#wkg)" stroke="#7A5218" stroke-width="1.4"/><rect x="20.5" y="2" width="4.5" height="15" rx="1.8" fill="url(#wkh)"/><rect x="14.5" y="5.5" width="16" height="5" rx="1.8" fill="url(#wkg)" stroke="#7A5218" stroke-width="1.4"/><rect x="14.5" y="5.5" width="16" height="5" rx="1.8" fill="url(#wkh)"/><rect x="21.5" y="3" width="2" height="5" rx="1" fill="rgba(255,252,235,0.55)"/></svg>`,
  bp:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="bpg" cx="32%" cy="26%" r="70%"><stop offset="0%" stop-color="#3A3028"/><stop offset="40%" stop-color="#1C1610"/><stop offset="75%" stop-color="#100D08"/><stop offset="100%" stop-color="#060504"/></radialGradient><radialGradient id="bph" cx="28%" cy="22%" r="45%"><stop offset="0%" stop-color="rgba(200,152,60,0.32)"/><stop offset="100%" stop-color="rgba(200,152,60,0)"/></radialGradient></defs><rect x="9.5" y="35.5" width="26" height="4.5" rx="1" fill="url(#bpg)" stroke="#C8983C" stroke-width="1.6"/><rect x="9.5" y="35.5" width="26" height="1.2" rx="0.5" fill="rgba(200,152,60,0.25)"/><path d="M18.5 35Q17 26.5 22.5 23Q28 26.5 26.5 35Z" fill="url(#bpg)" stroke="#C8983C" stroke-width="1.5"/><ellipse cx="22.5" cy="24" rx="4.5" ry="1.2" fill="#6B5018" stroke="#C8983C" stroke-width="0.9"/><circle cx="22.5" cy="10.5" r="8" fill="url(#bpg)" stroke="#C8983C" stroke-width="1.6"/><circle cx="22.5" cy="10.5" r="8" fill="url(#bph)"/><ellipse cx="19" cy="7.5" rx="3" ry="2" fill="rgba(200,152,60,0.22)"/></svg>`,
  bn:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><radialGradient id="bng" cx="34%" cy="22%" r="76%"><stop offset="0%" stop-color="#4A3828"/><stop offset="34%" stop-color="#21170E"/><stop offset="74%" stop-color="#0D0905"/><stop offset="100%" stop-color="#030201"/></radialGradient><linearGradient id="bns" x1="18%" y1="6%" x2="88%" y2="100%"><stop offset="0%" stop-color="rgba(218,166,67,0.38)"/><stop offset="52%" stop-color="rgba(200,152,60,0.08)"/><stop offset="100%" stop-color="rgba(0,0,0,0.48)"/></linearGradient><radialGradient id="bne" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#D3A54D"/><stop offset="100%" stop-color="#51330D"/></radialGradient></defs><path d="M8.2 39.6h29.2v-4.1H8.2z" fill="url(#bng)" stroke="#C8983C" stroke-width="1.55"/><path d="M11.2 35.7h23.2l-1.8-4.8H13.1z" fill="url(#bng)" stroke="#C8983C" stroke-width="1.32"/><path d="M17.7 30.9c.6-3.7 2.2-6.4 4.8-8.4 1.4-1.1 2.6-2 3.4-3.1-2.3.2-4.7-.2-7.1-1.2 1.8-3.2 4.1-5.6 7-7.3l-.7-5.4 4.6 2.9 3.2-2.7 1.1 5.9c2.4 1.7 3.8 4.2 4 7.2-1.3 1.7-3.1 2.8-5.6 3.3l-2.4 2.3c-.3 2.6-1.4 4.8-3.2 6.5z" fill="url(#bng)" stroke="#C8983C" stroke-width="1.62" stroke-linejoin="round"/><path d="M25.7 11.1c-3.5 2.2-5.7 4.7-6.9 7.1 2.5 1.1 5 1.5 7.6 1.1-1.2 1.8-2.7 3.3-4.5 4.4-1.9 1.2-3.2 3.6-3.9 7.1" fill="none" stroke="rgba(218,166,67,0.25)" stroke-width="1.05" stroke-linecap="round"/><path d="M29.6 8.8l2.1-1.7.8 4.1" fill="none" stroke="rgba(226,185,96,0.5)" stroke-width="1.05" stroke-linecap="round"/><path d="M29.1 12.5c2.8.9 4.5 2.9 5.1 5.8" fill="none" stroke="rgba(200,152,60,0.45)" stroke-width="1.05" stroke-linecap="round"/><ellipse cx="30.2" cy="15.2" rx="1.45" ry="1.65" fill="url(#bne)" transform="rotate(-16 30.2 15.2)"/><circle cx="30.6" cy="14.7" r=".42" fill="#090603"/><path d="M33.2 18.8c1.2.1 2.4-.1 3.4-.7-.8 1.2-2 1.9-3.5 2.2" fill="none" stroke="#C8983C" stroke-width="1" stroke-linecap="round"/><path d="M31.1 12.2c-.4 4.2-.7 8.2-1.2 12.1M33.4 13.7c-.5 3.1-.9 5.8-1.4 8.1M27.7 11.4c-.3 2.7-.7 5.2-1.1 7.6" fill="none" stroke="rgba(200,152,60,0.36)" stroke-width=".9" stroke-linecap="round"/><path d="M8.2 39.6h29.2v-4.1H8.2zM11.2 35.7h23.2l-1.8-4.8H13.1zM17.7 30.9c.6-3.7 2.2-6.4 4.8-8.4 1.4-1.1 2.6-2 3.4-3.1-2.3.2-4.7-.2-7.1-1.2 1.8-3.2 4.1-5.6 7-7.3l-.7-5.4 4.6 2.9 3.2-2.7 1.1 5.9c2.4 1.7 3.8 4.2 4 7.2-1.3 1.7-3.1 2.8-5.6 3.3l-2.4 2.3c-.3 2.6-1.4 4.8-3.2 6.5z" fill="url(#bns)"/></svg>`,
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
const BOT_SESSION_REQUESTED = sessionStorage.getItem('ozama-bot-mode') === 'true';
let PLAYER_COLOR = RAW_PLAYER_COLOR === 'white' ? COLOR.WHITE
  : RAW_PLAYER_COLOR === 'black' ? COLOR.BLACK
  : RAW_PLAYER_COLOR;
let IS_ONLINE = !BOT_SESSION_REQUESTED && !!(ROOM_CODE && (PLAYER_COLOR === COLOR.WHITE || PLAYER_COLOR === COLOR.BLACK));
const IS_BOT_MODE = BOT_SESSION_REQUESTED;
function readStoredUser() {
  try { return JSON.parse(localStorage.getItem('ozama-user') || 'null'); }
  catch { return null; }
}
let STORED_USER = null;
let STORED_TOKEN = '';

async function validateStoredSession() {
  try {
    const response = await fetch('/api/user/me', {
      headers: STORED_TOKEN ? { Authorization: `Bearer ${STORED_TOKEN}` } : {},
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('INVALID_SESSION');

    const data = await response.json();
    if (!data?.user) throw new Error('INVALID_SESSION');
    localStorage.setItem('ozama-user', JSON.stringify(data.user));
    return true;
  } catch (_) {
    localStorage.removeItem('ozama-user');
    await window.OZAMA_RUNTIME?.clearAuthToken?.().catch(() => {});
    sessionStorage.clear();
    window.location.replace('/login.html');
    return false;
  }
}
if (!IS_ONLINE && !IS_BOT_MODE) {
  window.location.replace('/lobby.html');
  throw new Error('GAME_SESSION_REQUIRED');
}
const BOT_COLOR = sessionStorage.getItem('ozama-bot-color') || COLOR.BLACK;
const BOT_LEVEL = sessionStorage.getItem('ozama-bot-difficulty') || 'medium';
let _botThinking = false;
let socket = null;
let _applyingRemoteMove = false;
let _onlineSynced = !IS_ONLINE;

let state = {
  board:[], turn:COLOR.WHITE, selected:null, legalMoves:[],
  castlingRights:{ w:{kingside:true,queenside:true}, b:{kingside:true,queenside:true} },
  enPassantTarget:null, status:STATUS.PLAYING, winner:null, endReason:null,
  moveCount:0, halfMoveClock:0, moveHistory:[],
  promotionPending:null, _pendingHistoryEntry:null,
  lastMove:null, _autoPromotionPiece:null, _finishReported:false,
  _pendingOnlineMove:null,
  capturedByW:[], capturedByB:[],
};

function boardViewColor() {
  return IS_ONLINE && PLAYER_COLOR === COLOR.BLACK ? COLOR.BLACK : COLOR.WHITE;
}

function setConfirmedPlayerColor(color) {
  const normalized = color === 'white' ? COLOR.WHITE : color === 'black' ? COLOR.BLACK : color;
  if (normalized !== COLOR.WHITE && normalized !== COLOR.BLACK) return false;
  PLAYER_COLOR = normalized;
  IS_ONLINE = !!(ROOM_CODE && (PLAYER_COLOR === COLOR.WHITE || PLAYER_COLOR === COLOR.BLACK));
  sessionStorage.setItem('ozama-color', PLAYER_COLOR);
  return true;
}

function isBoardFlipped() {
  return boardViewColor() === COLOR.BLACK;
}

// ================================================================
// SECTION 3.5: CLOCK SYSTEM
// ================================================================
const CLOCK = (() => {
  let _intervalId = null;
  let _times = { w: 600000, b: 600000 };
  let _totals = { w: 600000, b: 600000 };

  function _fmt(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function _renderFill(color, remaining) {
    const el = document.getElementById(color === COLOR.WHITE ? 'clock-fill-white' : 'clock-fill-black');
    if (!el) return;
    const total = _totals[color] || 600000;
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    el.style.width = pct + '%';
    el.classList.toggle('low', remaining < 30000);
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
    _renderFill(COLOR.WHITE, _times.w);
    _renderFill(COLOR.BLACK, _times.b);
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
      if (_times[color] === 0) {
        stop();
        handleClockTimeout(color);
      }
    }, 1000);
  }

  function switchTo(color) { start(color); }
  function set(w, b) {
    _times.w = w; _times.b = b;
    // La barra de progreso usa este mismo valor como "100%" -- en una
    // partida nueva es el tiempo total; en un rejoin es lo que quedaba
    // en ese momento, asi que la barra arranca llena y baja desde ahi.
    _totals.w = w || _totals.w;
    _totals.b = b || _totals.b;
    _render();
  }
  function get() { return { w: _times.w, b: _times.b }; }

  return { start, stop, switchTo, set, get };
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
  clearLocalGameSnapshot();
  state.board=createInitialBoard(); state.turn=COLOR.WHITE; state.selected=null; state.legalMoves=[];
  state.castlingRights={w:{kingside:true,queenside:true},b:{kingside:true,queenside:true}};
  state.enPassantTarget=null; state.status=STATUS.PLAYING; state.winner=null; state.endReason=null;
  state.moveCount=0; state.halfMoveClock=0; state.moveHistory=[];
  state.promotionPending=null; state._pendingHistoryEntry=null;
  state.lastMove=null; state._autoPromotionPiece=null; state._finishReported=false;
  state._pendingOnlineMove=null;
  state.capturedByW=[]; state.capturedByB=[];
  renderBoard(); updateStatusDisplay();
  CLOCK.set(600000, 600000);
  if (!IS_ONLINE) CLOCK.start(COLOR.WHITE);
  saveLocalGameSnapshot();
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
  state.status=STATUS.PLAYING; state.winner=null; state.endReason=null;
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

const LOCAL_GAME_KEY='ozama-bot-game-state';

function clearLocalGameSnapshot(){
  sessionStorage.removeItem(LOCAL_GAME_KEY);
}

function saveLocalGameSnapshot(){
  if(!IS_BOT_MODE||state.promotionPending) return;
  if(state.status===STATUS.CHECKMATE||state.status===STATUS.STALEMATE||state.status===STATUS.DRAW) return;
  const clocks=typeof CLOCK?.get==='function'?CLOCK.get():{w:600000,b:600000};
  sessionStorage.setItem(LOCAL_GAME_KEY,JSON.stringify({
    mode:'bot',
    botColor:BOT_COLOR,
    botLevel:BOT_LEVEL,
    board:cloneBoard(state.board),
    turn:state.turn,
    castlingRights:state.castlingRights,
    enPassantTarget:state.enPassantTarget,
    status:state.status,
    winner:state.winner,
    endReason:state.endReason,
    moveCount:state.moveCount,
    halfMoveClock:state.halfMoveClock,
    lastMove:state.lastMove,
    capturedByW:state.capturedByW,
    capturedByB:state.capturedByB,
    clockW:clocks.w,
    clockB:clocks.b,
    savedAt:Date.now(),
  }));
}

function restoreLocalGameSnapshot(){
  if(!IS_BOT_MODE) return false;
  let snapshot=null;
  try{snapshot=JSON.parse(sessionStorage.getItem(LOCAL_GAME_KEY)||'null');}
  catch{return false;}
  if(!snapshot||snapshot.mode!=='bot'||snapshot.botColor!==BOT_COLOR||snapshot.botLevel!==BOT_LEVEL) return false;
  if(![STATUS.PLAYING,STATUS.CHECK].includes(snapshot.status)) {
    clearLocalGameSnapshot();
    return false;
  }
  const board=normalizeBoardSnapshot(snapshot.board);
  if(!board) return false;
  state.board=board;
  state.turn=snapshot.turn===COLOR.BLACK?COLOR.BLACK:COLOR.WHITE;
  state.selected=null; state.legalMoves=[];
  state.castlingRights=snapshot.castlingRights||{w:{kingside:true,queenside:true},b:{kingside:true,queenside:true}};
  state.enPassantTarget=snapshot.enPassantTarget||null;
  state.status=snapshot.status||STATUS.PLAYING;
  state.winner=snapshot.winner||null;
  state.endReason=snapshot.endReason||null;
  state.moveCount=Number(snapshot.moveCount)||0;
  state.halfMoveClock=Number(snapshot.halfMoveClock)||0;
  state.moveHistory=[];
  state.promotionPending=null; state._pendingHistoryEntry=null;
  state.lastMove=snapshot.lastMove||null;
  state._autoPromotionPiece=null; state._finishReported=false; state._pendingOnlineMove=null;
  state.capturedByW=Array.isArray(snapshot.capturedByW)?snapshot.capturedByW:[];
  state.capturedByB=Array.isArray(snapshot.capturedByB)?snapshot.capturedByB:[];
  CLOCK.stop();
  CLOCK.set(Number(snapshot.clockW)||600000,Number(snapshot.clockB)||600000);
  CLOCK.start(state.turn);
  renderBoard(); updateStatusDisplay();
  setTimeout(()=>maybeScheduleBotMove(),120);
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
  if (!dlg) return;
  const optionsEl = dlg.querySelector('.promotion-options');
  if (optionsEl) {
    const order = [PIECE.QUEEN, PIECE.ROOK, PIECE.BISHOP, PIECE.KNIGHT];
    optionsEl.innerHTML = order.map(type => {
      const key = `${color}${type}`;
      let inner;
      if (CONFIG.USE_BLENDER_PIECES && BLENDER_PIECE_NAMES[type]) {
        const style = color === COLOR.WHITE ? 'gold' : 'black';
        const colorClass = color === COLOR.WHITE ? 'white' : 'black';
        inner = `<span class="piece piece-3d piece-${colorClass} piece-${type}"><img src="./assets/pieces/blender/${style}/${BLENDER_PIECE_NAMES[type]}.png" alt="" draggable="false"></span>`;
      } else if (CONFIG.USE_INLINE_SVG && PIECE_SVGS[key]) {
        inner = `<span class="piece piece-${color === COLOR.WHITE ? 'white' : 'black'} piece-${type}">${PIECE_SVGS[key]}</span>`;
      } else {
        inner = '?';
      }
      return `<button type="button" class="promotion-btn" data-type="${type}">${inner}</button>`;
    }).join('');
    optionsEl.querySelectorAll('.promotion-btn').forEach(btn => {
      btn.addEventListener('click', () => applyPromotion(row, col, color, btn.dataset.type));
    });
  }
  dlg.classList.remove('hidden');
  dlg.style.display = 'flex';
}

function applyPromotion(row,col,color,chosenType,isRemoteMove=false){
  if(!state.promotionPending && !isRemoteMove) return;
  state.board[row][col] = { type: chosenType, color };
  state.promotionPending = null;
  
  const dlg = document.getElementById('promotion-dialog');
  if (dlg) { dlg.style.display = 'none'; dlg.classList.add('hidden'); }

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
  state.endReason = status === STATUS.CHECKMATE
    ? 'checkmate'
    : status === STATUS.STALEMATE
      ? 'stalemate'
      : status === STATUS.DRAW
        ? 'fifty_move'
        : null;

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
  reportOnlineGameFinished();
  showLocalGameFinished();
  saveLocalGameSnapshot();
  setTimeout(() => maybeScheduleBotMove(), 120);
}

function showLocalGameFinished() {
  if (!(state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE || state.status === STATUS.DRAW)) return;

  if (!IS_ONLINE) clearLocalGameSnapshot();

  if (state.status === STATUS.CHECKMATE) {
    showGameEnd('JAQUE MATE', `Ganan las ${state.winner === COLOR.WHITE ? 'Blancas' : 'Negras'}.`, {
      online: IS_ONLINE,
      canPlayAgain: !IS_ONLINE,
    });
    return;
  }

  const drawMessage = state.endReason === 'stalemate'
    ? 'Partida empatada por rey ahogado.'
    : state.endReason === 'fifty_move'
      ? 'Partida empatada por la regla de 50 movimientos.'
      : 'Partida empatada.';
  showGameEnd('TABLAS', drawMessage, {
    online: IS_ONLINE,
    canPlayAgain: !IS_ONLINE,
  });
}

function handleClockTimeout(loserColor) {
  if (IS_ONLINE) return;
  if (state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE || state.status === STATUS.DRAW) return;

  const winner = enemy(loserColor);
  state.status = STATUS.CHECKMATE;
  state.winner = winner;
  state.endReason = 'timeout';
  state.selected = null;
  state.legalMoves = [];
  _botThinking = false;

  clearLocalGameSnapshot();
  playSound('gameover');
  renderBoard();
  updateStatusDisplay();
  showGameEnd(
    'TIEMPO AGOTADO',
    `Se acabo el tiempo de las ${loserColor === COLOR.WHITE ? 'Blancas' : 'Negras'}. Ganan las ${winner === COLOR.WHITE ? 'Blancas' : 'Negras'}.`,
    { online: false, canPlayAgain: true }
  );
}

function reportOnlineGameFinished() {
  if (!IS_ONLINE || !socket || state._finishReported) return;
  let result = null;
  let winner = null;

  if (state.status === STATUS.CHECKMATE && state.winner) {
    winner = state.winner;
    result = winner === COLOR.WHITE ? 'white_win' : 'black_win';
  } else if (state.status === STATUS.STALEMATE || state.status === STATUS.DRAW) {
    result = 'draw';
  }

  if (!result) return;
  state._finishReported = true;
  socket.emit('game-finished', {
    room: ROOM_CODE,
    result,
    winner,
    pgn: exportMoveList(),
  });
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
  container.classList.toggle('flipped', isBoardFlipped());
  const checkedKingColor =
    (state.status === STATUS.CHECK || state.status === STATUS.CHECKMATE) && isInCheck(state.board, state.turn)
      ? state.turn
      : null;

  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const r = isBoardFlipped() ? 7 - vr : vr;
      const c = isBoardFlipped() ? 7 - vc : vc;
      const sq = document.createElement('div');
      sq.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      sq.dataset.row = r;
      sq.dataset.col = c;
      sq.dataset.viewRow = vr;
      sq.dataset.viewCol = vc;

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
      if (p?.type === PIECE.KING && p.color === checkedKingColor) {
        sq.classList.add('in-check');
      }
      if (p) {
        const key = `${p.color}${p.type}`;
        if (CONFIG.USE_BLENDER_PIECES && BLENDER_PIECE_NAMES[p.type]) {
          const style = p.color === COLOR.WHITE ? 'gold' : 'black';
          const colorClass = p.color === COLOR.WHITE ? 'white' : 'black';
          const pieceName = BLENDER_PIECE_NAMES[p.type];
          sq.innerHTML = `<span class="piece piece-3d piece-${colorClass} piece-${p.type}"><img src="./assets/pieces/blender/${style}/${pieceName}.png" alt="" draggable="false"></span>`;
        } else if (CONFIG.USE_INLINE_SVG && PIECE_SVGS[key]) {
          sq.innerHTML = `<span class="piece piece-${p.color === COLOR.WHITE ? 'white' : 'black'} piece-${p.type}">${PIECE_SVGS[key]}</span>`;
        }
      }

      if (legalMove) {
        const marker = document.createElement('span');
        const isCapture = !!state.board[r][c] || !!legalMove.enPassant;
        marker.className = isCapture ? 'legal-capture' : 'legal-dot';
        sq.appendChild(marker);
      }

      if (vc === 0) {
        const rank = document.createElement('span');
        rank.className = 'rank-label';
        rank.textContent = String(8 - r);
        sq.appendChild(rank);
      }
      if (vr === 7) {
        const file = document.createElement('span');
        file.className = 'file-label';
        file.textContent = 'abcdefgh'[c];
        sq.appendChild(file);
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
  if (IS_ONLINE && !_onlineSynced) return;
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

  if (clickedPiece && clickedPiece.color === state.turn && (!IS_ONLINE || clickedPiece.color === PLAYER_COLOR)) {
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
    message = state.endReason === 'timeout'
      ? `Tiempo agotado. Ganan las ${state.winner === COLOR.WHITE ? 'Blancas' : 'Negras'}.`
      : `¡Jaque Mate! Ganan las ${state.winner === COLOR.WHITE ? 'Blancas' : 'Negras'}.`;
  } else if (state.status === STATUS.STALEMATE) {
    message = 'Tablas por rey ahogado.';
  } else if (state.status === STATUS.DRAW) {
    message = state.endReason === 'fifty_move'
      ? 'Tablas por la regla de 50 movimientos.'
      : 'Partida empatada.';
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

  if (
    IS_BOT_MODE &&
    (state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE || state.status === STATUS.DRAW)
  ) {
    setTimeout(() => {
      const overlay = document.getElementById('game-over-overlay');
      if (overlay?.classList.contains('hidden')) showLocalGameFinished();
    }, 0);
  }
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
  clearLocalGameSnapshot();
  [
    'ozama-room',
    'ozama-color',
    'ozama-names',
    'ozama-player-info',
    'ozama-myname',
    'ozama-token',
    'ozama-room-token',
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
  const rematchBtn = document.getElementById('rematch-btn');

  if (icon) icon.textContent = 'OC';
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  if (playAgain) playAgain.classList.toggle('hidden', !canPlayAgain);
  if (onlineButtons) onlineButtons.classList.remove('hidden');
  if (rematchBtn) rematchBtn.classList.toggle('hidden', !online);
  overlay?.classList.remove('hidden');
}

function hideGameEnd() {
  document.getElementById('game-over-overlay')?.classList.add('hidden');
}

function showConfirm(title, message, onAccept, acceptText = 'Confirmar') {
  const overlay = document.getElementById('confirm-overlay');
  const titleEl = document.getElementById('confirm-title');
  const msgEl = document.getElementById('confirm-message');
  const accept = document.getElementById('confirm-accept-btn');
  const cancel = document.getElementById('confirm-cancel-btn');
  if (!overlay || !accept || !cancel) {
    if (window.confirm(message)) onAccept?.();
    return;
  }
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  accept.textContent = acceptText;
  const close = () => overlay.classList.add('hidden');
  accept.onclick = () => { close(); onAccept?.(); };
  cancel.onclick = close;
  overlay.classList.remove('hidden');
}

function completeResignation() {
  CLOCK.stop();
  playSound('gameover');

  if (IS_ONLINE) {
    socket?.emit('player-resign', { room: ROOM_CODE, pgn: exportMoveList() });
    state.status = STATUS.CHECKMATE;
    state.winner = enemy(PLAYER_COLOR);
    state.endReason = 'resign';
    updateStatusDisplay();
    showGameEnd('TE RENDISTE', 'La partida fue entregada.', { online: true, canPlayAgain: false });
    return;
  }

  const loser = state.turn;
  state.status = STATUS.CHECKMATE;
  state.winner = enemy(loser);
  state.endReason = 'resign';
  clearLocalGameSnapshot();
  renderBoard();
  updateStatusDisplay();
  showGameEnd('RENDICION', `Ganan las ${state.winner === COLOR.WHITE ? 'Blancas' : 'Negras'}.`, {
    online: false,
    canPlayAgain: true,
  });
}

function resignGame() {
  if (state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE || state.status === STATUS.DRAW) return;
  if (state.promotionPending) return;
  showConfirm(
    'RENDIRSE',
    IS_ONLINE
      ? 'Si abandonas ahora, la partida contará como derrota y no se podrá deshacer.'
      : 'Si abandonas ahora, la partida contra el bot terminará de inmediato.',
    completeResignation,
    'Rendirse'
  );
}

function offerDraw() {
  if (!IS_ONLINE || !socket) return;
  if (state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE || state.status === STATUS.DRAW) return;
  showConfirm(
    'OFRECER TABLAS',
    'Tu rival podrá aceptar y la partida terminará como empate.',
    () => socket.emit('draw-offer', { room: ROOM_CODE }),
    'Ofrecer'
  );
}

function setupControls() {
  document.getElementById('resign-btn')?.addEventListener('click', resignGame);
  document.getElementById('draw-offer-btn')?.addEventListener('click', offerDraw);
  document.getElementById('visible-new-game-btn')?.classList.toggle('hidden', IS_ONLINE);
  document.getElementById('visible-draw-btn')?.classList.toggle('hidden', !IS_ONLINE);
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
  document.getElementById('draw-accept-btn')?.addEventListener('click', () => {
    document.getElementById('draw-overlay')?.classList.add('hidden');
    if (IS_ONLINE && socket) socket.emit('draw-accept', { room: ROOM_CODE });
  });
  document.getElementById('draw-decline-btn')?.addEventListener('click', () => {
    document.getElementById('draw-overlay')?.classList.add('hidden');
    if (IS_ONLINE && socket) socket.emit('draw-decline', { room: ROOM_CODE });
  });
}

function setupOnlineSocket() {
  if (!IS_ONLINE || typeof io !== 'function') return;
  socket = io(window.OZAMA_RUNTIME?.socketOrigin, {
    auth: { token: STORED_TOKEN || '' },
    withCredentials: true,
  });

  function rejoin() {
    socket.emit('rejoin', {
      roomCode: ROOM_CODE,
      color: PLAYER_COLOR,
      token: sessionStorage.getItem('ozama-room-token') || '',
      playerName: sessionStorage.getItem('ozama-myname') || '',
    });
  }

  let lastResumeSyncAt = 0;
  function resumeOnlineSession() {
    const now = Date.now();
    if (now - lastResumeSyncAt < 750) return;
    lastResumeSyncAt = now;

    if (socket.disconnected) socket.connect();
    else rejoin();
  }

  window.addEventListener('ozama:resume', resumeOnlineSession);

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

  socket.on('move-rejected', (payload) => {
    const data = typeof payload === 'string' ? { message: payload } : (payload || {});
    console.warn('[OZAMA] Movimiento rechazado:', data.message || 'Movimiento rechazado');
    if (data.game) {
      restoreGameSnapshot(data.game, { clockW: data.clockW, clockB: data.clockB });
    }
  });

  socket.on('clock-tick', ({ w, b } = {}) => {
    if (Number.isFinite(w) && Number.isFinite(b)) CLOCK.set(w, b);
  });

  socket.on('time-out', ({ loser, winner } = {}) => {
    CLOCK.stop();
    playSound('gameover');
    state.status = STATUS.CHECKMATE;
    state.winner = winner === COLOR.WHITE || winner === COLOR.BLACK ? winner : enemy(loser);
    state.endReason = 'timeout';
    state.selected = null;
    state.legalMoves = [];
    updateStatusDisplay();
    renderBoard();
    const loserLabel = loser === COLOR.WHITE ? 'Doradas' : 'Hierro';
    const youWon = state.winner === PLAYER_COLOR;
    showGameEnd(
      youWon ? 'VICTORIA POR TIEMPO' : 'TIEMPO AGOTADO',
      `Se agotó el reloj de las ${loserLabel}.`,
      { online: true, canPlayAgain: false }
    );
  });

  socket.on('game-finished', ({ result, winner, reason } = {}) => {
    CLOCK.stop();
    playSound('gameover');
    state.winner = winner === COLOR.WHITE || winner === COLOR.BLACK ? winner : null;
    state.endReason = reason || null;
    state.selected = null;
    state.legalMoves = [];
    if (result === 'draw') state.status = reason === 'stalemate' ? STATUS.STALEMATE : STATUS.DRAW;
    else if (result === 'white_win' || result === 'black_win') state.status = STATUS.CHECKMATE;
    else state.status = STATUS.DRAW;
    updateStatusDisplay();
    renderBoard();
    if (result === 'draw') {
      const drawMessage = reason === 'stalemate'
        ? 'Partida empatada por rey ahogado.'
        : reason === 'fifty_move'
          ? 'Partida empatada por la regla de 50 movimientos.'
          : 'Partida empatada.';
      showGameEnd('TABLAS', drawMessage, { online: true, canPlayAgain: false });
      return;
    }
    const youWon = state.winner === PLAYER_COLOR;
    showGameEnd(
      youWon ? 'JAQUE MATE' : 'DERROTA',
      `Ganan las ${state.winner === COLOR.WHITE ? 'Blancas' : 'Negras'}.`,
      { online: true, canPlayAgain: false }
    );
  });

  socket.on('room-closed', ({ reason } = {}) => {
    CLOCK.stop();
    playSound('gameover');
    state.status = STATUS.DRAW;
    state.winner = null;
    state.selected = null;
    state.legalMoves = [];
    updateStatusDisplay();
    renderBoard();
    clearOnlineSession();
    showGameEnd('PARTIDA CERRADA', reason || 'La sala fue cerrada por administracion.', { online: true, canPlayAgain: false });
  });

  socket.on('rematch-requested', ({ playerName } = {}) => {
    const sub = document.getElementById('rematch-sub');
    if (sub) sub.textContent = `${playerName || 'Tu rival'} quiere la revancha`;
    document.getElementById('rematch-overlay')?.classList.remove('hidden');
  });

  socket.on('rematch-declined', () => {
    document.getElementById('rematch-overlay')?.classList.add('hidden');
  });

  socket.on('rematch-start', ({ clockW, clockB, roomToken } = {}) => {
    hideGameEnd();
    document.getElementById('rematch-overlay')?.classList.add('hidden');
    startNewGame();
    if (roomToken) sessionStorage.setItem('ozama-room-token', roomToken);
    CLOCK.set(clockW || 600000, clockB || 600000);
  });

  socket.on('draw-offered', ({ playerName } = {}) => {
    const sub = document.getElementById('draw-sub');
    if (sub) sub.textContent = `${playerName || 'Tu rival'} ofrece tablas.`;
    document.getElementById('draw-overlay')?.classList.remove('hidden');
  });

  socket.on('draw-declined', ({ playerName } = {}) => {
    document.getElementById('draw-overlay')?.classList.add('hidden');
    if (typeof appendSystemMessage === 'function') appendSystemMessage(`${playerName || 'Tu rival'} rechazó las tablas`);
  });

  socket.on('draw-accepted', ({ playerName } = {}) => {
    document.getElementById('draw-overlay')?.classList.add('hidden');
    CLOCK.stop();
    playSound('gameover');
    state.status = STATUS.DRAW;
    state.winner = null;
    updateStatusDisplay();
    showGameEnd('TABLAS', `${playerName || 'Tu rival'} aceptó el empate.`, { online: true, canPlayAgain: false });
  });

  socket.on('rejoin-ok', ({ color, playerInfo, currentTurn, clockW, clockB, roomToken, game } = {}) => {
    setConfirmedPlayerColor(color);
    if (roomToken) sessionStorage.setItem('ozama-room-token', roomToken);
    _onlineSynced = true;
    if (playerInfo && typeof updatePlayerBars === 'function') {
      sessionStorage.setItem('ozama-player-info', JSON.stringify(playerInfo));
      updatePlayerBars(playerInfo, PLAYER_COLOR);
    }
    if (typeof updateGameBanner === 'function') updateGameBanner(ROOM_CODE, PLAYER_COLOR);
    const restored = restoreGameSnapshot(game, { clockW, clockB });
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

  socket.on('auth-error', (message) => {
    console.warn('[OZAMA] Auth socket:', message);
    localStorage.removeItem('ozama-user');
    window.OZAMA_RUNTIME?.clearAuthToken?.().catch(() => {});
    clearOnlineSession();
    window.location.href = '/login.html';
  });

  socket.on('connect', rejoin);
  if (socket.connected) rejoin();
}

// Iniciar juego al cargar la página
window.addEventListener('DOMContentLoaded', async () => {
  await window.OZAMA_RUNTIME?.ready;
  STORED_USER = readStoredUser();
  STORED_TOKEN = window.OZAMA_RUNTIME?.getAuthToken?.() || '';
  if (!STORED_USER || (window.OZAMA_RUNTIME?.native && !STORED_TOKEN)) {
    await window.OZAMA_RUNTIME?.clearAuthToken?.().catch(() => {});
    localStorage.removeItem('ozama-user');
    sessionStorage.clear();
    window.location.replace('/login.html');
    return;
  }
  if (!(await validateStoredSession())) return;
  document.body.classList.remove('auth-checking');
  updateSoundButton();
  setupOnlineSocket();
  setupControls();
  if (IS_BOT_MODE && restoreLocalGameSnapshot()) return;
  startNewGame();
});
