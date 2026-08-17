// use APP_VERSION injected into window by index.html; fall back to 1.7.0
const APP_VERSION = (typeof window !== 'undefined' && window.APP_VERSION) ? window.APP_VERSION : '1.7.0';
const TAG = APP_VERSION ? `?v=${APP_VERSION}` : '';
// expose TAG as a global for inline onerror handlers that run in global scope
window.TAG = TAG;

// Hål-data (par, hcp-index, avstånd gul tee i meter) verifierad mot https://torshallagk.se/spela/banan/ 2026-08-13
const H=[[4,10,347],[4,6,356],[4,2,378],[3,18,113],[5,4,491],[5,12,480],[4,8,331],[3,16,140],[4,14,304],[4,9,335],[5,13,497],[3,11,166],[4,5,326],[4,3,347],[3,17,114],[4,1,331],[4,7,363],[5,15,435]].map((x,i)=>({hole:i+1,par:x[0],index:x[1],distance:x[2]}));
// Default-klubbdata (rangevärden från matta/rangebollar): [namn, snittlängd, maxlängd] i meter
// Detta är seed. Användarens egna klubbor lagras i localStorage.gcClubs och överskrider seed.
const C_DEFAULT=[['Driver 909 D-Comp',145,181],['Järn 5 King F9',115,144],['Järn 8 King F9',113,124],['Järn 7 King F9',109,126],['Järn 9 King F9',101,108],['Pitching Wedge',90,93],['Wedge 60°',72,84]];

// ==========================================================================
// Local overrides: användarens egen data i localStorage vinner över bundlad seed.
// Nycklar: gcClubs (klubblista), gcProfile (namn+HCP), gcRounds (registrerade ronder).
// ==========================================================================
function safeParse(key, fallback){
  try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch(e){ console.warn('Kunde inte tolka '+key+', tar bort:', e); localStorage.removeItem(key); return fallback; }
}
function loadUserClubs(){ return safeParse('gcClubs', null); }        // null = använd C_DEFAULT
function loadUserProfile(){ return safeParse('gcProfile', null); }    // null = använd bara startdata från JSON
function loadUserRounds(){ return safeParse('gcRounds', []); }
function saveUserClubs(rows){ localStorage.setItem('gcClubs', JSON.stringify(rows)); }
function saveUserProfile(p){ localStorage.setItem('gcProfile', JSON.stringify(p)); }
function saveUserRounds(rs){ localStorage.setItem('gcRounds', JSON.stringify(rs)); }

// Effektiv klubblista (användarens egen om den finns, annars default seed).
function getEffectiveClubs(){ const u = loadUserClubs(); return (u && Array.isArray(u) && u.length) ? u : C_DEFAULT; }
// clubDistances räknas om varje gång vi renderar (billigt, 7 rader) — se render().
// Effektiv hål-scorehistorik: startdata från hole_scores.json + användarens registrerade ronder på slutet.
function getEffectiveHoleScores(){
  const base = {};
  Object.keys(holeScoresSeed||{}).forEach(k=>{ base[k] = (holeScoresSeed[k]||[]).slice(); });
  const rounds = loadUserRounds();
  rounds.forEach(r=>{
    (r.holes||[]).forEach((score, idx)=>{
      if(typeof score==='number' && isFinite(score) && score>0){
        const key = String(idx+1);
        (base[key] = base[key] || []).push(score);
      }
    });
  });
  return base;
}
// Effektiv spelarprofil: startdata från player_profile.json, men namn/HCP kan skrivas över lokalt.
function getEffectivePlayerProfile(){
  const seed = playerProfileSeed;
  const user = loadUserProfile();
  if(!seed) return user ? {handicap:{current:user.hcp}, playerName:user.name} : null;
  if(!user) return seed;
  const merged = Object.assign({}, seed);
  merged.handicap = Object.assign({}, seed.handicap||{}, user.hcp!=null?{current:user.hcp}:{});
  if(user.name) merged.playerName = user.name;
  return merged;
}

