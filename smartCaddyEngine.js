/**
 * SmartCaddyEngine — deterministisk, lokal klubb- och strategimotor för Golfcaddy.
 *
 * Ingen nätverkstrafik, inga externa API:er, inga AI-anrop. Ren, testbar JS.
 * Alla funktioner är rena (samma indata ger alltid samma utdata) utom att de
 * loggar inget och muterar inget globalt state — de tar in data och profil
 * som parametrar och returnerar nya objekt.
 *
 * Målet: svara på "hur bör jag spela det här hålet för att minska risken för
 * dubbelbogey eller sämre?" — inte bara "vilken klubba når avståndet?".
 *
 * Exponeras som window.SmartCaddyEngine (inget modulsystem/bundler finns i
 * projektet, se README/CLAUDE.md-avsaknad av package.json).
 */
(function(global){
  'use strict';

  // ==========================================================================
  // Konstanter — alla vikter, marginaler och trösklar samlade här enligt krav
  // ("Lägg alla multiplikatorer och marginaler i konfigurerbara konstanter").
  // ==========================================================================

  // Riskberäkning: hur mycket varje delfaktor bidrar till ett riskvärde 0-100.
  var RISK_WEIGHTS = {
    avgToPar: 40,        // snitt-till-par, viktigast — visar hur hålet brukar sluta
    doubleOrWorse: 35,   // andel dubbelbogey+ — direkt mått på "katastrofrisk"
    worstBlowup: 15,     // sämsta registrerade resultat — hur illa kan det gå
    trend: 10            // senaste resultaten jämfört med snittet
  };
  // Spann (i slag) som skalorna för avgToPar / worstBlowup / trend clampas mot
  var RISK_AVG_TO_PAR_SPAN = 4;      // 0 slag över par → 0 poäng, 4+ över par → maxpoäng
  var RISK_WORST_BLOWUP_SPAN = 6;    // sämsta resultat 0-6 slag över par
  var RISK_TREND_SPAN = 2;           // senaste snitt 0-2 slag sämre än totalsnittet
  var RISK_NO_HISTORY_SCORE = 35;    // försiktig baseline (medelrisk) utan personlig hålhistorik

  var RISK_BUCKETS = [
    { max: 24, level: 'low' },
    { max: 49, level: 'medium' },
    { max: 74, level: 'high' },
    { max: 100, level: 'very_high' }
  ];

  // Confidence: hur starkt dataunderlaget är (INTE sannolikheten att slaget lyckas).
  var CONFIDENCE_SAMPLE_BUCKETS = [
    { max: 2, level: 'low' },
    { max: 7, level: 'medium' },
    { max: Infinity, level: 'high' }
  ];

  // Scoremål: trösklar för när ett hål räknas som "starkt" nog för attack-läge
  // respektive "okej" nog för ett par-mål utan att vara i protect_score.
  var SCORE_GOAL_THRESHOLDS = {
    attackAvgToPar: 0.3,          // snitt inom 0,3 slag över par
    attackDoubleOrWorsePct: 10,   // och färre än 10% dubbelbogey+
    okAvgToPar: 1.3,              // snitt nära bogey (par+1,3 eller bättre)
    okDoubleOrWorsePct: 25        // och färre än 25% dubbelbogey+
  };

  // Klubbval: säker carry, lie-justering och vindmarginal.
  var CLUB_CONFIG = {
    // Ingen egen safeCarry-data finns i projektet ännu — uppskattas konservativt
    // från normalCarry och markeras explicit som uppskattning (safeCarryIsEstimated).
    safeCarryRatio: 0.92,
    // Hur mycket av klubbans säkra carry som realistiskt går att lita på från olika lägen.
    lieCarryFactor: { tee: 1, fairway: 1, rough: 0.9, bunker: 0.85, recovery: 0.8, unknown: 0.9 },
    // Extra meter som läggs till (motvind) eller dras bort (medvind, bara halva
    // marginalen — vi ska ändå inte uppmuntra en lång miss bakom en farlig green).
    windMarginMeters: { none: 0, light: 5, moderate: 12, strong: 20 },
    tailwindCreditFactor: 0.5
  };

  // ==========================================================================
  // Hjälpfunktioner
  // ==========================================================================

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function round1(v){ return Math.round(v*10)/10; }

  function riskBucketFor(score){
    for(var i=0;i<RISK_BUCKETS.length;i++){ if(score<=RISK_BUCKETS[i].max) return RISK_BUCKETS[i]; }
    return RISK_BUCKETS[RISK_BUCKETS.length-1];
  }

  // ==========================================================================
  // 1. Normalisering av hålstatistik — läser rå score-lista (t.ex. från
  //    hole_scores.json) och bygger den interna HoleHistory-modellen.
  //    Saknade värden blir null, aldrig påhittade nollor.
  // ==========================================================================
  function normalizeHoleHistory(courseId, holeNumber, par, rawScores){
    var scores = (Array.isArray(rawScores) ? rawScores : []).filter(function(n){
      return typeof n === 'number' && isFinite(n) && n > 0;
    });
    var sampleSize = scores.length;
    if(sampleSize === 0){
      return {
        courseId: courseId, holeNumber: holeNumber, par: par, sampleSize: 0,
        averageScore: null, averageToPar: null, bestScore: null, worstScore: null,
        parOrBetterCount: 0, bogeyCount: 0, doubleBogeyCount: 0, worseThanDoubleBogeyCount: 0,
        parOrBetterPercentage: null, bogeyPercentage: null, doubleOrWorsePercentage: null,
        recentScores: []
      };
    }
    var sum = scores.reduce(function(a,b){ return a+b; }, 0);
    var averageScore = round1(sum/sampleSize);
    var bestScore = Math.min.apply(null, scores);
    var worstScore = Math.max.apply(null, scores);
    var parOrBetterCount=0, bogeyCount=0, doubleBogeyCount=0, worseThanDoubleBogeyCount=0;
    scores.forEach(function(s){
      var toPar = s - par;
      if(toPar<=0) parOrBetterCount++;
      else if(toPar===1) bogeyCount++;
      else if(toPar===2) doubleBogeyCount++;
      else worseThanDoubleBogeyCount++;
    });
    function pct(n){ return round1(n/sampleSize*100); }
    return {
      courseId: courseId, holeNumber: holeNumber, par: par, sampleSize: sampleSize,
      averageScore: averageScore, averageToPar: round1(averageScore-par),
      bestScore: bestScore, worstScore: worstScore,
      parOrBetterCount: parOrBetterCount, bogeyCount: bogeyCount,
      doubleBogeyCount: doubleBogeyCount, worseThanDoubleBogeyCount: worseThanDoubleBogeyCount,
      parOrBetterPercentage: pct(parOrBetterCount),
      bogeyPercentage: pct(bogeyCount),
      doubleOrWorsePercentage: pct(doubleBogeyCount+worseThanDoubleBogeyCount),
      recentScores: scores.slice(-5)
    };
  }

  // ==========================================================================
  // 2. Risk — personligt riskindex 0-100 för hålet, byggt på hålhistoriken.
  // ==========================================================================
  function computeRisk(hist){
    if(!hist || hist.sampleSize === 0){
      var b0 = riskBucketFor(RISK_NO_HISTORY_SCORE);
      return {
        level: b0.level, score: RISK_NO_HISTORY_SCORE,
        mainRisk: 'Ingen personlig hålhistorik registrerad ännu — bedömningen bygger på allmänna säkerhetsregler.'
      };
    }
    var parts = {
      avgToPar: hist.averageToPar!=null ? clamp(hist.averageToPar,0,RISK_AVG_TO_PAR_SPAN)/RISK_AVG_TO_PAR_SPAN*RISK_WEIGHTS.avgToPar : 0,
      doubleOrWorse: hist.doubleOrWorsePercentage!=null ? (hist.doubleOrWorsePercentage/100)*RISK_WEIGHTS.doubleOrWorse : 0,
      worstBlowup: hist.worstScore!=null ? clamp(hist.worstScore-hist.par,0,RISK_WORST_BLOWUP_SPAN)/RISK_WORST_BLOWUP_SPAN*RISK_WEIGHTS.worstBlowup : 0,
      trend: 0
    };
    if(hist.recentScores && hist.recentScores.length>=3 && hist.averageScore!=null){
      var lastN = hist.recentScores.slice(-3);
      var lastAvg = lastN.reduce(function(a,b){return a+b;},0)/lastN.length;
      var delta = lastAvg - hist.averageScore;
      parts.trend = clamp(delta,0,RISK_TREND_SPAN)/RISK_TREND_SPAN*RISK_WEIGHTS.trend;
    }
    var total = Math.round(parts.avgToPar+parts.doubleOrWorse+parts.worstBlowup+parts.trend);
    var score = clamp(total,0,100);
    var bucket = riskBucketFor(score);
    var dominantKey = Object.keys(parts).reduce(function(best,k){ return parts[k]>parts[best]?k:best; }, 'avgToPar');
    var mainRiskTextByKey = {
      avgToPar: 'Du har historiskt spelat det här hålet klart över par.',
      doubleOrWorse: 'Dubbelbogey eller sämre förekommer ofta för dig på det här hålet.',
      worstBlowup: 'Hålet har gett dig ett riktigt tungt resultat tidigare.',
      trend: 'Dina senaste registrerade resultat på hålet är sämre än ditt snitt.'
    };
    var mainRisk = parts[dominantKey] > 0 ? mainRiskTextByKey[dominantKey] : 'Begränsat underlag — ingen tydlig huvudrisk kan pekas ut ännu.';
    return { level: bucket.level, score: score, mainRisk: mainRisk };
  }

  // ==========================================================================
  // 3. Confidence — hur starkt dataunderlaget är, INTE sannolikheten att slaget
  //    lyckas. Baseras enbart på antal registrerade resultat för hålet.
  // ==========================================================================
  function computeConfidence(sampleSize){
    sampleSize = sampleSize || 0;
    var bucket = CONFIDENCE_SAMPLE_BUCKETS.filter(function(b){ return sampleSize<=b.max; })[0];
    var score = clamp(Math.round(sampleSize*12), 0, 100);
    var explanation = sampleSize===0
      ? 'Ingen personlig hålhistorik registrerad ännu — rådet bygger på klubblängder och allmänna säkerhetsregler.'
      : ('Baserat på ' + sampleSize + ' registrerade resultat på hålet.');
    return { level: bucket.level, score: score, sampleSize: sampleSize, explanation: explanation };
  }

  // ==========================================================================
  // 4. Scoremål — realistiskt coachmål för hålet, inte en prognos.
  //    Bestämmer även strategiläge (protect_score / normal / attack).
  // ==========================================================================
  function computeScoreGoal(par, hist, risk, confidence){
    var bogey = par+1;
    if(!hist || hist.sampleSize===0){
      return {
        label: 'Bogey', targetScore: bogey, mode: 'protect_score',
        rationale: 'Inget personligt underlag för hålet ännu — bogey är ett tryggt basmål tills du spelat hålet några gånger.'
      };
    }
    if(risk.level==='high' || risk.level==='very_high'){
      var rationale = hist.doubleOrWorsePercentage!=null
        ? (hist.doubleOrWorsePercentage + '% av dina registrerade resultat på hålet är dubbelbogey eller sämre — bogey är ett bra resultat här.')
        : 'Historiken visar ett tungt hål för dig — bogey är ett bra resultat här.';
      return { label: 'Bogey', targetScore: bogey, mode: 'protect_score', rationale: rationale };
    }
    var strongEnoughForAttack = hist.averageToPar!=null
      && hist.averageToPar <= SCORE_GOAL_THRESHOLDS.attackAvgToPar
      && (hist.doubleOrWorsePercentage==null || hist.doubleOrWorsePercentage < SCORE_GOAL_THRESHOLDS.attackDoubleOrWorsePct)
      && confidence.level !== 'low';
    if(strongEnoughForAttack){
      return {
        label: 'Par eller bättre', targetScore: par, mode: 'attack',
        rationale: 'Du har starka registrerade resultat på det här hålet — läge för ett lite mer offensivt försök inom rimlig risk.'
      };
    }
    var okForPar = hist.averageToPar!=null
      && hist.averageToPar <= SCORE_GOAL_THRESHOLDS.okAvgToPar
      && (hist.doubleOrWorsePercentage==null || hist.doubleOrWorsePercentage < SCORE_GOAL_THRESHOLDS.okDoubleOrWorsePct);
    if(okForPar){
      return {
        label: 'Par eller bättre', targetScore: par, mode: 'normal',
        rationale: 'Hålet har historiskt gått relativt bra för dig och stora missar är ovanliga — sikta på par eller bättre.'
      };
    }
    return {
      label: 'Bogey eller bättre', targetScore: bogey, mode: 'normal',
      rationale: 'Ditt snitt ligger nära bogey på det här hålet — sikta på bogey eller bättre utan att ta onödiga risker.'
    };
  }

  // ==========================================================================
  // 5. Klubbmodell — bygger ClubDistance[] från projektets befintliga C-array
  //    (rangevärden: [namn, snittlängd, maxlängd]).
  // ==========================================================================
  function inferClubCategory(name){
    if(/driver/i.test(name)) return 'driver';
    if(/wedge/i.test(name)) return 'wedge';
    if(/järn/i.test(name)) return 'iron';
    return 'iron';
  }
  function slugify(name){
    return name.toLowerCase()
      .replace(/[°]/g,'')
      .replace(/[^a-z0-9åäö]+/g,'-')
      .replace(/(^-+|-+$)/g,'');
  }
  function buildClubDistances(clubRows){
    return (clubRows||[]).map(function(row){
      var name = row[0], normalCarry = row[1], maxCarry = row[2];
      return {
        id: slugify(name),
        name: name,
        category: inferClubCategory(name),
        normalCarry: normalCarry,
        safeCarry: Math.round(normalCarry*CLUB_CONFIG.safeCarryRatio),
        safeCarryIsEstimated: true, // ingen egen mätt safeCarry finns — uppskattad, se CLUB_CONFIG.safeCarryRatio
        maxCarry: maxCarry,
        source: 'range',
        reliability: 'medium'
      };
    });
  }

  function computeRequiredDistance(distanceToTarget, wind){
    var w = wind || { strength:'none', direction:'unknown' };
    var margin = CLUB_CONFIG.windMarginMeters[w.strength] || 0;
    var adj = 0;
    if(w.direction==='headwind') adj = margin;
    else if(w.direction==='tailwind') adj = -margin*CLUB_CONFIG.tailwindCreditFactor;
    return Math.max(1, Math.round(distanceToTarget+adj));
  }

  // ==========================================================================
  // 6. Klubbval + mål — kärnan i "smart" caddyn.
  //
  //    Två helt olika situationer hanteras separat:
  //    a) targetType === 'fairway' (tee-slag på par 4/5): det finns inget fast
  //       avstånd att "nå säkert" — fairwayn är ett brett mål. Här väljs klubba
  //       utifrån STRATEGI: Driver för max längd (normal/attack), eller längsta
  //       järnet för precision på ett personligt riskhål (protect_score).
  //    b) targetType === 'green'/'layup'/'recovery': det finns ett definierat
  //       avstånd att nå. Här väljs den KORTASTE klubban vars säkra carry
  //       (efter lie- och vindjustering) räcker fram. Räcker ingen klubba
  //       säkert blir det ett kontrollerat lägg-upp-slag i stället för att
  //       automatiskt ta den längsta klubban.
  // ==========================================================================
  function chooseClubAndTarget(input, clubDistances, preferAccuracyOffTee){
    var lie = input.lie || 'unknown';
    var targetType = input.targetType;
    // På en par 3-tee finns bara ett slag till green — "lägg upp" är inget verkligt alternativ
    // (till skillnad från en approach efter ett tidigare slag, där ett kontrollerat lägg-upp-slag
    // är en riktig strategi). Den situationen hanteras separat nedan.
    var isPar3TeeShot = (lie==='tee' && targetType==='green');

    if(targetType === 'fairway'){
      var driverAllowedTee = lie==='tee' && !preferAccuracyOffTee;
      var teeBag = clubDistances.filter(function(c){ return driverAllowedTee || c.category!=='driver'; })
        .filter(function(c){ return c.category!=='putter'; });
      var teePick = teeBag.reduce(function(a,b){ return b.normalCarry>a.normalCarry ? b : a; });
      return { club: teePick, targetType: 'fairway', requiredDistance: null, isLayup: false, precisionOverTee: preferAccuracyOffTee===true };
    }

    // green / layup / recovery: definierat avstånd att nå
    var lieFactor = CLUB_CONFIG.lieCarryFactor[lie] || CLUB_CONFIG.lieCarryFactor.unknown;
    var requiredDistance = computeRequiredDistance(input.distanceToTarget, input.wind);
    // Driver ska aldrig rekommenderas mot en green, layup eller recovery — bara för positionsslag mot fairway (ovan).
    var bag = clubDistances.filter(function(c){ return c.category!=='driver' && c.category!=='putter'; });
    var withEff = bag.map(function(c){
      return Object.assign({}, c, { effSafeCarry: Math.round(c.safeCarry*lieFactor) });
    });
    var reaching = withEff.filter(function(c){ return c.effSafeCarry>=requiredDistance; })
      .sort(function(a,b){ return a.normalCarry-b.normalCarry; });
    if(reaching.length){
      return { club: reaching[0], targetType: targetType, requiredDistance: requiredDistance, isLayup: false };
    }
    if(isPar3TeeShot){
      // Inget lägg-upp-alternativ finns på en par 3 — spela med den klubba vars snittlängd ligger
      // närmast avståndet (kan vara kortare ELLER längre än avståndet) och var transparent om att
      // slaget ligger utanför den uppskattat säkra räckvidden.
      var byCloseness = withEff.slice().sort(function(a,b){
        return Math.abs(a.normalCarry-requiredDistance) - Math.abs(b.normalCarry-requiredDistance);
      });
      return { club: byCloseness[0], targetType: 'green', requiredDistance: requiredDistance, isLayup: false, mayComeUpShort: true };
    }
    // Ingen klubb når säkert och ett lägg-upp-slag är ett meningsfullt alternativ (approach-slag,
    // inte en par 3-tee) -> kontrollerat lägg-upp i stället för att chansa på maxlängd.
    var candidates = withEff.filter(function(c){ return c.normalCarry<=requiredDistance; })
      .sort(function(a,b){ return b.normalCarry-a.normalCarry; });
    var layupPick = candidates[0];
    if(!layupPick){
      // Även kortaste klubban räcker längre än avståndet (finess-läge på kort håll) — ta kortaste ändå.
      layupPick = withEff.slice().sort(function(a,b){ return a.normalCarry-b.normalCarry; })[0];
    }
    return { club: layupPick, targetType: 'layup', requiredDistance: requiredDistance, isLayup: true };
  }

  // ==========================================================================
  // 7. Huvudfunktion — bygger det fullständiga CaddyAdvice-objektet.
  // ==========================================================================
  var MODE_HEADLINES = {
    protect_score: 'Spela säkert — skydda scoren',
    normal: 'Spela smart mot ett säkert mål',
    attack: 'Läge att spela lite mer offensivt'
  };

  function getCaddyAdvice(input){
    var hist = input.holeHistory || null;
    var risk = computeRisk(hist);
    var confidence = computeConfidence(hist ? hist.sampleSize : 0);
    var scoreGoal = computeScoreGoal(input.par, hist, risk, confidence);
    var preferAccuracyOffTee = scoreGoal.mode==='protect_score' && input.lie==='tee' && input.targetType==='fairway';

    var pick = chooseClubAndTarget(input, input.clubDistances||[], preferAccuracyOffTee);
    var profile = input.playerProfile || null;
    var fairwayStats = profile && profile.globalStats && profile.globalStats.fairway;
    var puttingStats = profile && profile.globalStats && profile.globalStats.putting;

    // Fairwayråd (missriktning) visas aldrig på par 3 (inget fairwaykoncept där) och
    // bara när slaget faktiskt siktar mot ett mål (green/fairway), inte layup/recovery.
    var includeFairwayMissNote = input.par!==3 && fairwayStats!=null
      && (pick.targetType==='green' || pick.targetType==='fairway');
    var includePuttingNote = pick.targetType==='green' && puttingStats!=null;

    var targetDescription, aimAdjustment = null;
    if(pick.targetType==='green'){
      targetDescription = 'Spela mot greenens stora del.';
      if(includeFairwayMissNote){
        aimAdjustment = 'Din vanligaste registrerade miss är höger (' + fairwayStats.missRightPercentage + '% av registrerade fairwayslag). Välj ett målområde där en högermiss inte skapar stora problem.';
      }
    } else if(pick.targetType==='fairway'){
      targetDescription = 'Spela mot ett brett landningsområde i fairway.';
      if(includeFairwayMissNote){
        aimAdjustment = 'Din vanligaste registrerade miss är höger (' + fairwayStats.missRightPercentage + '% av registrerade fairwayslag). Välj en sida av fairwayn där en högermiss inte skapar stora problem.';
      }
    } else if(pick.targetType==='layup'){
      targetDescription = 'Spela fram till ett avstånd som passar en kontrollerad wedge eller kort järn enligt dina registrerade klubblängder.';
    } else {
      targetDescription = 'Spela ut säkert mot ett öppet område.';
    }

    var reasons = [];
    if(pick.targetType==='fairway'){
      reasons.push(pick.precisionOverTee
        ? (pick.club.name + ' ger mer kontroll än Driver — vi prioriterar precision framför max längd här eftersom hålet historiskt är ett riskhål för dig.')
        : (pick.club.name + ' ger dig bästa rimliga längd med normal carry för ett tee-slag mot fairway (hålet är ' + input.distanceToTarget + ' m).'));
    } else if(pick.mayComeUpShort){
      reasons.push('Ingen klubba i din bag når ' + pick.requiredDistance + ' m med säker marginal härifrån, och ett lägg-upp-slag är inget alternativ på en par 3 — ' + pick.club.name + ' (snittlängd ' + pick.club.normalCarry + ' m) ligger närmast avståndet av dina klubbor.');
    } else if(pick.isLayup){
      reasons.push('Ingen klubba i din bag når ' + pick.requiredDistance + ' m med säker carry härifrån — ' + pick.club.name + ' (säker carry ca ' + pick.club.safeCarry + ' m) ger ett kontrollerat lägg-upp-slag i stället.');
    } else {
      reasons.push(pick.club.name + ' har en uppskattad säker längd på ca ' + pick.club.effSafeCarry + ' m, vilket räcker för de ' + pick.requiredDistance + ' m som krävs (avstånd + lägesjustering + ev. vindmarginal).');
    }
    if(hist && hist.sampleSize>0){
      reasons.push(risk.mainRisk);
    } else {
      reasons.push('Ingen personlig hålhistorik registrerad för det här hålet ännu — rådet bygger på klubblängder och allmänna säkerhetsregler.');
    }
    if(aimAdjustment) reasons.push(aimAdjustment);
    if(includePuttingNote){
      reasons.push('Din övergripande statistik visar ' + puttingStats.threePuttPercentage + '% treputtar — prioritera greenens stora del och en hanterbar första putt framför flaggan.');
    }

    var warnings = [];
    if(confidence.level==='low'){
      warnings.push('Lågt dataunderlag för det här hålet — delar av rådet bygger på allmänna säkerhetsregler snarare än din egen historik.');
    }
    if(pick.isLayup){
      warnings.push('Vi föreslår ett kontrollerat lägg-upp-slag i stället för att chansa på en klubbas maxlängd.');
    }
    if(pick.mayComeUpShort){
      warnings.push('Avståndet ligger utanför din uppskattat säkra räckvidd härifrån — räkna med att ibland komma något kort mot green.');
    }
    if(input.wind && input.wind.strength==='strong'){
      warnings.push('Kraftig vind registrerad — marginalen i beräkningen är extra försiktig.');
    }

    var dataSources = ['club_distances','course_data','safety_rules'];
    if(hist && hist.sampleSize>0) dataSources.push('hole_history');
    if(includeFairwayMissNote) dataSources.push('global_fairway_pattern');
    if(includePuttingNote) dataSources.push('global_putting_pattern');

    var headline = MODE_HEADLINES[scoreGoal.mode] || MODE_HEADLINES.normal;
    var targetLabel = pick.targetType==='fairway' ? 'fairway' : (pick.targetType==='layup' ? 'ett lägg-upp-läge' : (pick.targetType==='recovery' ? 'ett säkert område' : 'green'));
    var primaryAdvice = pick.club.name + ' mot ' + targetLabel + '. Mål: ' + scoreGoal.label.toLowerCase() + '.';

    return {
      mode: scoreGoal.mode,
      headline: headline,
      primaryAdvice: primaryAdvice,
      recommendedClubId: pick.club ? pick.club.id : null,
      recommendedClubName: pick.club ? pick.club.name : null,
      target: { type: pick.targetType, description: targetDescription, aimAdjustment: aimAdjustment },
      scoreGoal: { label: scoreGoal.label, targetScore: scoreGoal.targetScore, rationale: scoreGoal.rationale },
      risk: { level: risk.level, score: risk.score, mainRisk: risk.mainRisk },
      confidence: confidence,
      reasons: reasons,
      warnings: warnings,
      dataSources: dataSources
    };
  }

  global.SmartCaddyEngine = {
    // Konstanter (exponerade för test/inspektion, inte tänkta att muteras vid körning)
    RISK_WEIGHTS: RISK_WEIGHTS,
    CONFIDENCE_SAMPLE_BUCKETS: CONFIDENCE_SAMPLE_BUCKETS,
    SCORE_GOAL_THRESHOLDS: SCORE_GOAL_THRESHOLDS,
    CLUB_CONFIG: CLUB_CONFIG,
    // Funktioner
    normalizeHoleHistory: normalizeHoleHistory,
    computeRisk: computeRisk,
    computeConfidence: computeConfidence,
    computeScoreGoal: computeScoreGoal,
    buildClubDistances: buildClubDistances,
    chooseClubAndTarget: chooseClubAndTarget,
    getCaddyAdvice: getCaddyAdvice
  };

})(typeof window !== 'undefined' ? window : this);
