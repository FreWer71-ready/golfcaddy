// use APP_VERSION injected into window by index.html; fall back to 1.5.1
const APP_VERSION = (typeof window !== 'undefined' && window.APP_VERSION) ? window.APP_VERSION : '1.6.0';
const TAG = APP_VERSION ? `?v=${APP_VERSION}` : '';
// expose TAG as a global for inline onerror handlers that run in global scope
window.TAG = TAG;

// Hål-data (par, hcp-index, avstånd gul tee i meter) verifierad mot https://torshallagk.se/spela/banan/ 2026-08-13
const H=[[4,10,347],[4,6,356],[4,2,378],[3,18,113],[5,4,491],[5,12,480],[4,8,331],[3,16,140],[4,14,304],[4,9,335],[5,13,497],[3,11,166],[4,5,326],[4,3,347],[3,17,114],[4,1,331],[4,7,363],[5,15,435]].map((x,i)=>({hole:i+1,par:x[0],index:x[1],distance:x[2]}));
// Klubbdata (rangevärden från matta/rangebollar): [namn, snittlängd, maxlängd] i meter
const C=[['Driver 909 D-Comp',145,181],['Järn 5 King F9',115,144],['Järn 8 King F9',113,124],['Järn 7 King F9',109,126],['Järn 9 King F9',101,108],['Pitching Wedge',90,93],['Wedge 60°',72,84]];
// ClubDistance[] för SmartCaddyEngine — byggs en gång ur C, kräver ingen fetch
const clubDistances = SmartCaddyEngine.buildClubDistances(C);

let i=+(localStorage.gcHole||0), wind=0; let scores = {};
let distOverride = null; // null = använd Tee-avstånd (default), annars valfritt avstånd i meter
let lieOverride = null;  // null = använd default-läge ('fairway') när avståndet inte är Tee-avståndet
// Hål-indexerad scorehistorik för Torshälla GK: { "1": [scorer...], "2": [...], ... } — startdata, se assets/data/hole_scores.json
let holeScores = {};
// Personlig Caddy-profil (globalStats m.m.) — startdata, se assets/data/player_profile.json. null tills den laddats.
let playerProfile = null;
try { scores = JSON.parse(localStorage.gcScores || '{}'); } catch(e) { console.warn('Failed to parse gcScores, removing invalid value:', e); localStorage.removeItem('gcScores'); scores = {}; }

// Stableford-poäng (scratch) utifrån score relativt hålets par: eagle+=4, birdie=3, par=2, bogey=1, dubbel+=0
// (Används av "Min statistik", oberoende av SmartCaddyEngine.)
function stablefordPoints(score, par){
  const diff = score - par;
  if(diff<=-2) return 4;
  if(diff===-1) return 3;
  if(diff===0) return 2;
  if(diff===1) return 1;
  return 0;
}

const LIE_LABELS = {fairway:'Fairway', rough:'Ruff', bunker:'Bunker', recovery:'Recovery'};
const RISK_LABELS = {low:'Låg risk', medium:'Medelrisk', high:'Hög risk', very_high:'Mycket hög risk'};
const CONFIDENCE_LABELS = {low:'Lågt dataunderlag', medium:'Medel dataunderlag', high:'Högt dataunderlag'};
const DATA_SOURCE_LABELS = {
  hole_history:'din hålhistorik', global_fairway_pattern:'din fairwaystatistik',
  global_putting_pattern:'din puttstatistik', club_distances:'dina klubblängder',
  course_data:'banans håldata', safety_rules:'allmänna säkerhetsregler'
};

// Bygger CaddyInput åt SmartCaddyEngine utifrån aktuellt hål, valt avstånd, läge och vind.
// lie: 'tee' när Tee-avståndet används (default); annars valt via lie-väljaren (default 'fairway').
// targetType: tee-slag på par 4/5 siktar mot fairway (position), alla andra slag siktar mot green.
function buildCaddyInput(h, dist, isDefaultDist, lie){
  const windStrength = Math.abs(wind)===0 ? 'none' : (Math.abs(wind)<=3 ? 'light' : (Math.abs(wind)<=6 ? 'moderate' : 'strong'));
  const windDirection = wind>0 ? 'headwind' : (wind<0 ? 'tailwind' : 'unknown');
  const hist = SmartCaddyEngine.normalizeHoleHistory('torshallagolfklubb', h.hole, h.par, holeScores[String(h.hole)]);
  const targetType = lie==='tee' ? (h.par===3 ? 'green' : 'fairway') : 'green';
  return {
    courseId: 'torshallagolfklubb', holeNumber: h.hole, par: h.par,
    shotNumber: lie==='tee' ? 1 : 2,
    distanceToTarget: dist, distanceUnit: 'meters',
    lie: lie, targetType: targetType,
    wind: { strength: windStrength, direction: windDirection },
    holeHistory: hist, clubDistances: clubDistances, playerProfile: playerProfile
  };
}