let i=+(localStorage.gcHole||0), wind=0; let scores = {};
let distOverride = null; // null = använd Tee-avstånd (default), annars valfritt avstånd i meter
let lieOverride = null;  // null = använd default-läge ('fairway') när avståndet inte är Tee-avståndet
// Hål-indexerad scorehistorik (startdata, seed) från assets/data/hole_scores.json — { "1": [scorer...], ... }
// Användarens registrerade ronder läggs på via getEffectiveHoleScores() — skriv aldrig till seed direkt.
let holeScoresSeed = {};
// Personlig Caddy-profil (globalStats m.m.) — startdata, se assets/data/player_profile.json. null tills den laddats.
// Användarens ändringar av namn/HCP hämtas via getEffectivePlayerProfile().
let playerProfileSeed = null;
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
  const scoresForHole = getEffectiveHoleScores();
  const hist = SmartCaddyEngine.normalizeHoleHistory('torshallagolfklubb', h.hole, h.par, scoresForHole[String(h.hole)]);
  const targetType = lie==='tee' ? (h.par===3 ? 'green' : 'fairway') : 'green';
  return {
    courseId: 'torshallagolfklubb', holeNumber: h.hole, par: h.par,
    shotNumber: lie==='tee' ? 1 : 2,
    distanceToTarget: dist, distanceUnit: 'meters',
    lie: lie, targetType: targetType,
    wind: { strength: windStrength, direction: windDirection },
    holeHistory: hist, clubDistances: SmartCaddyEngine.buildClubDistances(getEffectiveClubs()), playerProfile: getEffectivePlayerProfile()
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
// Inställn.: profil, klubbor, ronder, data-hantering — laddas när seed är klar (se renderSettingsTab)
document.querySelector('#settings').innerHTML=`<div class="card"><small style="color:#047857;font-weight:800">INSTÄLLNINGAR</small><h3 style="margin:5px 0">Laddar…</h3></div>`;

// Bygger om "Mitt Spel" från den inlästa spelarprofilen (assets/data/player_profile.json).
// Importerade profilvärden visas som de är (inte som en komplett slagdatabas); den enda nya
// procentsatsen som räknas ut här (blowupPct) använder ett internt konsekvent underlag
// (summan av resultatfördelningens egna kategorier) och blandas inte ihop med fairway-/putt-procenten,
// som har en annan (odeklarerad) nämnare.
function renderGameTab(){
  const profile = getEffectivePlayerProfile();
  const gs = profile && profile.globalStats;
  if(!gs){ document.querySelector('#game').innerHTML = '<div class="card advice"><small>MITT SPEL</small><h3>Ingen profildata tillgänglig</h3></div>'; return; }
  const hcp = profile.handicap || {};
  const displayName = profile.playerName || 'Fredrik';
  const dist = gs.scoreDistribution;
  const totalHoles = dist.birdies+dist.pars+dist.bogeys+dist.doubleBogeys+dist.worseThanDoubleBogey+dist.noResult;
  const blowupPct = totalHoles>0 ? Math.round((dist.doubleBogeys+dist.worseThanDoubleBogey)/totalHoles*100) : null;
  document.querySelector('#game').innerHTML = `<div class="card advice"><small>MITT SPEL</small><h3>${displayName}${hcp.current!=null?', HCP '+hcp.current:''}</h3>${hcp.improvementSinceFirstRound!=null?`<div class="score" style="color:#bef264">−${hcp.improvementSinceFirstRound}</div><div>HCP sedan första registrerade rond</div>`:''}</div><div class="grid"><div class="metric">Ronder<b>${gs.roundsPlayed}</b></div><div class="metric">Snittscore<b>${gs.averageScore}</b></div><div class="metric">Bästa score<b>${gs.bestScore}</b></div><div class="metric">Fairwayträff<b>${gs.fairway.hitPercentage} %</b></div><div class="metric">Puttar/rond<b>${gs.putting.averagePuttsPerRound}</b></div></div><div class="card"><small style="color:#047857;font-weight:800">MISS- OCH PUTTMÖNSTER</small><div class="legend" style="margin-top:6px">Andel av registrerade fairwayslag respektive ronder, ${gs.roundsPlayed} ronder totalt.</div><div class="historygrid" style="grid-template-columns:repeat(3,1fr);margin-top:10px"><div>Miss vä<b>${gs.fairway.missLeftPercentage}%</b></div><div>Fairway<b>${gs.fairway.hitPercentage}%</b></div><div>Miss hö<b>${gs.fairway.missRightPercentage}%</b></div></div><div class="historygrid" style="grid-template-columns:repeat(3,1fr);margin-top:6px"><div>2-putt<b>${gs.putting.twoPuttPercentage}%</b></div><div>3-putt<b>${gs.putting.threePuttPercentage}%</b></div><div>4+ putt<b>${gs.putting.moreThanThreePuttPercentage}%</b></div></div></div><div class="card"><small style="color:#047857;font-weight:800">ÖVERGRIPANDE ANALYS</small><div class="legend" style="margin-top:6px">Resultatfördelning över ${totalHoles} registrerade hålresultat (${dist.noResult} utan resultat), ${gs.roundsPlayed} ronder.</div><div class="historygrid"><div>Birdie<b>${dist.birdies}</b></div><div>Par<b>${dist.pars}</b></div><div>Bogey<b>${dist.bogeys}</b></div><div>Dubbel<b>${dist.doubleBogeys}</b></div><div>Sämre<b>${dist.worseThanDoubleBogey}</b></div></div></div><div class="card"><b>Caddyns fokus</b><p>• Din vanligaste registrerade miss är höger (${gs.fairway.missRightPercentage}%) — välj målområden där en högermiss inte straffar dig hårt.</p><p>• ${gs.putting.threePuttPercentage}% treputtar totalt — prioritera greenens stora del och en hanterbar första putt.</p>${blowupPct!=null?`<p>• ${blowupPct}% av dina registrerade hålresultat är dubbelbogey eller sämre — det är caddyns huvudfokus att sänka den andelen.</p>`:''}</div>`;
}

// ==========================================================================
// Inställningsvyn ("Inställn."-fliken): profil, klubbor, ronder, data-hantering.
// State-flaggan roundEntryOpen styr om rond-inmatningsformuläret är utfällt.
// ==========================================================================
let roundEntryOpen = false;
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch])); }

