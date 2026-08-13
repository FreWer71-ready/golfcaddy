const P={hcp:33.3,rounds:37,torshallaRounds:30,avgPoints:35.1,torshallaAvg:35.2,bestPoints:45,fairway:46,gir:5,putts:40.3,missRight:28,missShort:32,hcpImprovement:10.7};
// use APP_VERSION injected into window by index.html; fall back to 1.3.0
const APP_VERSION = (typeof window !== 'undefined' && window.APP_VERSION) ? window.APP_VERSION : '1.5.1';
const TAG = APP_VERSION ? `?v=${APP_VERSION}` : '';
// expose TAG as a global for inline onerror handlers that run in global scope
window.TAG = TAG;

// Hål-data (par, hcp-index, avstånd gul tee i meter) verifierad mot https://torshallagk.se/spela/banan/ 2026-08-13
const H=[[4,10,347],[4,6,356],[4,2,378],[3,18,113],[5,4,491],[5,12,480],[4,8,331],[3,16,140],[4,14,304],[4,9,335],[5,13,497],[3,11,166],[4,5,326],[4,3,347],[3,17,114],[4,1,331],[4,7,363],[5,15,435]].map((x,i)=>({hole:i+1,par:x[0],index:x[1],distance:x[2]}));
const HS={birdie:1,par:14,bogey:68,double:76,worse:93,putt3:2.0,putt45:2.25};
const C=[['Driver 909 D-Comp',145,181],['Järn 5 King F9',115,144],['Järn 8 King F9',113,124],['Järn 7 King F9',109,126],['Järn 9 King F9',101,108],['Pitching Wedge',90,93],['Wedge 60°',72,84]];
let i=+(localStorage.gcHole||0), wind=0; let scores = {}; // global club data for AI advice
let distOverride = null; // null = använd Tee-avstånd (default), annars valfritt avstånd i meter
// Hål-indexerad scorehistorik för Torshälla GK: { "1": [scorer...], "2": [...], ... }
let holeScores = {};
try { scores = JSON.parse(localStorage.gcScores || '{}'); } catch(e) { console.warn('Failed to parse gcScores, removing invalid value:', e); localStorage.removeItem('gcScores'); scores = {}; }
// Väljer klubban med kortast snittlängd (rangestatistik i C) som ändå når d.
// allowDriver=false utesluter Driver ur bagen — Driver ska bara kunna väljas för tee-slag på par 4/5
// (positionsslag mot fairway), aldrig för slag riktade mot en green (par 3, eller eget/inskrivet avstånd).
// Om ingen klubb når på snittlängd faller vi tillbaka på längsta tillgängliga klubb i bagen som transportslag.
// Används av både rubriken (par 3) och aiAdvice, så de aldrig kan visa olika klubbor för samma längd.
function club(d, allowDriver){
  const driverName = C[0][0];
  const bag = allowDriver===false ? C.filter(c=>c[0]!==driverName) : C;
  const reachable = bag.filter(c=>c[1]>=d).sort((a,b)=>a[1]-b[1]);
  return reachable.length ? reachable[0] : bag.reduce((a,b)=>b[1]>a[1]?b:a);
}