// Renderar CaddyAdvice-objektet från SmartCaddyEngine som HTML för "Personligt råd"-kortet.
function renderCaddyAdviceCard(advice){
  const reasonsHtml = advice.reasons.map(r=>`<li>${r}</li>`).join('');
  const warningsHtml = advice.warnings.length
    ? `<div class="advice-subhead">OBS</div><ul class="reasons warnings">${advice.warnings.map(w=>`<li>${w}</li>`).join('')}</ul>`
    : '';
  const sourcesText = advice.dataSources.map(s=>DATA_SOURCE_LABELS[s]||s).join(', ');
  return `<div class="card advice">
    <small>PERSONLIGT RÅD</small>
    <h3>${advice.headline}</h3>
    <p style="margin:0 0 14px;line-height:1.45">${advice.primaryAdvice}</p>
    <div class="pillrow">
      <span class="pill risk-${advice.risk.level}">${RISK_LABELS[advice.risk.level]}</span>
      <span class="roundsbadge">${CONFIDENCE_LABELS[advice.confidence.level]}</span>
    </div>
    <div class="goalbox"><b>Mål: ${advice.scoreGoal.label}</b><span>${advice.scoreGoal.rationale}</span></div>
    <div class="advice-subhead">VARFÖR</div>
    <ul class="reasons">${reasonsHtml}</ul>
    ${warningsHtml}
    <p class="note">${advice.target.description} Underlag: ${sourcesText}.</p>
  </div>`;
}

function sketch(h){const tag = TAG; const src = `assets/holes/hole${h.hole}.jpg${tag}`;return `<div class="card sketch"><b>Hålskiss · hål ${h.hole}</b><img src="${src}" alt="Hål ${h.hole}" style="width:100%;height:auto;border-radius:12px" onerror="this.src='assets/banguide.jpg'+TAG"/><div class="legend">Officiell hålskiss från Torshälla GK. Klicka nedan för detaljerad banguide.</div><a class="official" href="https://torshallagk.se/spela/banan/" target="_blank" rel="noopener noreferrer">Öppna Torshälla GK:s officiella banguide</a></div>`}
function render(){
  let h=H[i];
  const dist = distOverride!=null ? distOverride : h.distance;
  const isDefaultDist = distOverride==null;
  const lie = isDefaultDist ? 'tee' : (lieOverride || 'fairway');
  const s=scores[h.hole]??h.par;
  const advice = SmartCaddyEngine.getCaddyAdvice(buildCaddyInput(h, dist, isDefaultDist, lie));
  const adviceCard = renderCaddyAdviceCard(advice);
  const distanceCard = `<div class="card row"><b>Avstånd (${isDefaultDist?'Tee':'eget'})</b><div class="stepper"><button onclick="adjustDistance(-1)">−</button> <input id="dist-input" type="number" inputmode="numeric" value="${dist}" style="width:64px;text-align:center;border:1px solid #ddd;border-radius:8px;padding:6px;font-weight:800" onchange="setDistanceValue(this.value)"/> <button onclick="adjustDistance(1)">+</button></div>${isDefaultDist?'':`<button class="button" onclick="resetDistance()">Tee (${h.distance} m)</button>`}</div>`;
  const lieCard = isDefaultDist ? '' : `<div class="card row" style="flex-wrap:wrap;gap:8px"><b>Läge</b><div class="stepper" style="gap:6px">${Object.keys(LIE_LABELS).map(l=>`<button class="button ${lie===l?'primary':''}" style="padding:8px 10px;font-size:12px" onclick="setLie('${l}')">${LIE_LABELS[l]}</button>`).join('')}</div></div>`;
  document.querySelector('#caddy').innerHTML=`<div class="card hero"><div class="badges"><span class="badge">Par ${h.par}</span><span class="badge">Index ${h.index}</span></div><small>HÅL</small><h2>${h.hole}</h2><div>Tee 2</div><div class="distance">${dist} m</div></div>${distanceCard}${lieCard}${adviceCard}${sketch(h)}<div class="card row"><b>Vindjustering</b><div class="stepper"><button onclick="wind--;render()">−</button> <b>${wind>0?'+':''}${wind} m/s</b> <button onclick="wind++;render()">+</button></div></div><div class="nav"><button class="button" onclick="move(-1)" ${i===0?'disabled':''}>‹ Föregående</button><button class="button primary" onclick="move(1)" ${i===17?'disabled':''}>Nästa ›</button></div>`;
  // Update hole-specific stats in profile when rendering a different hole
  try{ renderHoleScores(); }catch(e){/* ignore if profile not mounted yet */}
}
function adjustDistance(delta){
  const h=H[i];
  const base = distOverride!=null ? distOverride : h.distance;
  distOverride = Math.max(1, base+delta);
  if(lieOverride==null) lieOverride='fairway';
  render();
}
function setDistanceValue(v){
  const n = parseInt(v,10);
  if(!isNaN(n) && n>0){ distOverride = n; if(lieOverride==null) lieOverride='fairway'; } else { distOverride = null; lieOverride = null; }
  render();
}
function resetDistance(){ distOverride = null; lieOverride = null; render(); }
function setLie(l){ lieOverride = l; render(); }