function renderSettingsTab(){
  const profile = getEffectivePlayerProfile();
  const userProfile = loadUserProfile() || {};
  const name = userProfile.name || (profile && profile.playerName) || 'Fredrik';
  const hcp = userProfile.hcp!=null ? userProfile.hcp : (profile && profile.handicap && profile.handicap.current!=null ? profile.handicap.current : '');
  const clubs = getEffectiveClubs();
  const rounds = loadUserRounds();

  const profileCard = `<div class="card"><small style="color:#047857;font-weight:800">SPELARPROFIL</small>
    <div class="settings-field" style="margin-top:10px"><label>Namn</label><input id="settings-name" type="text" value="${escapeHtml(name)}" placeholder="Ditt namn"/></div>
    <div class="settings-field"><label>Aktuellt handikap</label><input id="settings-hcp" type="number" step="0.1" value="${escapeHtml(hcp)}" placeholder="t.ex. 33.3"/></div>
    <div class="btnrow"><button class="button primary" onclick="saveProfileFromForm()">Spara profil</button></div>
  </div>`;

  const clubRowsHtml = clubs.map((c,idx)=>`<div class="clubrow">
    <input type="text" data-clubidx="${idx}" data-field="name" value="${escapeHtml(c[0])}" placeholder="Klubbnamn"/>
    <input type="number" data-clubidx="${idx}" data-field="avg" value="${escapeHtml(c[1])}" placeholder="Snitt m"/>
    <input type="number" data-clubidx="${idx}" data-field="max" value="${escapeHtml(c[2])}" placeholder="Max m"/>
    <button class="iconbtn" onclick="removeClubRow(${idx})" title="Ta bort ${escapeHtml(c[0])}">×</button>
  </div>`).join('');
  const clubsCard = `<div class="card"><small style="color:#047857;font-weight:800">MIN KLUBBAG</small>
    <div class="legend" style="margin-top:4px">Snittlängd är carry (matta/rangebollar). Motorn använder snittlängd; max används inte i rekommendationer.</div>
    <div style="margin-top:12px">${clubRowsHtml}</div>
    <div class="btnrow"><button class="button" onclick="addClubRow()">+ Lägg till klubba</button><button class="button primary" onclick="saveClubsFromForm()">Spara bagen</button><button class="button" onclick="resetClubsToDefault()">Återställ till standard</button></div>
  </div>`;

  const roundListHtml = rounds.length===0
    ? '<div class="legend" style="margin-top:8px">Inga registrerade ronder ännu. Klicka "Ny rond" för att lägga till.</div>'
    : rounds.slice().reverse().map(r=>{
        const total = (r.holes||[]).reduce((a,b)=>a+(typeof b==='number'?b:0),0);
        const filled = (r.holes||[]).filter(x=>typeof x==='number'&&x>0).length;
        return `<div class="roundrow"><span>${escapeHtml(r.date)} · <b>${total}</b> (${filled}/18)</span><button class="iconbtn" onclick="removeRound('${escapeHtml(r.id)}')" title="Ta bort rond">×</button></div>`;
      }).join('');

  const today = new Date().toISOString().slice(0,10);
  const newRoundForm = roundEntryOpen ? `<div class="card" style="border:2px solid #047857">
    <b>Ny rond</b>
    <div class="settings-field" style="margin-top:10px"><label>Datum</label><input id="round-date" type="date" value="${today}"/></div>
    <div class="subhead">Score per hål (par ${H.map(h=>h.par).join('/')})</div>
    <div class="holegrid">${H.map(h=>`<label>H${h.hole}<input type="number" data-hole="${h.hole}" min="1" max="20" inputmode="numeric" placeholder="${h.par+1}"/></label>`).join('')}</div>
    <div class="btnrow"><button class="button primary" onclick="saveNewRound()">Spara rond</button><button class="button" onclick="closeRoundEntry()">Avbryt</button></div>
  </div>` : '';

  const roundsCard = `<div class="card"><small style="color:#047857;font-weight:800">MINA RONDER</small>
    <div style="margin-top:10px">${roundListHtml}</div>
    ${roundEntryOpen ? '' : '<div class="btnrow"><button class="button primary" onclick="openRoundEntry()">+ Ny rond</button></div>'}
    ${newRoundForm}
  </div>`;

  const dataCard = `<div class="card"><small style="color:#047857;font-weight:800">DINA DATA</small>
    <div class="legend" style="margin-top:4px">Profil, klubbor och ronder sparas lokalt i din webbläsare. Exportera regelbundet för att inte förlora dem.</div>
    <div class="btnrow"><button class="button" onclick="exportUserData()">Exportera JSON</button><button class="button" onclick="triggerImport()">Importera JSON</button><button class="button warnbtn" onclick="clearAllUserData()">Rensa all min data</button></div>
    <input id="import-file" type="file" accept="application/json" style="display:none" onchange="importUserData(event)"/>
  </div>`;

  document.querySelector('#settings').innerHTML = profileCard + clubsCard + roundsCard + dataCard;
}