// AI-like heuristic advice generator following provided rules (deterministic, client-side)
// allowDriver: true bara för tee-slag på par 4/5 (positionsslag). Alla slag mot en green — par 3-tee
// eller eget/inskrivet avstånd på valfritt hål — utesluter Driver, oavsett om den räcker på snittlängd.
function aiAdvice(h, dist, allowDriver){
  const canUseDriver = allowDriver === true;
  // Required effective distance uses carry-first and accounts for wind as priority
  const baseDist = dist!=null ? dist : h.distance;
  const req = Math.max(1, Math.round(baseDist + wind*2));
  // find the shortest club (by average carry) that reaches; club() also drives the h3-rubriken ovan
  const driverName = C[0][0];
  const bag = canUseDriver ? C : C.filter(c=>c[0]!==driverName);
  const reachable = bag.filter(c=>c[1]>=req);
  let choice;
  if(reachable.length===0){
    // no club reaches: suggest safe transport with the longest available club in the bag
    const longest = bag.reduce((a,b)=>b[1]>a[1]?b:a);
    choice = {name: longest[0], carry: longest[1], toGreen:false};
  } else {
    const pick = club(req, canUseDriver);
    choice = {name: pick[0], carry: pick[1], toGreen:true};
  }

  // History for hole (Torshälla GK)
  const hist = holeScores[String(h.hole)] || [];
  const histCount = hist.length;
  const histAvg = histCount? Math.round((hist.reduce((a,b)=>a+b,0)/histCount)*10)/10 : null;

  // Decision modifiers
  let playStyle = 'normal';
  if(histCount>=3){
    if(histAvg>h.par) playStyle = 'safe';
    else if(histAvg<=h.par) playStyle = 'offensive';
  }

  // Wind effect text
  const windDesc = Math.abs(wind)<=3? 'svag' : (Math.abs(wind)<=6? 'måttlig' : 'kraftig');
  const windSense = wind>0? 'motvind' : (wind<0? 'medvind' : 'ingen vind');

  // Compose short structured answer (matching previous UI sections)
  let rec, play, why, goal, safety;
  if(!choice.toGreen){
    rec = `${choice.name} mot landning`;
    play = `Säkert transportslag, sikta vänster; justera för ${windDesc} ${windSense}.`;
    why = `Ingen klubb når green med normal carry. Välj landning.`;
    safety = 'Hög';
    goal = h.par;
  } else {
    rec = `${choice.name} mot green`;
    play = `${playStyle==='safe' ? 'Spela säkert, sikta vänster.' : 'Spela mer offensivt, sikta vänster.'} Justera för ${windDesc} ${windSense}.`;
    why = `Carry ${choice.carry}m ≥ behov ${req}m; missar ofta kort/höger.` + (histCount? ` Hist.snitt ${histAvg} över ${histCount}.` : ' Ingen historik.');
    safety = playStyle==='safe' ? 'Hög' : (playStyle==='offensive'? 'Låg' : 'Medel');
    goal = playStyle==='safe' ? Math.max(h.par, Math.round((histAvg||h.par))) : Math.max(h.par-1, Math.round((histAvg||h.par)));
  }

  const ans = `REKOMMENDATION\n${rec}\n\nSPELA SLAGET\n${play}\n\nVARFÖR\n${why}\n\nMÅLSCORE\n${goal}\n\nSÄKERHET\n${safety}`;
  return ans;
}
// Stableford-poäng (scratch) utifrån score relativt hålets par: eagle+=4, birdie=3, par=2, bogey=1, dubbel+=0
function stablefordPoints(score, par){
  const diff = score - par;
  if(diff<=-2) return 4;
  if(diff===-1) return 3;
  if(diff===0) return 2;
  if(diff===1) return 1;
  return 0;
}
function sketch(h){const tag = TAG; const src = `assets/holes/hole${h.hole}.jpg${tag}`;return `<div class="card sketch"><b>Hålskiss · hål ${h.hole}</b><img src="${src}" alt="Hål ${h.hole}" style="width:100%;height:auto;border-radius:12px" onerror="this.src='assets/banguide.jpg'+TAG"/><div class="legend">Officiell hålskiss från Torshälla GK. Klicka nedan för detaljerad banguide.</div><a class="official" href="https://torshallagk.se/spela/banan/" target="_blank" rel="noopener noreferrer">Öppna Torshälla GK:s officiella banguide</a></div>`}
function render(){
  let h=H[i];
  const dist = distOverride!=null ? distOverride : h.distance;
  const isDefaultDist = distOverride==null;
  let eff=Math.max(1,dist+wind*2),s=scores[h.hole]??h.par;
  // Driver är bara rimlig för ett tee-slag som söker position (par 4/5) — aldrig för ett slag riktat
  // mot en green (par 3-tee, eller ett eget/inskrivet avstånd på valfritt hål).
  const allowDriver = isDefaultDist && h.par!==3;
  // Advice moved above sketch
  const adviceCard = `<div class="card advice"><small>PERSONLIGT RÅD</small><h3>${h.par===3?club(eff, allowDriver)[0]:'Spela för position'}</h3><div style="white-space:pre-wrap">${aiAdvice(h, dist, allowDriver)}</div><p class="note">Klubbdistanserna är rangevärden från matta och rangebollar. Driver rekommenderas endast för tee-slag på par 4/5.</p></div>`;
  const distanceCard = `<div class="card row"><b>Avstånd (${isDefaultDist?'Tee':'eget'})</b><div class="stepper"><button onclick="adjustDistance(-1)">−</button> <input id="dist-input" type="number" inputmode="numeric" value="${dist}" style="width:64px;text-align:center;border:1px solid #ddd;border-radius:8px;padding:6px;font-weight:800" onchange="setDistanceValue(this.value)"/> <button onclick="adjustDistance(1)">+</button></div>${isDefaultDist?'':`<button class="button" onclick="resetDistance()">Tee (${h.distance} m)</button>`}</div>`;
  document.querySelector('#caddy').innerHTML=`<div class="card hero"><div class="badges"><span class="badge">Par ${h.par}</span><span class="badge">Index ${h.index}</span></div><small>HÅL</small><h2>${h.hole}</h2><div>Tee 2</div><div class="distance">${dist} m</div></div>${distanceCard}${adviceCard}${sketch(h)}<div class="card row"><b>Vindjustering</b><div class="stepper"><button onclick="wind--;render()">−</button> <b>${wind>0?'+':''}${wind} m/s</b> <button onclick="wind++;render()">+</button></div></div><div class="nav"><button class="button" onclick="move(-1)" ${i===0?'disabled':''}>‹ Föregående</button><button class="button primary" onclick="move(1)" ${i===17?'disabled':''}>Nästa ›</button></div>`;
  // Update hole-specific stats in profile when rendering a different hole
  try{ renderHoleScores(); }catch(e){/* ignore if profile not mounted yet */}
}
function adjustDistance(delta){
  const h=H[i];
  const base = distOverride!=null ? distOverride : h.distance;
  distOverride = Math.max(1, base+delta);
  render();
}
function setDistanceValue(v){
  const n = parseInt(v,10);
  const h = H[i];
  if(!isNaN(n) && n>0){ distOverride = n; } else { distOverride = null; }
  render();
}
function resetDistance(){ distOverride = null; render(); }