/* Score tab removed */

// Min statistik: rent hål-fokuserad — resultat, snittpoäng och snittscore för valt hål (se renderHoleScores)
document.querySelector('#profile').innerHTML=`<div class="card advice"><div class="row" style="align-items:flex-start"><small id="profile-hole-label">PERSONLIGA RESULTAT PÅ HÅL ${H[i].hole}</small><span id="profile-rounds-badge" class="roundsbadge"></span></div><div id="hole-scores-list">Laddar…</div></div>`;
// Mitt Spel: övergripande statistik för hela spelet — laddas från playerProfile (se renderGameTab)
document.querySelector('#game').innerHTML=`<div class="card advice"><small>MITT SPEL</small><h3>Laddar…</h3></div>`;

// Bygger om "Mitt Spel" från den inlästa spelarprofilen (assets/data/player_profile.json).
// Importerade profilvärden visas som de är (inte som en komplett slagdatabas); den enda nya
// procentsatsen som räknas ut här (blowupPct) använder ett internt konsekvent underlag
// (summan av resultatfördelningens egna kategorier) och blandas inte ihop med fairway-/putt-procenten,
// som har en annan (odeklarerad) nämnare.
function renderGameTab(){
  const gs = playerProfile && playerProfile.globalStats;
  if(!gs){ document.querySelector('#game').innerHTML = '<div class="card advice"><small>MITT SPEL</small><h3>Ingen profildata tillgänglig</h3></div>'; return; }
  const hcp = playerProfile.handicap || {};
  const dist = gs.scoreDistribution;
  const totalHoles = dist.birdies+dist.pars+dist.bogeys+dist.doubleBogeys+dist.worseThanDoubleBogey+dist.noResult;
  const blowupPct = totalHoles>0 ? Math.round((dist.doubleBogeys+dist.worseThanDoubleBogey)/totalHoles*100) : null;
  document.querySelector('#game').innerHTML = `<div class="card advice"><small>MITT SPEL</small><h3>Fredrik${hcp.current!=null?', HCP '+hcp.current:''}</h3>${hcp.improvementSinceFirstRound!=null?`<div class="score" style="color:#bef264">−${hcp.improvementSinceFirstRound}</div><div>HCP sedan första registrerade rond</div>`:''}</div><div class="grid"><div class="metric">Ronder<b>${gs.roundsPlayed}</b></div><div class="metric">Snittscore<b>${gs.averageScore}</b></div><div class="metric">Bästa score<b>${gs.bestScore}</b></div><div class="metric">Fairwayträff<b>${gs.fairway.hitPercentage} %</b></div><div class="metric">Puttar/rond<b>${gs.putting.averagePuttsPerRound}</b></div></div><div class="card"><small style="color:#047857;font-weight:800">MISS- OCH PUTTMÖNSTER</small><div class="legend" style="margin-top:6px">Andel av registrerade fairwayslag respektive ronder, ${gs.roundsPlayed} ronder totalt.</div><div class="historygrid" style="grid-template-columns:repeat(3,1fr);margin-top:10px"><div>Miss vä<b>${gs.fairway.missLeftPercentage}%</b></div><div>Fairway<b>${gs.fairway.hitPercentage}%</b></div><div>Miss hö<b>${gs.fairway.missRightPercentage}%</b></div></div><div class="historygrid" style="grid-template-columns:repeat(3,1fr);margin-top:6px"><div>2-putt<b>${gs.putting.twoPuttPercentage}%</b></div><div>3-putt<b>${gs.putting.threePuttPercentage}%</b></div><div>4+ putt<b>${gs.putting.moreThanThreePuttPercentage}%</b></div></div></div><div class="card"><small style="color:#047857;font-weight:800">ÖVERGRIPANDE ANALYS</small><div class="legend" style="margin-top:6px">Resultatfördelning över ${totalHoles} registrerade hålresultat (${dist.noResult} utan resultat), ${gs.roundsPlayed} ronder.</div><div class="historygrid"><div>Birdie<b>${dist.birdies}</b></div><div>Par<b>${dist.pars}</b></div><div>Bogey<b>${dist.bogeys}</b></div><div>Dubbel<b>${dist.doubleBogeys}</b></div><div>Sämre<b>${dist.worseThanDoubleBogey}</b></div></div></div><div class="card"><b>Caddyns fokus</b><p>• Din vanligaste registrerade miss är höger (${gs.fairway.missRightPercentage}%) — välj målområden där en högermiss inte straffar dig hårt.</p><p>• ${gs.putting.threePuttPercentage}% treputtar totalt — prioritera greenens stora del och en hanterbar första putt.</p>${blowupPct!=null?`<p>• ${blowupPct}% av dina registrerade hålresultat är dubbelbogey eller sämre — det är caddyns huvudfokus att sänka den andelen.</p>`:''}</div>`;
}

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
    if(playerProfile && playerProfile.handicap && playerProfile.handicap.current!=null){
      const hcpEl = document.getElementById('stat-hcp');
      if(hcpEl) hcpEl.textContent = String(playerProfile.handicap.current).replace('.',',');
    }
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
// Startdata: hål-scorehistorik (platt format) + spelarprofil. Bundlade JSON-filer i assets/data
// är skrivskyddade när appen körs i webbläsaren — de är bara initialdata, ingen skrivning tillbaka.
Promise.all([
  fetch('assets/data/hole_scores.json'+TAG).then(r=>r.json()).catch(()=>({})),
  fetch('assets/data/player_profile.json'+TAG).then(r=>r.json()).catch(()=>null)
]).then(([scoresData, profileData])=>{
  holeScores = scoresData || {};
  playerProfile = profileData;
  renderGameTab();
  updateHeaderStats(); renderHoleScores();
  render(); // uppdatera Caddy-kortet nu när hålhistorik/profil finns tillgänglig
  // setup hole dropdown drilldown — ankrad till header-wrappern bredvid bannamnet
  const holeBtn = document.getElementById('hole-select-btn');
  const holeSelectWrap = document.getElementById('hole-select-wrap');
  const dd = document.createElement('div'); dd.id='hole-dropdown'; dd.className='card hide'; dd.style.position='absolute'; dd.style.right='0'; dd.style.top='calc(100% + 10px)'; dd.style.width='200px'; dd.style.padding='8px'; dd.style.zIndex='5'; dd.style.maxHeight='60vh'; dd.style.overflowY='auto';
  dd.innerHTML = H.map(h=>`<div style="margin:4px 0"><button class="holebtn" style="width:100%" onclick="go(${h.hole-1});document.getElementById('hole-dropdown').classList.add('hide');">Hål ${h.hole}</button></div>`).join('');
  holeSelectWrap.appendChild(dd);
  holeBtn.onclick = e=>{ e.stopPropagation(); dd.classList.toggle('hide'); };
  document.addEventListener('click',()=>{ if(!dd.classList.contains('hide')) dd.classList.add('hide'); });
}).catch(e=>{console.warn('Kunde inte läsa in startdata', e); const el=document.getElementById('hole-scores-list'); if(el) el.textContent='Ingen data';});

