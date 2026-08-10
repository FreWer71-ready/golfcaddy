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
  // Required effective distance uses carry-first and accounts for wind as priority
  const req = Math.max(1, Math.round(h.distance + wind*2));
  // find clubs that can reach by carry
  const reachable = C.map((c,idx)=>({idx, name:c[0], carry:c[1]})).filter(c=>c.carry>=req);
  let choice;
  if(reachable.length===0){
    // no club reaches: suggest safe transport with longest available carry
    choice = {name: C[0][0], carry: C[0][1], toGreen:false};
  } else {
    // choose the smallest carry that still reaches (but prefer longer when between two)
    reachable.sort((a,b)=>a.carry-b.carry);
    let pick = reachable[0];
    // if there is a previous shorter club, and we're between two, prefer the longer club
    const prevIdx = C.findIndex(x=>x[1]===pick.carry)+1; // index of pick in C (approx)
    // simpler: if second candidate exists, pick the longer candidate when ambiguous
    if(reachable.length>1){
      // pick the first (shortest reaching) but prefer the second (longer) in most cases per rules
      pick = reachable[ Math.min(1, reachable.length-1) ];
    }
    choice = {name: pick.name, carry: pick.carry, toGreen:true};
  }

  // History for hole
  const clubKey = clubDataGlobal['torshallagolfklubb'] ? 'torshallagolfklubb' : (Object.keys(clubDataGlobal).find(k=>k!=='all')||'all');
  const hist = (clubDataGlobal[selectedClub] && clubDataGlobal[selectedClub][String(h.hole)]) || (clubDataGlobal[clubKey] && clubDataGlobal[clubKey][String(h.hole)]) || [];
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
function sketch(h){const tag = TAG; const src = `assets/holes/hole${h.hole}.jpg${tag}`;return `<div class="card sketch"><b>Hålskiss · hål ${h.hole}</b><img src="${src}" alt="Hål ${h.hole}" style="width:100%;height:auto;border-radius:12px" onerror="this.src='assets/banguide.jpg'+TAG"/><div class="legend">Officiell hålskiss från Torshälla GK. Klicka nedan för detaljerad banguide.</div><a class="official" href="https://torshallagk.se/spela/banan/" target="_blank" rel="noopener noreferrer">Öppna Torshälla GK:s officiella banguide</a></div>`}
function render(){
  let h=H[i],eff=Math.max(1,h.distance+wind*2),s=scores[h.hole]??h.par;
  // Advice moved above sketch
  const adviceCard = `<div class="card advice"><small>PERSONLIGT RÅD</small><h3>${h.par===3?club(eff)[0]:'Spela för position'}</h3><div style="white-space:pre-wrap">${aiAdvice(h)}</div><p class="note">Klubbdistanserna är rangevärden från matta och rangebollar.</p></div>`;
  document.querySelector('#caddy').innerHTML=`<div class="card hero"><div class="badges"><span class="badge">Par ${h.par}</span><span class="badge">Index ${h.index}</span></div><small>HÅL</small><h2>${h.hole}</h2><div>Tee 2</div><div class="distance">${h.distance} m</div></div>${adviceCard}${sketch(h)}<div class="card"><small style="color:#047857;font-weight:800">PERSONLIG HÅLSTATISTIK</small><h3 style="margin:5px 0">Underlag för hål ${h.hole}</h3><div class="legend">Resultatsammanfattningen omfattar 19 ronder och redovisar samlade hålutfall, inte specifika hålnummer.</div><div class="grid" style="margin-top:10px"><div class="metric">Puttar/hål<b>${h.par===3?HS.putt3:HS.putt45}</b></div><div class="metric">Fairway<b>${h.par===3?'Ej tillämpligt':'46 %'}</b></div><div class="metric">GIR<b>5 %</b></div></div><div class="historygrid"><div>Birdie<b>${HS.birdie}</b></div><div>Par<b>${HS.par}</b></div><div>Bogey<b>${HS.bogey}</b></div><div>Dubbel<b>${HS.double}</b></div><div>Sämre<b>${HS.worse}</b></div></div></div><div class="card row"><b>Vindjustering</b><div class="stepper"><button onclick="wind--;render()">−</button> <b>${wind>0?'+':''}${wind} m/s</b> <button onclick="wind++;render()">+</button></div></div><div class="nav"><button class="button" onclick="move(-1)" ${i===0?'disabled':''}>‹ Föregående</button><button class="button primary" onclick="move(1)" ${i===17?'disabled':''}>Nästa ›</button></div>`;
  // Update hole-specific stats in profile when rendering a different hole
  try{ renderHoleScores(); }catch(e){/* ignore if profile not mounted yet */}
}

/* Score tab removed */