// Profil
function saveProfileFromForm(){
  const name = document.getElementById('settings-name').value.trim();
  const hcpRaw = document.getElementById('settings-hcp').value.trim();
  const hcp = hcpRaw==='' ? null : parseFloat(hcpRaw.replace(',','.'));
  saveUserProfile({ name, hcp: (hcp!=null && !isNaN(hcp)) ? hcp : null });
  updateHeaderStats(); renderGameTab(); renderSettingsTab();
}

// Klubbor
function readClubsFromForm(){
  const rows = document.querySelectorAll('.clubrow');
  const out = [];
  rows.forEach(row=>{
    const name = row.querySelector('[data-field="name"]').value.trim();
    const avg = parseInt(row.querySelector('[data-field="avg"]').value, 10);
    const max = parseInt(row.querySelector('[data-field="max"]').value, 10);
    if(name && !isNaN(avg) && avg>0 && !isNaN(max) && max>0){ out.push([name, avg, max]); }
  });
  return out;
}
function saveClubsFromForm(){
  const rows = readClubsFromForm();
  if(rows.length===0){ alert('Bagen måste innehålla minst en klubba med giltiga längder.'); return; }
  saveUserClubs(rows);
  render(); renderSettingsTab();
}
function addClubRow(){
  const rows = readClubsFromForm();
  rows.push(['', 100, 120]);
  saveUserClubs(rows);
  renderSettingsTab();
}
function removeClubRow(idx){
  const rows = readClubsFromForm();
  rows.splice(idx, 1);
  if(rows.length===0){ alert('Bagen måste innehålla minst en klubba. Använd "Återställ till standard" om du vill börja om.'); return; }
  saveUserClubs(rows);
  render(); renderSettingsTab();
}
function resetClubsToDefault(){
  if(!confirm('Återställ klubbagen till standardvärdena?')) return;
  localStorage.removeItem('gcClubs');
  render(); renderSettingsTab();
}

// Ronder
function openRoundEntry(){ roundEntryOpen = true; renderSettingsTab(); }
function closeRoundEntry(){ roundEntryOpen = false; renderSettingsTab(); }
function saveNewRound(){
  const date = document.getElementById('round-date').value;
  if(!date){ alert('Ange datum för ronden.'); return; }
  const holes = H.map(h=>{
    const el = document.querySelector('input[data-hole="'+h.hole+'"]');
    const n = parseInt(el.value, 10);
    return (!isNaN(n) && n>0) ? n : null;
  });
  const filled = holes.filter(x=>x!=null).length;
  if(filled===0){ alert('Fyll i minst ett hål för att spara ronden.'); return; }
  const round = {
    id: 'r_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
    date, courseId: 'torshallagolfklubb', teeName: 'Gul', holes
  };
  const rounds = loadUserRounds();
  rounds.push(round);
  saveUserRounds(rounds);
  roundEntryOpen = false;
  updateHeaderStats(); renderHoleScores(); render(); renderSettingsTab();
}
function removeRound(id){
  if(!confirm('Ta bort den här ronden?')) return;
  const rounds = loadUserRounds().filter(r=>r.id!==id);
  saveUserRounds(rounds);
  updateHeaderStats(); renderHoleScores(); render(); renderSettingsTab();
}