function move(d){i=Math.max(0,Math.min(17,i+d));localStorage.gcHole=i;distOverride=null;lieOverride=null;render()}function go(n){i=n;localStorage.gcHole=i;distOverride=null;lieOverride=null;render()}function setScore(n){scores[H[i].hole]=Math.max(1,n);localStorage.gcScores=JSON.stringify(scores);render()}

try{document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');['caddy','profile','game'].forEach(x=>document.querySelector('#'+x).classList.toggle('hide',x!==b.dataset.tab))});render();}catch(e){console.error('Render failed:',e);const c=document.getElementById('caddy');if(c) c.innerHTML='<div class="card"><b>Fel i UI</b><p>Se konsolen för fel (F12) eller kontakta utvecklaren.</p></div>';}

// PWA / service worker handling
let deferredPrompt;
const statusBox=document.getElementById('pwa-status');
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;statusBox.style.display='block';statusBox.innerHTML='<b>Golfcaddy 1.2 kan installeras</b><br><button id="install-app" class="button primary" style="margin-top:8px">Installera appen</button>';document.getElementById('install-app').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;statusBox.style.display='none';};});
window.addEventListener('appinstalled',()=>{statusBox.style.display='block';statusBox.textContent='Golfcaddy är installerad.';});
window.addEventListener('offline',()=>{statusBox.style.display='block';statusBox.textContent='Offline-läge: appen använder sparat innehåll.';});
window.addEventListener('online',()=>{if(!deferredPrompt)statusBox.style.display='none';});
if('serviceWorker' in navigator){window.addEventListener('load',()=>{fetch('./sw.js',{method:'HEAD'}).then(r=>{if(r.ok){navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('ServiceWorker register failed',e));}else{console.info('No service worker script found (status',r.status,')');}}).catch(()=>{console.info('No service worker script available (fetch failed)')});});}