// profile + data fetch
document.querySelector('#profile').innerHTML=`<div class="card advice"><small>PERSONLIG NULÄGESBILD</small><h3>Fredrik, HCP ${P.hcp}</h3><div class="score" style="color:#bef264">−${P.hcpImprovement}</div><div>HCP sedan första registrerade rond</div></div><div class="grid">${[['Snittpoäng',P.avgPoints],['Bana',P.torshallaAvg],['Fairway',P.fairway+' %'],['Greenträff',P.gir+' %'],['Puttar/rond',P.putts]].map(x=>`<div class="metric">${x[0]}<b>${x[1]}</b></div>`).join('')}</div><div class="card" id="hole-stats"><small>Hålscorer</small><div style="margin-top:8px"><div id="hole-scores-list">Laddar…</div></div></div><div class="card"><b>Caddyns fokus</b><p>• Välj mer klubba. 32 % av greenmissarna är korta.</p><p>• Sikta vänster om centrum. 28 % av greenmissarna är höger.</p><p>• Prioritera fairway och träna lagputtning.</p></div>`;
let clubData = {};
function computeClubStats(clubKey){
  const data = clubData[clubKey] || {};
  // determine number of full rounds (all 18 holes present at index)
  const holeKeys = H.map(h=>String(h.hole));
  if(holeKeys.some(h=>!data[h]||data[h].length===0)){
    // if any hole missing entirely, rounds likely zero
  }
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
    const key = selectedClub || 'all';
    const stats = computeClubStats(key);
    document.getElementById('stat-rounds').textContent = stats.rounds || 0;
    document.getElementById('stat-best').textContent = stats.best || '-';
    // update header club name
    const name = (document.getElementById('club-header-select') && document.getElementById('club-header-select').selectedOptions[0]) ? document.getElementById('club-header-select').selectedOptions[0].textContent : document.getElementById('header-club-name').textContent;
    document.getElementById('header-club-name').textContent = name || 'Torshälla GK';
  }catch(e){console.warn('updateHeaderStats failed',e)}
}
function renderHoleScores(){
  const holeNum = H[i].hole;
  const data = (clubData[selectedClub] && clubData[selectedClub][String(holeNum)]) || [];
  if(!data || data.length===0){
    document.getElementById('hole-scores-list').innerHTML = '<div>Ingen data för valt filter och hål</div>';
    return;
  }
  const count = data.length;
  const avg = Math.round((data.reduce((a,b)=>a+b,0)/count)*10)/10;
  const recent = data.slice(-5).reverse().join(', ');
  document.getElementById('hole-scores-list').innerHTML = `<div class="grid"><div class="metric">Hål ${holeNum}<b></b></div><div class="metric">Ronder<b>${count}</b></div><div class="metric">Snitt<b>${avg}</b></div></div><div style="margin-top:8px">Senaste: ${recent}</div>`;
}
fetch('assets/data/hole_scores_by_club.json'+TAG).then(r=>r.json()).then(data=>{
  clubData = data || {};
  // populate header select
  const sel = document.getElementById('club-header-select');
  if(!sel) return;
  const allOpt = document.createElement('option'); allOpt.value='all'; allOpt.textContent='Alla klubbar'; sel.appendChild(allOpt);
  Object.keys(clubData).filter(k=>k!=='all').sort().forEach(k=>{
    const opt = document.createElement('option'); opt.value=k; opt.textContent = k.replace(/golfklubb|golfklubb/g,'').replace(/_/g,' ');
    sel.appendChild(opt);
  });
  sel.onchange = e=>{ selectedClub = e.target.value; updateHeaderStats(); renderHoleScores(); };
  // default to Torshälla if present
  if(clubData['torshallagolfklubb']){ selectedClub='torshallagolfklubb'; sel.value=selectedClub }
  updateHeaderStats(); renderHoleScores();
  // setup hole dropdown drilldown
  const holeBtn = document.getElementById('hole-select-btn');
  const tabs = document.querySelector('.tabs');
  const dd = document.createElement('div'); dd.id='hole-dropdown'; dd.className='card hide'; dd.style.position='absolute'; dd.style.right='14px'; dd.style.top='72px'; dd.style.width='200px'; dd.style.padding='8px';
  dd.innerHTML = H.map(h=>`<div style="margin:4px 0"><button class="holebtn" style="width:100%" onclick="go(${h.hole-1});document.getElementById('hole-dropdown').classList.add('hide');">Hål ${h.hole}</button></div>`).join('');
  tabs.appendChild(dd);
  holeBtn.onclick = e=>{ e.stopPropagation(); dd.classList.toggle('hide'); };
  document.addEventListener('click',()=>{ if(!dd.classList.contains('hide')) dd.classList.add('hide'); });
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
