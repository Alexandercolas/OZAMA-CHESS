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
function _soundMove(ctx)    { _tone(ctx,{type:'sine',    freq:750,endFreq:420,vol:.28,duration:.10}); }
function _soundCapture(ctx) { _tone(ctx,{type:'sawtooth',freq:320,endFreq:90, vol:.38,duration:.18}); _tone(ctx,{type:'sine',freq:180,endFreq:80,vol:.2,duration:.22,delay:.02}); }
function _soundCheck(ctx)   { _tone(ctx,{type:'square',freq:620,endFreq:620,vol:.22,duration:.11}); _tone(ctx,{type:'square',freq:840,endFreq:840,vol:.22,duration:.11,delay:.14}); }
function _soundCastle(ctx)  { _tone(ctx,{type:'sine',freq:680,endFreq:380,vol:.28,duration:.09}); _tone(ctx,{type:'sine',freq:580,endFreq:320,vol:.28,duration:.09,delay:.13}); }
function _soundGameover(ctx){ [{freq:520,delay:0},{freq:414,delay:.18},{freq:310,delay:.36},{freq:260,delay:.54}].forEach(({freq,delay})=>_tone(ctx,{type:'sine',freq,endFreq:freq*.7,vol:.18,duration:.7,delay})); }
function _tone(ctx,{type,freq,endFreq,vol,duration,delay=0}){
  const t=ctx.currentTime+delay, osc=ctx.createOscillator(), env=ctx.createGain();
  osc.connect(env); env.connect(ctx.destination);
  osc.type=type; osc.frequency.setValueAtTime(freq,t);
  if(endFreq!==freq) osc.frequency.exponentialRampToValueAtTime(endFreq,t+duration);
  env.gain.setValueAtTime(vol,t); env.gain.exponentialRampToValueAtTime(.0001,t+duration);
  osc.start(t); osc.stop(t+duration+.01);
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
  wp:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><linearGradient id="wg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/></linearGradient></defs><circle cx="22.5" cy="10" r="6.5" fill="url(#wg)" stroke="#7A5800" stroke-width="1.2"/><path d="M17 34 Q16 24 22.5 21 Q29 24 28 34 Z" fill="url(#wg)" stroke="#7A5800" stroke-width="1.2"/><rect x="10" y="34" width="25" height="4.5" rx="2.2" fill="url(#wg)" stroke="#7A5800" stroke-width="1.2"/></svg>`,
  wn:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><linearGradient id="wg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/></linearGradient></defs><path d="M22 38 H9 L11 29 Q8 24 10 18 Q12 12 18 9 Q20 7 23 8 Q28 7 30 11 Q32 14 30 18 L34 22 Q33 26 28 28 L27 38 Z" fill="url(#wg2)" stroke="#7A5800" stroke-width="1.3"/><circle cx="19" cy="13" r="2" fill="#7A5800"/><path d="M18 9 Q16 6 13 7 Q11 10 14 13" fill="url(#wg2)" stroke="#7A5800" stroke-width="1"/></svg>`,
  wb:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><linearGradient id="wg3" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/></linearGradient></defs><circle cx="22.5" cy="8" r="3.5" fill="url(#wg3)" stroke="#7A5800" stroke-width="1.2"/><path d="M22.5 11 Q27 15 28 21 Q29 28 26 32 L19 32 Q16 28 17 21 Q18 15 22.5 11 Z" fill="url(#wg3)" stroke="#7A5800" stroke-width="1.2"/><path d="M16 32 Q14 33 14 34 L31 34 Q31 33 29 32 Z" fill="url(#wg3)" stroke="#7A5800" stroke-width="1"/><rect x="9" y="34" width="27" height="4" rx="2" fill="url(#wg3)" stroke="#7A5800" stroke-width="1.2"/></svg>`,
  wr:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><linearGradient id="wg4" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/></linearGradient></defs><rect x="9" y="7" width="6" height="9" rx="1" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/><rect x="20" y="7" width="5" height="9" rx="1" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/><rect x="30" y="7" width="6" height="9" rx="1" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/><path d="M9 16 L12 16 L12 32 L33 32 L33 16 L36 16 L36 14 L9 14 Z" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/><rect x="8" y="32" width="29" height="4.5" rx="2" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/></svg>`,
  wq:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><linearGradient id="wg5" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/></linearGradient></defs><circle cx="8" cy="11" r="3.5" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/><circle cx="22.5" cy="7" r="3.5" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/><circle cx="37" cy="11" r="3.5" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/><circle cx="14" cy="9" r="2.8" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.1"/><circle cx="31" cy="9" r="2.8" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.1"/><path d="M8 13 L10 31 Q16 28 22.5 30 Q29 28 35 31 L37 13 L31 20 L22.5 11 L14 20 Z" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/><path d="M10 31 Q16 34 22.5 33 Q29 34 35 31 L35 34 Q29 37 22.5 36 Q16 37 10 34 Z" fill="url(#wg5)" stroke="#7A5800" stroke-width="1"/><rect x="8" y="34" width="29" height="4.5" rx="2" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/></svg>`,
  wk:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><defs><linearGradient id="wg6" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/></linearGradient></defs><rect x="20" y="4" width="5" height="13" rx="2" fill="url(#wg6)" stroke="#7A5800" stroke-width="1.2"/><rect x="15" y="7" width="15" height="5" rx="2" fill="url(#wg6)" stroke="#7A5800" stroke-width="1.2"/><path d="M11 31 Q10 23 14 19 Q18 16 22.5 16 Q27 16 31 19 Q35 23 34 31 Z" fill="url(#wg6)" stroke="#7A5800" stroke-width="1.2"/><rect x="9" y="31" width="27" height="4.5" rx="2" fill="url(#wg6)" stroke="#7A5800" stroke-width="1.2"/></svg>`,
  bp:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><circle cx="22.5" cy="10" r="6.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><path d="M17 34 Q16 24 22.5 21 Q29 24 28 34 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><rect x="10" y="34" width="25" height="4.5" rx="2.2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/></svg>`,
  bn:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><path d="M22 38 H9 L11 29 Q8 24 10 18 Q12 12 18 9 Q20 7 23 8 Q28 7 30 11 Q32 14 30 18 L34 22 Q33 26 28 28 L27 38 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><circle cx="19" cy="13" r="2" fill="#D4AF37"/><path d="M18 9 Q16 6 13 7 Q11 10 14 13" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1"/></svg>`,
  bb:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><circle cx="22.5" cy="8" r="3.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><path d="M22.5 11 Q27 15 28 21 Q29 28 26 32 L19 32 Q16 28 17 21 Q18 15 22.5 11 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><path d="M16 32 Q14 33 14 34 L31 34 Q31 33 29 32 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1"/><rect x="9" y="34" width="27" height="4" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/></svg>`,
  br:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><rect x="9" y="7" width="6" height="9" rx="1" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><rect x="20" y="7" width="5" height="9" rx="1" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><rect x="30" y="7" width="6" height="9" rx="1" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><path d="M9 16 L12 16 L12 32 L33 32 L33 16 L36 16 L36 14 L9 14 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><rect x="8" y="32" width="29" height="4.5" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/></svg>`,
  bq:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><circle cx="8" cy="11" r="3.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><circle cx="22.5" cy="7" r="3.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><circle cx="37" cy="11" r="3.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><circle cx="14" cy="9" r="2.8" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.2"/><circle cx="31" cy="9" r="2.8" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.2"/><path d="M8 13 L10 31 Q16 28 22.5 30 Q29 28 35 31 L37 13 L31 20 L22.5 11 L14 20 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><path d="M10 31 Q16 34 22.5 33 Q29 34 35 31 L35 34 Q29 37 22.5 36 Q16 37 10 34 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.2"/><rect x="8" y="34" width="29" height="4.5" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/></svg>`,
  bk:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><rect x="20" y="4" width="5" height="13" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><rect x="15" y="7" width="15" height="5" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><path d="M11 31 Q10 23 14 19 Q18 16 22.5 16 Q27 16 31 19 Q35 23 34 31 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/><rect x="9" y="31" width="27" height="4.5" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/></svg>`,
};

// ================================================================
// SECTION 3: GAME STATE
// ================================================================
let state = {
  board:[], turn:COLOR.WHITE, selected:null, legalMoves:[],
  castlingRights:{ w:{kingside:true,queenside:true}, b:{kingside:true,queenside:true} },
  enPassantTarget:null, status:STATUS.PLAYING, winner:null,
  moveCount:0, halfMoveClock:0, moveHistory:[],
  promotionPending:null, _pendingHistoryEntry:null,
  lastMove:null, _autoPromotionPiece:null, _finishReported:false,
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
    const elW = document.getElementById('clock-white');
    const elB = document.getElementById('clock-black');
    if (elW) { elW.textContent = _fmt(_times.w); elW.style.color = _times.w < 10000 ? '#ef4444' : ''; }
    if (elB) { elB.textContent = _fmt(_times.b); elB.style.color = _times.b < 10000 ? '#ef4444' : ''; }
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
// SECTION 9: SPECIAL MOVES
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
function applyPromotion(row,col,color,chosenType,isRemoteMove=false){
  if(!state.promotionPending)return;
  state.board[row][col]={type:chosenType,color}; state.promotionPending=null;
  if(!isRemoteMove)hidePromotionDialog();
  if(state._pendingHistoryEntry) state._pendingHistoryEntry.promotion=chosenType;
  state.turn=enemy(color);
  const ns=evaluateGameStatus(state.board,state.turn,state);
  state.status=ns; if(ns===STATUS.CHECKMATE)state.winner=color;
  if(ns===STATUS.CHECKMATE||ns===STATUS.STALEMATE||ns===STATUS.DRAW) { CLOCK.stop(); }
  else if(!IS_ONLINE) { CLOCK.switchTo(state.turn); }
  if(state._pendingHistoryEntry){
    const e=state._pendingHistoryEntry;
    e.check=(ns===STATUS.CHECK||ns===STATUS.CHECKMATE); e.checkmate=(ns===STATUS.CHECKMATE);
    e.notation=getMoveNotation(e); state.moveHistory.push(e);
    if(IS_ONLINE&&!isRemoteMove) socket.emit('player-move',{room:ROOM_CODE,from:e.from,to:e.to,promotion:chosenType});
  }
  state._pendingHistoryEntry=null; state._autoPromotionPiece=null;
  if(ns===STATUS.CHECKMATE||ns===STATUS.STALEMATE||ns===STATUS.DRAW)setTimeout(()=>playSound('gameover'),60);
  else if(ns===STATUS.CHECK){playSound('move');setTimeout(()=>playSound('check'),60);}
  else playSound('move');
  renderBoard(); updateStatusDisplay();
  if(ns===STATUS.CHECKMATE||ns===STATUS.STALEMATE||ns===STATUS.DRAW){
    notifyGameFinished(ns,state.winner);
    setTimeout(()=>showGameOver(ns,state.winner),350);
  } else {
    maybeScheduleBotMove();
  }
}

// ================================================================
// SECTION 10: MOVE EXECUTION
// ================================================================
function executeMove(from,to,isRemoteMove=false){
  const piece=state.board[from.row][from.col]; if(!piece)return;
  const boardBefore=cloneBoard(state.board), epTargetBefore=state.enPassantTarget ? {...state.enPassantTarget} : null;
  const capturedPiece=state.board[to.row][to.col] ? {...state.board[to.row][to.col]} : null;
  const isCastling=!!to.castling, isEnPassant=!!to.enPassant, isCapture=!!(capturedPiece||isEnPassant);
  let enPassantCaptured=null;
  if(isEnPassant&&state.enPassantTarget){enPassantCaptured={...state.board[from.row][state.enPassantTarget.col]};state.board[from.row][state.enPassantTarget.col]=null;}
  state.board[to.row][to.col]={...piece}; state.board[from.row][from.col]=null;
  if(isCastling){
    if(to.castling==='kingside'){state.board[to.row][5]=state.board[to.row][7];state.board[to.row][7]=null;}
    else{state.board[to.row][3]=state.board[to.row][0];state.board[to.row][0]=null;}
  }
  if(piece.type===PIECE.KING){state.castlingRights[piece.color].kingside=false;state.castlingRights[piece.color].queenside=false;}
  if(piece.type===PIECE.ROOK){if(from.col===7)state.castlingRights[piece.color].kingside=false;if(from.col===0)state.castlingRights[piece.color].queenside=false;}
  if(capturedPiece?.type===PIECE.ROOK){if(to.col===7)state.castlingRights[capturedPiece?.color].kingside=false;if(to.col===0)state.castlingRights[capturedPiece?.color].queenside=false;}
  state.enPassantTarget=null;
  if(piece.type===PIECE.PAWN&&Math.abs(to.row-from.row)===2) state.enPassantTarget={row:(from.row+to.row)/2,col:from.col};
  state.halfMoveClock=(piece.type===PIECE.PAWN||isCapture) ? 0 : state.halfMoveClock+1;
  state.lastMove={from:{...from},to:{...to}};
  const historyEntry={from,to,piece:{...piece},captured:capturedPiece||enPassantCaptured,castling:to.castling||null,enPassant:isEnPassant,promotion:null,check:false,checkmate:false,notation:'',moveCount:state.moveCount,boardBefore,epTargetBefore};
  state.moveCount++;
  const _backRank=piece.color===COLOR.WHITE?0:7;
  if(state.board[to.row][to.col]?.type===PIECE.PAWN&&to.row===_backRank){
    state.promotionPending     ={row:to.row,col:to.col,color:piece.color};
    state._pendingHistoryEntry =historyEntry;
    if(state._autoPromotionPiece){
      applyPromotion(to.row,to.col,piece.color,state._autoPromotionPiece,true);
    } else {
      showPromotionDialog(to.row,to.col,piece.color);
      renderBoard();
    }
    return;
  }
  state.turn=enemy(piece.color);
  const ns=evaluateGameStatus(state.board,state.turn,state);
  state.status=ns; if(ns===STATUS.CHECKMATE)state.winner=piece.color;
  if(ns===STATUS.CHECKMATE||ns===STATUS.STALEMATE||ns===STATUS.DRAW) { CLOCK.stop(); }
  else if(!IS_ONLINE) { CLOCK.switchTo(state.turn); }
  historyEntry.check=(ns===STATUS.CHECK||ns===STATUS.CHECKMATE); historyEntry.checkmate=(ns===STATUS.CHECKMATE);
  historyEntry.notation=getMoveNotation(historyEntry); state.moveHistory.push(historyEntry);
  if(IS_ONLINE&&!isRemoteMove) socket.emit('player-move',{room:ROOM_CODE,from,to});
  if(ns===STATUS.CHECKMATE||ns===STATUS.STALEMATE||ns===STATUS.DRAW)setTimeout(()=>playSound('gameover'),60);
  else if(ns===STATUS.CHECK){if(isCastling)playSound('castle');else if(isCapture)playSound('capture');else playSound('move');setTimeout(()=>playSound('check'),80);}
  else if(isCastling)playSound('castle'); else if(isCapture)playSound('capture'); else playSound('move');
  state.selected=null; state.legalMoves=[];
  renderBoard(); updateStatusDisplay();
  if(ns===STATUS.CHECKMATE||ns===STATUS.STALEMATE||ns===STATUS.DRAW){
    notifyGameFinished(ns,state.winner);
    setTimeout(()=>showGameOver(ns,state.winner),350);
  } else {
    maybeScheduleBotMove();
  }
}

// ================================================================
// SECTION 11: EVENT HANDLING
// ================================================================
function handleSquareClick(row,col){
  if(IS_ONLINE&&state.turn!==PLAYER_COLOR)return;
  if(IS_BOT_MODE&&state.turn===BOT_COLOR)return;
  if(state.promotionPending)return;
  if(state.status===STATUS.CHECKMATE||state.status===STATUS.STALEMATE||state.status===STATUS.DRAW)return;
  const clicked=state.board[row][col];
  if(!state.selected){
    if(!clicked||clicked.color!==state.turn)return;
    const moves=getLegalMovesForSquare(state.board,row,col,state);
    if(!moves.length)return;
    state.selected={row,col}; state.legalMoves=moves; renderBoard(); return;
  }
  if(state.selected.row===row&&state.selected.col===col){state.selected=null;state.legalMoves=[];renderBoard();return;}
  const targetMove=state.legalMoves.find(m=>m.row===row&&m.col===col);
  if(targetMove){executeMove(state.selected,targetMove);return;}
  if(clicked&&clicked.color===state.turn){state.selected={row,col};state.legalMoves=getLegalMovesForSquare(state.board,row,col,state);renderBoard();return;}
  state.selected=null; state.legalMoves=[]; renderBoard();
}

// ================================================================
// SECTION 12: RENDERING
// ================================================================
function renderBoard(){
  const boardEl=document.getElementById('board'); if(!boardEl)return;
  boardEl.innerHTML='';
  const kingInCheck=(state.status===STATUS.CHECK||state.status===STATUS.CHECKMATE) ? findKing(state.board,state.turn) : null;
  for(let vr=0;vr<8;vr++){
    for(let vc=0;vc<8;vc++){
      const r=CONFIG.BOARD_FLIPPED ? 7-vr : vr;
      const c=CONFIG.BOARD_FLIPPED ? 7-vc : vc;
      const sq=document.createElement('div'),isLight=(r+c)%2===0;
      sq.className=`square ${isLight?'light':'dark'}`;
      sq.dataset.row=r; sq.dataset.col=c;
      if(state.lastMove){if(r===state.lastMove.from.row&&c===state.lastMove.from.col)sq.classList.add('last-move-from');if(r===state.lastMove.to.row&&c===state.lastMove.to.col)sq.classList.add('last-move-to');}
      if(state.selected?.row===r&&state.selected?.col===c)sq.classList.add('selected');
      if(kingInCheck?.row===r&&kingInCheck?.col===c)sq.classList.add('in-check');
      if(state.legalMoves.some(m=>m.row===r&&m.col===c)){const ind=document.createElement('div');ind.className=state.board[r][c]?'legal-capture':'legal-dot';sq.appendChild(ind);}
      const piece=state.board[r][c];
      if(piece){const pd=document.createElement('div');pd.className='piece';pd.innerHTML=getPieceSVG(piece);sq.appendChild(pd);}
      if(vc===0){const rl=document.createElement('span');rl.className='rank-label';rl.textContent=8-r;sq.appendChild(rl);}
      if(vr===7){const fl=document.createElement('span');fl.className='file-label';fl.textContent='abcdefgh'[c];sq.appendChild(fl);}
      sq.addEventListener('click',()=>handleSquareClick(r,c));
      boardEl.appendChild(sq);
    }
  }
}
function getPieceSVG(piece){
  const key=piece.color+piece.type;
  return CONFIG.USE_INLINE_SVG ? PIECE_SVGS[key]||'' : `<img src="${CONFIG.PIECE_PATH}${key}.svg" alt="${key}" draggable="false"/>`;
}

// ================================================================
// SECTION 13: STATUS DISPLAY & UI
// ================================================================
function updateStatusDisplay(){
  const el=document.getElementById('status-message'); if(!el)return;
  const turnName=state.turn===COLOR.WHITE?'White':'Black';
  const winnerName=state.winner===COLOR.WHITE?'White':'Black';
  const messages={[STATUS.PLAYING]:`${turnName}'s turn`,[STATUS.CHECK]:`⚠️ ${turnName} is in CHECK!`,[STATUS.CHECKMATE]:`♚ CHECKMATE — ${winnerName} wins!`,[STATUS.STALEMATE]:`🤝 STALEMATE — draw!`,[STATUS.DRAW]:`🤝 DRAW — 50-move rule.`};
  if(IS_ONLINE&&(state.status===STATUS.PLAYING||state.status===STATUS.CHECK)){
    const mySide=PLAYER_COLOR===COLOR.WHITE?'Blancas':'Negras';
    const turnSide=state.turn===COLOR.WHITE?'blancas':'negras';
    el.textContent=`Juegas con ${mySide} · Turno de ${turnSide}`;
  } else {
    el.textContent=messages[state.status]||'';
  }
  const active=state.status===STATUS.PLAYING||state.status===STATUS.CHECK;
  document.getElementById('white-turn').classList.toggle('active',state.turn===COLOR.WHITE&&active);
  document.getElementById('black-turn').classList.toggle('active',state.turn===COLOR.BLACK&&active);
}

function showGameOver(status,winner){
  const overlay=document.getElementById('game-over-overlay'); if(!overlay)return;
  const titleEl=overlay.querySelector('#game-over-title');
  const subEl  =overlay.querySelector('#game-over-subtitle');
  const iconEl =overlay.querySelector('#game-over-icon');
  const playAgainBtn     =overlay.querySelector('#play-again-btn');
  const onlineEndButtons =overlay.querySelector('#online-end-buttons');
  if(IS_ONLINE){
    if(status===STATUS.CHECKMATE){
      if(winner===PLAYER_COLOR){
        if(iconEl)  iconEl.textContent='🏆';
        if(titleEl) titleEl.textContent='¡GANASTE!';
        if(subEl)   subEl.textContent='Hiciste jaque mate';
      } else {
        if(iconEl)  iconEl.textContent='😔';
        if(titleEl) titleEl.textContent='PERDISTE';
        if(subEl)   subEl.textContent='Tu rival hizo jaque mate';
      }
    } else if(status===STATUS.STALEMATE||status===STATUS.DRAW){
      if(iconEl)  iconEl.textContent='🤝';
      if(titleEl) titleEl.textContent='EMPATE';
      if(subEl)   subEl.textContent='Tablas — nadie gana';
    }
    playAgainBtn.classList.add('hidden');
    onlineEndButtons.classList.remove('hidden');
  } else {
    if(status===STATUS.CHECKMATE){
      const w=winner===COLOR.WHITE?'White':'Black';
      if(iconEl)  iconEl.textContent='♛';
      if(titleEl) titleEl.textContent='CHECKMATE';
      if(subEl)   subEl.textContent=`${w} wins the game!`;
    } else if(status===STATUS.STALEMATE){
      if(iconEl)  iconEl.textContent='🤝';
      if(titleEl) titleEl.textContent='STALEMATE';
      if(subEl)   subEl.textContent='The game is a draw.';
    } else if(status===STATUS.DRAW){
      if(iconEl)  iconEl.textContent='🤝';
      if(titleEl) titleEl.textContent='DRAW';
      if(subEl)   subEl.textContent='50-move rule.';
    }
    playAgainBtn.classList.remove('hidden');
    onlineEndButtons.classList.add('hidden');
  }
  overlay.classList.remove('hidden');
}

function hideGameOver(){document.getElementById('game-over-overlay').classList.add('hidden');}

function notifyGameFinished(status,winner){
  if(!IS_ONLINE||!socket||state._finishReported)return;
  if(!(status===STATUS.CHECKMATE||status===STATUS.STALEMATE||status===STATUS.DRAW))return;
  let result='draw', winnerCode=null;
  if(status===STATUS.CHECKMATE){ winnerCode=winner; result=winner===COLOR.WHITE?'white_win':'black_win'; }
  state._finishReported=true;
  socket.emit('game-finished',{ room:ROOM_CODE, result, winner:winnerCode, pgn:exportMoveList() });
}

function showPromotionDialog(row,col,color){
  const dialog=document.getElementById('promotion-dialog');
  if(!dialog){applyPromotion(row,col,color,PIECE.QUEEN);return;}
  const container=dialog.querySelector('.promotion-options');
  if(container){
    container.innerHTML='';
    [PIECE.QUEEN,PIECE.ROOK,PIECE.BISHOP,PIECE.KNIGHT].forEach(type=>{
      const btn=document.createElement('button');
      btn.className='promotion-btn'; btn.innerHTML=getPieceSVG({type,color}); btn.title=type.toUpperCase();
      btn.addEventListener('click',()=>applyPromotion(row,col,color,type));
      container.appendChild(btn);
    });
  }
  dialog.classList.remove('hidden');
}
function hidePromotionDialog(){document.getElementById('promotion-dialog').classList.add('hidden');}

let _disconnectInterval=null;
function showDisconnectOverlay(seconds=30){
  const ov=document.getElementById('disconnect-overlay'); if(!ov)return;
  const timerEl=document.getElementById('disconnect-timer');
  let remaining=seconds;
  if(timerEl)timerEl.textContent=remaining;
  ov.classList.remove('hidden');
  _disconnectInterval=setInterval(()=>{ remaining--; if(timerEl)timerEl.textContent=remaining; if(remaining<=0){clearInterval(_disconnectInterval);_disconnectInterval=null;} },1000);
}
function hideDisconnectOverlay(){
  if(_disconnectInterval){clearInterval(_disconnectInterval);_disconnectInterval=null;}
  document.getElementById('disconnect-overlay').classList.add('hidden');
}

// ================================================================
// SECTION 14: GAME CONTROLS
// ================================================================
function setupControls(){
  document.getElementById('new-game-btn').addEventListener('click',()=>{ if(IS_ONLINE)return; hideGameOver(); startNewGame(); });
  document.getElementById('resign-btn').addEventListener('click',()=>{
    if(state.status===STATUS.CHECKMATE||state.status===STATUS.STALEMATE||state.status===STATUS.DRAW||state.promotionPending)return;
    if(IS_ONLINE){
      socket.emit('player-resign',{room:ROOM_CODE,pgn:exportMoveList()});
      const iconEl=document.querySelector('#game-over-icon');
      const titleEl=document.querySelector('#game-over-title');
      const subEl=document.querySelector('#game-over-subtitle');
      if(iconEl)  iconEl.textContent='🏳️';
      if(titleEl) titleEl.textContent='ABANDONASTE';
      if(subEl)   subEl.textContent='Rendiste la partida';
      document.getElementById('game-over-overlay').classList.remove('hidden');
      document.getElementById('play-again-btn').classList.add('hidden');
      document.getElementById('online-end-buttons').classList.remove('hidden');
    } else {
      CLOCK.stop();
      state.status=STATUS.CHECKMATE; state.winner=enemy(state.turn);
      playSound('gameover'); updateStatusDisplay(); renderBoard();
      setTimeout(()=>showGameOver(STATUS.CHECKMATE,state.winner),200);
    }
  });
  document.getElementById('play-again-btn').addEventListener('click',()=>{hideGameOver();startNewGame();});
  document.getElementById('rematch-btn').addEventListener('click',()=>{ if(IS_ONLINE) socket.emit('rematch-request',{room:ROOM_CODE}); });
  document.getElementById('lobby-btn').addEventListener('click',()=>{
    clearOnlineSession();
    window.location.href='/lobby.html';
  });
  document.getElementById('rematch-accept-btn').addEventListener('click',()=>{ document.getElementById('rematch-overlay').classList.add('hidden'); if(IS_ONLINE) socket.emit('rematch-accept',{room:ROOM_CODE}); });
  document.getElementById('rematch-decline-btn').addEventListener('click',()=>{ document.getElementById('rematch-overlay').classList.add('hidden'); if(IS_ONLINE) socket.emit('rematch-decline',{room:ROOM_CODE}); });
}

// ================================================================
// SECTION 15: INITIALIZATION
// ================================================================
function init(){
  if(IS_ONLINE) CONFIG.BOARD_FLIPPED = PLAYER_COLOR === COLOR.BLACK;
  setupControls();
  document.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'&&!state.promotionPending&&(state.status===STATUS.PLAYING||state.status===STATUS.CHECK)){state.selected=null;state.legalMoves=[];renderBoard();}
    if((e.key==='n'||e.key==='N')&&!IS_ONLINE&&(state.status===STATUS.CHECKMATE||state.status===STATUS.STALEMATE)){hideGameOver();startNewGame();}
  });
  startNewGame();
  console.log('%c♟ OZAMA CHESS v2 — Ready','color:#D4AF37;font-size:14px;font-weight:bold;');
}
document.addEventListener('DOMContentLoaded',init);

// ================================================================
// SECTION 16: FUTURE HOOKS
// ================================================================
function flipBoard(){CONFIG.BOARD_FLIPPED=!CONFIG.BOARD_FLIPPED;renderBoard();}
function exportMoveList(){let pgn='',n=1;for(const e of state.moveHistory){if(e.piece.color===COLOR.WHITE)pgn+=`${n}. ${e.notation} `;else{pgn+=`${e.notation} `;n++;}}return pgn.trim();}

function clearOnlineSession(){
  sessionStorage.removeItem('ozama-room');
  sessionStorage.removeItem('ozama-color');
  sessionStorage.removeItem('ozama-names');
  sessionStorage.removeItem('ozama-player-info');
  sessionStorage.removeItem('ozama-myname');
  sessionStorage.removeItem('ozama-token');
  sessionStorage.removeItem('ozama-bot-mode');
  sessionStorage.removeItem('ozama-bot-color');
  sessionStorage.removeItem('ozama-bot-difficulty');
  sessionStorage.removeItem('ozama-time-control');
}

// ================================================================
// SECTION 17: MULTIPLAYER — Socket.io
// ================================================================
const ROOM_CODE    = sessionStorage.getItem('ozama-room');
const RAW_PLAYER_COLOR = sessionStorage.getItem('ozama-color');
const PLAYER_COLOR = RAW_PLAYER_COLOR === 'white' ? COLOR.WHITE
  : RAW_PLAYER_COLOR === 'black' ? COLOR.BLACK
  : RAW_PLAYER_COLOR;
const PLAYER_NAMES = JSON.parse(sessionStorage.getItem('ozama-names')||'{}');
const MY_NAME      = sessionStorage.getItem('ozama-myname')||'';
const IS_ONLINE    = !!(ROOM_CODE && PLAYER_COLOR);
const IS_BOT_MODE  = !IS_ONLINE && sessionStorage.getItem('ozama-bot-mode') === 'true';
const BOT_COLOR    = sessionStorage.getItem('ozama-bot-color') || COLOR.BLACK;
const BOT_LEVEL    = sessionStorage.getItem('ozama-bot-difficulty') || 'medium';

let socket = null;
let _botThinking = false;

function maybeScheduleBotMove(){
  if(!IS_BOT_MODE || _botThinking || state.promotionPending)return;
  if(!(state.status===STATUS.PLAYING||state.status===STATUS.CHECK))return;
  if(state.turn!==BOT_COLOR)return;
  if(typeof BOT==='undefined'||!BOT.move){
    console.warn('[BOT] bot.js no esta cargado.');
    return;
  }

  _botThinking=true;
  updateOnlineBannerLocal(`Ozama Bot pensando (${BOT_LEVEL})...`);
  BOT.move(state.board, BOT_COLOR, BOT_LEVEL, {
    castlingRights: state.castlingRights,
    enPassantTarget: state.enPassantTarget,
    halfMoveClock: state.halfMoveClock,
  }, (move)=>{
    _botThinking=false;
    updateOnlineBannerLocal('');
    if(!move || state.turn!==BOT_COLOR || state.promotionPending)return;
    const piece=state.board[move.from.row][move.from.col];
    if(piece.type===PIECE.PAWN&&(move.to.row===0||move.to.row===7)) state._autoPromotionPiece=PIECE.QUEEN;
    executeMove(move.from, move.to, true);
    state._autoPromotionPiece=null;
  });
}

function updateOnlineBannerLocal(text){
  let banner=document.getElementById('bot-banner');
  if(!IS_BOT_MODE)return;
  if(!banner){
    banner=document.createElement('div');
    banner.id='bot-banner';
    Object.assign(banner.style,{
      position:'fixed', top:'0', left:'0', right:'0', padding:'8px 20px',
      background:'rgba(212,175,55,0.18)', borderBottom:'1px solid rgba(212,175,55,0.45)',
      textAlign:'center', fontSize:'11px', fontWeight:'700', letterSpacing:'2px',
      color:'#D4AF37', zIndex:'100',
    });
    document.body.prepend(banner);
    document.body.style.paddingTop='34px';
  }
  banner.textContent=text || `VS OZAMA BOT - ${BOT_LEVEL.toUpperCase()} - Tu juegas Blancas`;
}

if(IS_BOT_MODE){
  document.addEventListener('DOMContentLoaded',()=>updateOnlineBannerLocal(''));
}

if(IS_ONLINE){
  socket = io({ auth: { token: sessionStorage.getItem('ozama-token') || '' } });

  function doRejoin(){
    socket.emit('rejoin',{roomCode:ROOM_CODE,color:PLAYER_COLOR,playerName:MY_NAME});
  }
  socket.on('connect',doRejoin);
  if(socket.connected)doRejoin();

  socket.on('opponent-move',({from,to,promotion})=>{
    if(promotion)state._autoPromotionPiece=promotion;
    executeMove(from,to,true);
    state._autoPromotionPiece=null;
  });

  socket.on('opponent-resigned',({playerName})=>{
    CLOCK.stop();
    playSound('gameover');
    const iconEl=document.querySelector('#game-over-icon');
    const titleEl=document.querySelector('#game-over-title');
    const subEl=document.querySelector('#game-over-subtitle');
    if(iconEl)  iconEl.textContent='🏆';
    if(titleEl) titleEl.textContent='¡GANASTE!';
    if(subEl)   subEl.textContent=`${playerName||'Tu rival'} abandonó la partida`;
    document.getElementById('game-over-overlay').classList.remove('hidden');
    document.getElementById('play-again-btn').classList.add('hidden');
    document.getElementById('online-end-buttons').classList.remove('hidden');
  });

  socket.on('rematch-requested',({playerName})=>{
    const sub=document.getElementById('rematch-sub');
    if(sub)sub.textContent=`${playerName||'Tu rival'} quiere la revancha`;
    document.getElementById('rematch-overlay').classList.remove('hidden');
  });

  socket.on('rematch-declined',()=>{ document.getElementById('rematch-overlay').classList.add('hidden'); });

  socket.on('rematch-start',({ clockW, clockB } = {})=>{
    document.getElementById('rematch-overlay').classList.add('hidden');
    CLOCK.set(clockW || 600000, clockB || 600000);
    hideGameOver(); startNewGame();
  });

  socket.on('opponent-disconnected',()=>{
    CLOCK.stop();
    showDisconnectOverlay(30);
    updateOnlineBanner('Rival desconectado. Esperando…',true);
  });

  socket.on('opponent-reconnected',({playerName})=>{
    hideDisconnectOverlay();
    updateOnlineBanner(`SALA: ${ROOM_CODE}  ·  ${PLAYER_COLOR==='w' ? '⚪ BLANCAS' : '⚫ NEGRAS'}`);
  });

  socket.on('opponent-timeout',()=>{
    CLOCK.stop();
    hideDisconnectOverlay(); playSound('gameover');
    const iconEl=document.querySelector('#game-over-icon');
    const titleEl=document.querySelector('#game-over-title');
    const subEl=document.querySelector('#game-over-subtitle');
    if(iconEl)  iconEl.textContent='🏆';
    if(titleEl) titleEl.textContent='¡GANASTE!';
    if(subEl)   subEl.textContent='Tu rival no regresó';
    document.getElementById('game-over-overlay').classList.remove('hidden');
    document.getElementById('play-again-btn').classList.add('hidden');
    document.getElementById('online-end-buttons').classList.remove('hidden');
  });

  socket.on('move-rejected',(msg)=>{ console.warn('[!] Movida rechazada:',msg); updateOnlineBanner(msg||'Movida rechazada',true); });

  socket.on('rejoin-failed',(msg)=>{
    console.warn('[!] Rejoin fallido:',msg);
    updateOnlineBanner(msg||'No se pudo reconectar',true);
    clearOnlineSession();
    setTimeout(()=>{ window.location.href='/lobby.html'; },1200);
  });

  socket.on('connect_error',()=>updateOnlineBanner('Sin conexión con el servidor',true));

  socket.on('clock-tick', ({ w, b }) => { CLOCK.set(w, b); });

  socket.on('time-out', ({ winner }) => {
    CLOCK.stop();
    const isWinner = winner === PLAYER_COLOR;
    const iconEl  = document.querySelector('#game-over-icon');
    const titleEl = document.querySelector('#game-over-title');
    const subEl   = document.querySelector('#game-over-subtitle');
    if(iconEl)  iconEl.textContent  = isWinner ? '🏆' : '😔';
    if(titleEl) titleEl.textContent = isWinner ? '¡GANASTE!' : 'PERDISTE';
    if(subEl)   subEl.textContent   = isWinner ? 'Tu rival se quedó sin tiempo' : 'Se te acabó el tiempo';
    document.getElementById('game-over-overlay').classList.remove('hidden');
    document.getElementById('play-again-btn').classList.add('hidden');
    document.getElementById('online-end-buttons').classList.remove('hidden');
    playSound('gameover');
  });

  // ── Banner ────────────────────────────────────────────────────
  const _banner=document.createElement('div');
  _banner.id='online-banner';
  Object.assign(_banner.style,{
    position:'fixed', top:'0', left:'0', right:'0',
    padding:'8px 20px',
    background:'rgba(212,175,55,0.22)',
    borderBottom:'1px solid rgba(212,175,55,0.6)',
    textAlign:'center',
    fontSize:'11px', fontWeight:'700', letterSpacing:'2px',
    color:'#D4AF37', zIndex:'100', transition:'all 0.3s',
  });
  const rivalName=PLAYER_COLOR==='w' ? PLAYER_NAMES.b : PLAYER_NAMES.w;
  _banner.textContent=`SALA: ${ROOM_CODE}  ·  ${PLAYER_COLOR==='w' ? '⚪ BLANCAS' : '⚫ NEGRAS'}${rivalName ? '  ·  vs '+rivalName : ''}`;
  document.body.prepend(_banner);
  document.body.style.paddingTop='34px';

  function updateOnlineBanner(msg,isError=false){
    _banner.textContent=msg;
    _banner.style.background=isError ? 'rgba(239,68,68,0.2)' : 'rgba(212,175,55,0.22)';
    _banner.style.borderBottom=isError ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(212,175,55,0.6)';
    _banner.style.color=isError ? '#ef4444' : '#D4AF37';
  }

  // ── Botón lobby ───────────────────────────────────────────────
  const _back=document.createElement('button');
  _back.textContent='← Lobby';
  Object.assign(_back.style,{position:'fixed',top:'5px',right:'12px',background:'transparent',border:'none',color:'rgba(212,175,55,0.6)',fontSize:'11px',fontWeight:'700',letterSpacing:'1px',cursor:'pointer',zIndex:'101',padding:'4px 8px',borderRadius:'4px'});
  _back.onmouseover=()=>{_back.style.color='#D4AF37';};
  _back.onmouseout =()=>{_back.style.color='rgba(212,175,55,0.6)';};
  _back.onclick=()=>{
    clearOnlineSession();
    window.location.href='/lobby.html';
  };
  document.body.appendChild(_back);

  document.addEventListener('DOMContentLoaded',()=>{
    const btn=document.getElementById('new-game-btn');
    if(btn){btn.style.opacity='0.3';btn.style.cursor='not-allowed';btn.title='No disponible en partida online';}
  });
}