/* Score tab removed */

// Min statistik: rent hål-fokuserad — resultat, snittpoäng och snittscore för valt hål (se renderHoleScores)
document.querySelector('#profile').innerHTML=`<div class="card advice"><div class="row" style="align-items:flex-start"><small id="profile-hole-label">PERSONLIGA RESULTAT PÅ HÅL ${H[i].hole}</small><span id="profile-rounds-badge" class="roundsbadge"></span></div><div id="hole-scores-list">Laddar…</div></div>`;
// Mitt Spel: övergripande statistik för hela spelet (handikap, utveckling, snitt, Caddy-analys)
document.querySelector('#game').innerHTML=`<div class="card advice"><small>MITT SPEL</small><h3>Fredrik, HCP ${P.hcp}</h3><div class="score" style="color:#bef264">−${P.hcpImprovement}</div><div>HCP sedan första registrerade rond</div></div><div class="grid">${[['Snittpoäng',P.avgPoints],['Bana',P.torshallaAvg],['Fairway',P.fairway+' %'],['Greenträff',P.gir+' %'],['Puttar/rond',P.putts]].map(x=>`<div class="metric">${x[0]}<b>${x[1]}</b></div>`).join('')}</div><div class="card"><small style="color:#047857;font-weight:800">ÖVERGRIPANDE ANALYS</small><div class="legend" style="margin-top:6px">Resultatsammanfattningen omfattar 19 ronder och redovisar samlade hålutfall, inte specifika hålnummer.</div><div class="historygrid"><div>Birdie<b>${HS.birdie}</b></div><div>Par<b>${HS.par}</b></div><div>Bogey<b>${HS.bogey}</b></div><div>Dubbel<b>${HS.double}</b></div><div>Sämre<b>${HS.worse}</b></div></div></div><div class="card"><b>Caddyns fokus</b><p>• Välj mer klubba. 32 % av greenmissarna är korta.</p><p>• Sikta vänster om centrum. 28 % av greenmissarna är höger.</p><p>• Prioritera fairway och träna lagputtning.</p></div>`;
function computeClubStats(){
  const data = holeScores;
  // determine number of full rounds (all 18 holes present at index)
  const holeKeys = H.map(h=>String(h.hole));
  const lengths = holeKeys.map(h=> (data[h]||[]).length );
  const roundsCount = Math.min(...lengths);
  if(!roundsCount || roundsCount<=0) return {rounds:0,best:null};
  const totals = [];
  for(let ri=0;ri<roundsCount;ri++){
    let sum = 0; for(const hk of holeKeys){ sum += (data[hk][ri]||0); } totals.push(sum);
  }
  const best = Math.min(...totals);
  return {rounds: roundsCount, best};
}
function updateHeaderStats(){
  try{
    const stats = computeClubStats();
    document.getElementById('stat-rounds').textContent = stats.rounds || 0;
    document.getElementById('stat-best').textContent = stats.best || '-';
    document.getElementById('header-club-name').textContent = 'Torshälla GK';
  }catch(e){console.warn('updateHeaderStats failed',e)}
}
function renderHoleScores(){
  const h = H[i];
  const holeNum = h.hole;
  const label = document.getElementById('profile-hole-label');
  if(label) label.textContent = `PERSONLIGA RESULTAT PÅ HÅL ${holeNum}`;
  const data = holeScores[String(holeNum)] || [];
  const listEl = document.getElementById('hole-scores-list');
  const badge = document.getElementById('profile-rounds-badge');
  if(!listEl) return;
  if(!data || data.length===0){
    if(badge) badge.textContent = '0 ronder';
    listEl.innerHTML = '<div class="legend" style="margin-top:16px;text-align:center">Ingen data registrerad för det här hålet ännu.</div>';
    return;
  }
  const count = data.length;
  const avgScore = Math.round((data.reduce((a,b)=>a+b,0)/count)*10)/10;
  const avgPoints = Math.round((data.reduce((a,b)=>a+stablefordPoints(b,h.par),0)/count)*10)/10;
  if(badge) badge.textContent = `${count} ${count===1?'rond':'ronder'}`;
  const recent = data.slice(-5).reverse();
  // Formindikator: lime = under par, mint = par, dämpad = över par (samma gröna palett som resten av appen)
  const pillClass = s => s<h.par ? 'under' : (s===h.par ? 'par' : '');
  const pills = recent.map(s=>`<div class="formpill ${pillClass(s)}">${s}</div>`).join('');
  listEl.innerHTML = `<div class="statgrid"><div class="stattile"><b>${avgScore}</b><span>Snitt score</span></div><div class="stattile"><b>${avgPoints}</b><span>Snitt poäng</span></div></div><div class="formlabel">Senaste ${recent.length}</div><div class="formrow">${pills}</div>`;
}
// Hål-indexerad scorehistorik (Torshälla GK, platt format: { "hål": [scorer...] })
fetch('assets/data/hole_scores.json'+TAG).then(r=>r.json()).then(data=>{
  holeScores = data || {};
  updateHeaderStats(); renderHoleScores();
  // setup hole dropdown drilldown — ankrad till header-wrappern bredvid bannamnet
  const holeBtn = document.getElementById('hole-select-btn');
  const holeSelectWrap = document.getElementById('hole-select-wrap');
  const dd = document.createElement('div'); dd.id='hole-dropdown'; dd.className='card hide'; dd.style.position='absolute'; dd.style.right='0'; dd.style.top='calc(100% + 10px)'; dd.style.width='200px'; dd.style.padding='8px'; dd.style.zIndex='5'; dd.style.maxHeight='60vh'; dd.style.overflowY='auto';
  dd.innerHTML = H.map(h=>`<div style="margin:4px 0"><button class="holebtn" style="width:100%" onclick="go(${h.hole-1});document.getElementById('hole-dropdown').classList.add('hide');">Hål ${h.hole}</button></div>`).join('');
  holeSelectWrap.appendChild(dd);
  holeBtn.onclick = e=>{ e.stopPropagation(); dd.classList.toggle('hide'); };
  document.addEventListener('click',()=>{ if(!dd.classList.contains('hide')) dd.classList.add('hide'); });
}).catch(e=>{document.getElementById('hole-scores-list').textContent='Ingen data'});

