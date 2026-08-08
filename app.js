const P={hcp:33.3,rounds:37,torshallaRounds:30,avgPoints:35.1,torshallaAvg:35.2,bestPoints:45,fairway:46,gir:5,putts:40.3,missRight:28,missShort:32,hcpImprovement:10.7};
// use APP_VERSION injected into window by index.html; fall back to 1.2.8
const APP_VERSION = (typeof window !== 'undefined' && window.APP_VERSION) ? window.APP_VERSION : '1.2.9';
const TAG = APP_VERSION ? `?v=${APP_VERSION}` : '';
// expose TAG as a global for inline onerror handlers that run in global scope
window.TAG = TAG;

const H=[[4,10,347],[4,6,356],[4,2,378],[3,18,113],[5,4,491],[5,12,480],[4,8,331],[3,16,140],[4,14,304],[4,9,335],[5,13,497],[3,11,166],[4,5,326],[4,3,347],[3,17,114],[4,1,379],[4,7,363],[5,15,435]].map((x,i)=>({hole:i+1,par:x[0],index:x[1],distance:x[2]}));
const HS={birdie:1,par:14,bogey:68,double:76,worse:93,putt3:2.0,putt45:2.25};
const C=[['Driver 909 D-Comp',145,181],['Järn 5 King F9',115,144],['Järn 8 King F9',113,124],['Järn 7 King F9',109,126],['Järn 9 King F9',101,108],['Pitching Wedge',90,93],['Wedge 60°',72,84]];
let i=+(localStorage.gcHole||0), wind=0; let scores = {}; // global club data for AI advice
let clubDataGlobal = {}; let clubDisplayNames = {}; let selectedClub = 'all';
// fetch club-indexed data early so Caddy advice can use history
fetch('assets/data/hole_scores_by_club.json?v=1.2.6').then(r=>r.json()).then(d=>{ clubDataGlobal = d || {}; }).catch(()=>{ clubDataGlobal = {}; });
try { scores = JSON.parse(localStorage.gcScores || '{}'); } catch(e) { console.warn('Failed to parse gcScores, removing invalid value:', e); localStorage.removeItem('gcScores'); scores = {}; }
function club(d){if(d>168)return C[0];return C.reduce((a,b)=>Math.abs(b[1]-d)<Math.abs(a[1]-d)?b:a)}