// Import/export/rensa
function exportUserData(){
  const payload = {
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    profile: loadUserProfile(), clubs: loadUserClubs(), rounds: loadUserRounds()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'golfcaddy-data-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function triggerImport(){ document.getElementById('import-file').click(); }
function importUserData(evt){
  const file = evt.target.files && evt.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const data = JSON.parse(e.target.result);
      if(!confirm('Importera data? Detta ersätter din nuvarande profil, bag och alla ronder.')) return;
      if(data.profile) saveUserProfile(data.profile); else localStorage.removeItem('gcProfile');
      if(data.clubs) saveUserClubs(data.clubs); else localStorage.removeItem('gcClubs');
      if(data.rounds) saveUserRounds(data.rounds); else localStorage.removeItem('gcRounds');
      updateHeaderStats(); renderGameTab(); renderHoleScores(); render(); renderSettingsTab();
      alert('Data importerad.');
    }catch(err){ alert('Kunde inte tolka filen: '+err.message); }
  };
  reader.readAsText(file);
  evt.target.value = ''; // så samma fil kan väljas igen
}
function clearAllUserData(){
  if(!confirm('Rensa all din lokala data (profil, klubbor, ronder)? Startdatan från appen finns kvar.')) return;
  localStorage.removeItem('gcProfile'); localStorage.removeItem('gcClubs'); localStorage.removeItem('gcRounds');
  updateHeaderStats(); renderGameTab(); renderHoleScores(); render(); renderSettingsTab();
}

function computeClubStats(){
  const data = getEffectiveHoleScores();
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
    const profile = getEffectivePlayerProfile();
    if(profile && profile.handicap && profile.handicap.current!=null){
      const hcpEl = document.getElementById('stat-hcp');
      if(hcpEl) hcpEl.textContent = String(profile.handicap.current).replace('.',',');
    }
  }catch(e){console.warn('updateHeaderStats failed',e)}
}
function renderHoleScores(){
  const h = H[i];
  const holeNum = h.hole;
  const label = document.getElementById('profile-hole-label');
  if(label) label.textContent = `PERSONLIGA RESULTAT PÅ HÅL ${holeNum}`;
  const data = getEffectiveHoleScores()[String(holeNum)] || [];
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
  holeScoresSeed = scoresData || {};
  playerProfileSeed = profileData;
  renderGameTab();
  renderSettingsTab();
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

try{document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');['caddy','profile','game','settings'].forEach(x=>document.querySelector('#'+x).classList.toggle('hide',x!==b.dataset.tab))});render();}catch(e){console.error('Render failed:',e);const c=document.getElementById('caddy');if(c) c.innerHTML='<div class="card"><b>Fel i UI</b><p>Se konsolen för fel (F12) eller kontakta utvecklaren.</p></div>';}

// PWA / service worker handling
let deferredPrompt;
const statusBox=document.getElementById('pwa-status');
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;statusBox.style.display='block';statusBox.innerHTML='<b>Golfcaddy 1.2 kan installeras</b><br><button id="install-app" class="button primary" style="margin-top:8px">Installera appen</button>';document.getElementById('install-app').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;statusBox.style.display='none';};});
window.addEventListener('appinstalled',()=>{statusBox.style.display='block';statusBox.textContent='Golfcaddy är installerad.';});
window.addEventListener('offline',()=>{statusBox.style.display='block';statusBox.textContent='Offline-läge: appen använder sparat innehåll.';});
window.addEventListener('online',()=>{if(!deferredPrompt)statusBox.style.display='none';});
if('serviceWorker' in navigator){window.addEventListener('load',()=>{fetch('./sw.js',{method:'HEAD'}).then(r=>{if(r.ok){navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('ServiceWorker register failed',e));}else{console.info('No service worker script found (status',r.status,')');}}).catch(()=>{console.info('No service worker script available (fetch failed)')});});}