function move(d){i=Math.max(0,Math.min(17,i+d));localStorage.gcHole=i;distOverride=null;render()}function go(n){i=n;localStorage.gcHole=i;distOverride=null;render()}function setScore(n){scores[H[i].hole]=Math.max(1,n);localStorage.gcScores=JSON.stringify(scores);render()}

try{document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');['caddy','profile','game'].forEach(x=>document.querySelector('#'+x).classList.toggle('hide',x!==b.dataset.tab))});render();}catch(e){console.error('Render failed:',e);const c=document.getElementById('caddy');if(c) c.innerHTML='<div class="card"><b>Fel i UI</b><p>Se konsolen för fel (F12) eller kontakta utvecklaren.</p></div>';}

// PWA / service worker handling
let deferredPrompt;
const statusBox=document.getElementById('pwa-status');
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;statusBox.style.display='block';statusBox.innerHTML='<b>Golfcaddy 1.2 kan installeras</b><br><button id="install-app" class="button primary" style="margin-top:8px">Installera appen</button>';document.getElementById('install-app').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;statusBox.style.display='none';};});
window.addEventListener('appinstalled',()=>{statusBox.style.display='block';statusBox.textContent='Golfcaddy är installerad.';});
window.addEventListener('offline',()=>{statusBox.style.display='block';statusBox.textContent='Offline-läge: appen använder sparat innehåll.';});
window.addEventListener('online',()=>{if(!deferredPrompt)statusBox.style.display='none';});
if('serviceWorker' in navigator){window.addEventListener('load',()=>{fetch('./sw.js',{method:'HEAD'}).then(r=>{if(r.ok){navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('ServiceWorker register failed',e));}else{console.info('No service worker script found (status',r.status,')');}}).catch(()=>{console.info('No service worker script available (fetch failed)')});});}