// AI-like heuristic advice generator following provided rules (deterministic, client-side)
function aiAdvice(h){
  const eff = Math.max(1, h.distance + wind*2);
  // pick nearest club by carry
  const pick = club(eff);
  const carry = pick[1];
  const clubName = pick[0];
  // history from clubDataGlobal (prefer Torshälla if available)
  const clubKey = clubDataGlobal['torshallagolfklubb'] ? 'torshallagolfklubb' : (Object.keys(clubDataGlobal).find(k=>k!=='all')||'all');
  const history = (clubDataGlobal[clubKey] && clubDataGlobal[clubKey][String(h.hole)]) || [];
  const histCount = history.length;
  const histAvg = histCount? Math.round(history.reduce((a,b)=>a+b,0)/histCount):null;

  // Safety & strategy
  let rec, play, why, goal, safety;
  if(carry < eff){
    rec = `${clubName} mot landning`;
    play = `Spela transportslag, sikta vänster om centrum.`;
    why = `För liten carry (${carry}m) vs ${eff}m; missar ofta kort/höger.`;
    safety = 'Hög';
    goal = h.par;
  } else {
    rec = `${clubName} mot green`;
    const windDesc = Math.abs(wind)<=3?'svag':(Math.abs(wind)<=6?'måttlig':'tydlig');
    const windDir = wind>0? 'motvind':'medvind';
    play = `Lugn tempo, sikta vänster om centrum, justera för ${windDesc} ${windDir}.`;
    why = histCount>=3? `Hist.avg ${histAvg} över ${histCount} ronder.` : (histCount>0? 'Begränsat historiskt underlag.' : 'Ingen historik; basera på carry och vind.');
    safety = histAvg && histAvg>h.par? 'Hög' : 'Medel';
    goal = histAvg? Math.max(h.par, Math.round((histAvg+h.par)/2)) : h.par;
  }
  // Compose compact answer under 45 words in required format
  const ans = `REKOMMENDATION\n${rec}\n\nSPELA SLAGET\n${play}\n\nVARFÖR\n${why}\n\nMÅLSCORE\n${goal}\n\nSÄKERHET\n${safety}`;
  return ans;
}
function sketch(h){const tag = TAG; const src = `assets/holes/hole${h.hole}.jpg${tag}`;return `<div class="card sketch"><b>Hålskiss · hål ${h.hole}</b><img src="${src}" alt="Hål ${h.hole}" style="width:100%;height:auto;border-radius:12px" onerror="this.src='assets/banguide.jpg'+TAG"/><div class="legend">Officiell hålskiss från Torshälla GK. Klicka nedan för detaljerad banguide.</div><a class="official" href="https://torshallagk.se/spela/banan/" target="_blank" rel="noopener noreferrer">Öppna Torshälla GK:s officiella banguide</a></div>`}
function render(){
  let h=H[i],eff=Math.max(1,h.distance+wind*2),s=scores[h.hole]??h.par;
  // Advice moved above sketch
  const adviceCard = `<div class="card advice"><small>PERSONLIGT RÅD</small><h3>${h.par===3?club(eff)[0]:'Spela för position'}</h3><div style="white-space:pre-wrap">${aiAdvice(h)}</div><p class="note">Klubbdistanserna är rangevärden från matta och rangebollar.</p></div>`;
  document.querySelector('#caddy').innerHTML=`<div class="card hero"><div class="badges"><span class="badge">Par ${h.par}</span><span class="badge">Index ${h.index}</span></div><small>HÅL</small><h2>${h.hole}</h2><div>Tee 2</div><div class="distance">${h.distance} m</div></div>${adviceCard}${sketch(h)}<div class="card"><small style="color:#047857;font-weight:800">PERSONLIG HÅLSTATISTIK</small><h3 style="margin:5px 0">Underlag för hål ${h.hole}</h3><div class="legend">Resultatsammanfattningen omfattar 19 ronder och redovisar samlade hålutfall, inte specifika hålnummer.</div><div class="grid" style="margin-top:10px"><div class="metric">Puttar/hål<b>${h.par===3?HS.putt3:HS.putt45}</b></div><div class="metric">Fairway<b>${h.par===3?'Ej tillämpligt':'46 %'}</b></div><div class="metric">GIR<b>5 %</b></div></div><div class="historygrid"><div>Birdie<b>${HS.birdie}</b></div><div>Par<b>${HS.par}</b></div><div>Bogey<b>${HS.bogey}</b></div><div>Dubbel<b>${HS.double}</b></div><div>Sämre<b>${HS.worse}</b></div></div></div><div class="card row"><b>Vindjustering</b><div class="stepper"><button onclick="wind--;render()">−</button> <b>${wind>0?'+':''}${wind} m/s</b> <button onclick="wind++;render()">+</button></div></div><div class="nav"><button class="button" onclick="move(-1)" ${i===0?'disabled':''}>‹ Föregående</button><button class="button primary" onclick="move(1)" ${i===17?'disabled':''}>Nästa ›</button></div>`;
}

/* Score tab removed */

// profile + data fetch
document.querySelector('#profile').innerHTML=`<div class="card advice"><small>PERSONLIG NULÄGESBILD</small><h3>Fredrik, HCP ${P.hcp}</h3><div class="score" style="color:#bef264">−${P.hcpImprovement}</div><div>HCP sedan första registrerade rond</div></div><div class="grid">${[['Snittpoäng',P.avgPoints],['Torshälla',P.torshallaAvg],['Fairway',P.fairway+' %'],['Greenträff',P.gir+' %'],['Puttar/rond',P.putts],['Ronder',P.rounds]].map(x=>`<div class="metric">${x[0]}<b>${x[1]}</b></div>`).join('')}</div><div class="card" id="hole-stats"><small>Hålscorer</small><div style="margin-top:8px"><label for="club-filter">Filtrera på bana:</label> <select id="club-filter"><option value="all">Alla klubbar</option></select></div><div id="hole-scores-list">Laddar…</div></div><div class="card"><b>Caddyns fokus</b><p>• Välj mer klubba. 32 % av greenmissarna är korta.</p><p>• Sikta vänster om centrum. 28 % av greenmissarna är höger.</p><p>• Prioritera fairway och träna lagputtning.</p></div>`;
let clubData = {};
function renderHoleScores(){
  const data = clubData[selectedClub]||{};
  const list = Object.keys(data).sort((a,b)=>a-b).map(h=>`<div class="metric">Hål ${h}<b>${data[h].join(', ')}</b></div>`).join('');
  document.getElementById('hole-scores-list').innerHTML = list?`<div class="grid">${list}</div>`:'<div>Ingen data för valt filter</div>';
}
fetch('assets/data/hole_scores_by_club.json'+TAG).then(r=>r.json()).then(data=>{
  clubData = data || {};
  // populate select
  const sel = document.getElementById('club-filter');
  // keep 'all' option
  Object.keys(clubData).filter(k=>k!=='all').sort().forEach(k=>{
    const opt = document.createElement('option'); opt.value=k; opt.textContent = k.replace(/golfklubb|golfklubb/g,'').replace(/_/g,' ');
    sel.appendChild(opt);
  });
  sel.onchange = e=>{ selectedClub = e.target.value; renderHoleScores(); };
  // default to Torshälla if present
  if(clubData['torshallagolfklubb']){ selectedClub='torshallagolfklubb'; sel.value=selectedClub }
  renderHoleScores();
}).catch(e=>{document.getElementById('hole-scores-list').textContent='Ingen data'});

function move(d){i=Math.max(0,Math.min(17,i+d));localStorage.gcHole=i;render()}function go(n){i=n;localStorage.gcHole=i;render()}function setScore(n){scores[H[i].hole]=Math.max(1,n);localStorage.gcScores=JSON.stringify(scores);render()}

try{document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');['caddy','profile'].forEach(x=>document.querySelector('#'+x).classList.toggle('hide',x!==b.dataset.tab))});render();}catch(e){console.error('Render failed:',e);const c=document.getElementById('caddy');if(c) c.innerHTML='<div class="card"><b>Fel i UI</b><p>Se konsolen för fel (F12) eller kontakta utvecklaren.</p></div>';}

// PWA / service worker handling
let deferredPrompt;
const statusBox=document.getElementById('pwa-status');
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;statusBox.style.display='block';statusBox.innerHTML='<b>Golfcaddy 1.2 kan installeras</b><br><button id="install-app" class="button primary" style="margin-top:8px">Installera appen</button>';document.getElementById('install-app').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;statusBox.style.display='none';};});
window.addEventListener('appinstalled',()=>{statusBox.style.display='block';statusBox.textContent='Golfcaddy är installerad.';});
window.addEventListener('offline',()=>{statusBox.style.display='block';statusBox.textContent='Offline-läge: appen använder sparat innehåll.';});
window.addEventListener('online',()=>{if(!deferredPrompt)statusBox.style.display='none';});
if('serviceWorker' in navigator){window.addEventListener('load',()=>{fetch('./sw.js',{method:'HEAD'}).then(r=>{if(r.ok){navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('ServiceWorker register failed',e));}else{console.info('No service worker script found (status',r.status,')');}}).catch(()=>{console.info('No service worker script available (fetch failed)')});});}
