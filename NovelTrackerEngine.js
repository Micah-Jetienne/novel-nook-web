(function (root) {
  'use strict';

  // Pure historical evidence, candidate prediction, reading state and portfolio.
  function deepFreeze(value) { if(value && typeof value==='object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
  const PIPELINE_SETTINGS = deepFreeze({"modeWeights":{"FLOW":[30.0,10.0,20.0,-5.0,-15.0,-10.0,-20.0,10.0,-10.0,10.0,-15.0,25.0,5.0],"SAVOUR":[25.0,20.0,20.0,0.0,-5.0,-5.0,-10.0,10.0,5.0,15.0,-15.0,5.0,25.0],"ESCAPE":[20.0,5.0,-10.0,25.0,-15.0,0.0,-5.0,0.0,30.0,20.0,5.0,0.0,0.0],"DANGER":[20.0,-5.0,-5.0,10.0,0.0,0.0,0.0,-5.0,30.0,35.0,25.0,0.0,5.0],"BURNOUT":[30.0,20.0,5.0,10.0,-25.0,30.0,-30.0,25.0,-20.0,10.0,-30.0,15.0,0.0],"RESET":[30.0,20.0,0.0,20.0,-20.0,20.0,-25.0,20.0,10.0,10.0,-25.0,10.0,5.0],"NEUTRAL":[70.0,15.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-5.0,0.0,5.0]},"modeRolePriorities":{"FLOW":[120.0,85.0,120.0,55.0,45.0,75.0],"SAVOUR":[115.0,100.0,110.0,70.0,55.0,70.0],"ESCAPE":[95.0,65.0,45.0,125.0,90.0,65.0],"DANGER":[100.0,60.0,55.0,110.0,130.0,55.0],"BURNOUT":[90.0,125.0,55.0,45.0,30.0,135.0],"RESET":[100.0,105.0,45.0,110.0,55.0,125.0],"NEUTRAL":[125.0,120.0,70.0,70.0,55.0,80.0]},"alternativeFloors":[0.9,0.88,0.85,0.88,0.88,0.88],"predictionWeights":[0.3,0.25,0.25,0.15,0.1,0.1,0.15],"signalCap":0.45,"confidenceFloor":0.1,"riskWeights":[0.45,0.35,0.2],"rewardWeights":[0.55,0.25,0.2],"lengthWeights":[0.7,0.3]});
  const MODES = Object.freeze(["FLOW", "SAVOUR", "ESCAPE", "DANGER", "BURNOUT", "RESET", "NEUTRAL"]);
  const ROLES = Object.freeze(["PRIMARY", "SAFE", "CONTINUATION", "EXPLORER", "WILDCARD", "LOW-RESISTANCE"]);
  const ATTRIBUTES = Object.freeze(['characters', 'atmosphere', 'writing', 'plot', 'pacing', 'worldbuilding', 'enjoyment']);
  const DEFAULT_CONFIGURATION = Object.freeze({
    version: 'engine2-desktop-2', referenceVersion: 'engine2-workbook-2026-11-13',
    pipeline: PIPELINE_SETTINGS,
    priorStrength: 10, minimumEvidence: 3, confidenceSaturation: 12,
    recentWindows: Object.freeze([5, 10, 25]), recentWeights: Object.freeze([.5, .3, .2]),
    genreWeights: Object.freeze([.6, .25, .15]),
    authorWeights: Object.freeze([.6, .25, .15]),
    seriesWeights: Object.freeze([.55, .25, .1, .1])
  });
  const text = value => value == null ? '' : String(value).trim();
  const key = value => text(value).toLowerCase();

  function optionalNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  const numbers = values => values.map(optionalNumber).filter(value => value !== null);
  function mean(values) {
    const usable = numbers(values);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  }
  function percentileInc(values, fraction) {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new RangeError('Percentile must be between zero and one.');
    const usable = numbers(values).sort((a, b) => a - b);
    if (!usable.length) return null;
    const position = (usable.length - 1) * fraction, lo = Math.floor(position), hi = Math.ceil(position);
    return usable[lo] + (usable[hi] - usable[lo]) * (position - lo);
  }
  function sampleStandardDeviation(values) {
    const usable = numbers(values);
    if (usable.length < 2) return null;
    const average = mean(usable);
    return Math.sqrt(usable.reduce((sum, value) => sum + (value - average) ** 2, 0) / (usable.length - 1));
  }
  function slope(values) {
    const usable = numbers(values);
    if (usable.length < 2) return 0;
    const mid = (usable.length - 1) / 2, average = mean(usable);
    return usable.reduce((sum, value, index) => sum + (index - mid) * (value - average), 0) /
      usable.reduce((sum, _, index) => sum + (index - mid) ** 2, 0);
  }
  function validateConfiguration(configuration) {
    for (const name of ['priorStrength', 'minimumEvidence', 'confidenceSaturation']) {
      if (!Number.isFinite(configuration[name]) || configuration[name] <= 0) throw new RangeError(`Invalid ${name}.`);
    }
    for (const [name, size] of [['recentWindows', 3], ['recentWeights', 3], ['genreWeights', 3], ['authorWeights', 3], ['seriesWeights', 4]]) {
      const values = configuration[name];
      if (!Array.isArray(values) || values.length !== size || values.some(v => !Number.isFinite(v) || v < 0) || !values.some(v => v > 0)) throw new RangeError(`Invalid ${name}.`);
    }
    if (configuration.recentWindows.some(v => !Number.isInteger(v) || v < 1)) throw new RangeError('Recent windows must contain positive integers.');
    const pipeline = configuration.pipeline || PIPELINE_SETTINGS;
    for (const [name,size] of [['predictionWeights',7],['riskWeights',3],['rewardWeights',3],['alternativeFloors',6],['lengthWeights',2]]) {
      if (!Array.isArray(pipeline[name]) || pipeline[name].length!==size || pipeline[name].some(value=>!Number.isFinite(value)||value<0)) throw new RangeError(`Invalid ${name}.`);
    }
    if (!(pipeline.signalCap>0) || !Number.isFinite(pipeline.signalCap) || !Number.isFinite(pipeline.confidenceFloor) || pipeline.confidenceFloor<0 || pipeline.confidenceFloor>1) throw new RangeError('Invalid prediction bounds.');
    for (const mode of MODES) {
      const weights=pipeline.modeWeights?.[mode], priorities=pipeline.modeRolePriorities?.[mode];
      if (!Array.isArray(weights)||weights.length!==13||weights.some(value=>!Number.isFinite(value))||weights.every(value=>value===0)) throw new RangeError(`Invalid ${mode} weights.`);
      if (!Array.isArray(priorities)||priorities.length!==6||priorities.some(value=>!Number.isFinite(value)||value<0)||priorities.every(value=>value===0)) throw new RangeError(`Invalid ${mode} role priorities.`);
    }
    return configuration;
  }
  function evidenceConfidence(count, configuration = DEFAULT_CONFIGURATION) {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('Evidence count must be a nonnegative integer.');
    return count === 0 ? 0 : (1 - Math.exp(-count / configuration.confidenceSaturation)) * Math.min(count / configuration.minimumEvidence, 1);
  }
  function shrunkMean(count, observed, baseline, prior = DEFAULT_CONFIGURATION.priorStrength) {
    if (observed === null || baseline === null) return null;
    return (count * observed + prior * baseline) / (count + prior);
  }
  function scoreOf(book) { return optionalNumber(book.scoreExact) ?? optionalNumber(book.score); }
  function dateOrder(value) {
    const serial = optionalNumber(value);
    if (serial !== null) return serial;
    const raw = text(value);
    // Date-only fields must not depend on host timezone or locale parsing.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const time = Date.parse(raw + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== raw) return null;
    return time / 86400000 + 25569;
  }
  function completedHistory(books) {
    // The workbook gates this evidence on finish date, independently of status.
    return books.filter(book => text(book.dateFinished) !== '').slice();
  }
  function newestFirst(history) {
    // Excel SORTBY retains source order for tied dates. Do not use IDs/finishRank
    // here: those would change author windows relative to the reference formula.
    return history.map((book, index) => ({ book, index, date: dateOrder(book.dateFinished) }))
      .sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity) || a.index - b.index).map(item => item.book);
  }
  function baselineFor(history) {
    const scores = history.map(scoreOf), pages = history.map(book => book.pagesRead), days = history.map(book => book.daysToFin);
    return {
      completedCount: history.length, scoredCount: numbers(scores).length,
      scoreMean: mean(scores), scoreMedian: percentileInc(scores, .5), scoreSD: sampleStandardDeviation(scores),
      pagesMean: mean(pages), pagesMedian: percentileInc(pages, .5),
      daysMean: mean(days), daysMedian: percentileInc(days, .5),
      attributes: Object.fromEntries(ATTRIBUTES.map(name => [name, {
        mean: mean(history.map(book => book[name])),
        sd: sampleStandardDeviation(history.map(book => book[name])),
        count: numbers(history.map(book => book[name])).length
      }]))
    };
  }
  function weightedRecent(history, predicate, configuration) {
    const windows = configuration.recentWindows.map((size, index) => ({
      size, weight: configuration.recentWeights[index],
      average: mean(history.slice(0, size).filter(predicate).map(scoreOf))
    }));
    const usable = windows.filter(window => window.average !== null);
    const denominator = usable.reduce((sum, window) => sum + window.weight, 0);
    return { value: denominator ? usable.reduce((sum, window) => sum + window.weight * window.average, 0) / denominator : null, windows };
  }
  function grouped(history, field) {
    const groups = new Map();
    for (const book of history) {
      const name = text(book[field]);
      if (!name) continue;
      const normalized = key(name);
      if (!groups.has(normalized)) groups.set(normalized, { name, books: [] });
      groups.get(normalized).books.push(book);
    }
    return [...groups.values()].sort((a, b) => key(a.name) < key(b.name) ? -1 : key(a.name) > key(b.name) ? 1 : 0);
  }
  function commonEvidence(group, baseline, configuration) {
    const count = group.books.length, observedMean = mean(group.books.map(scoreOf));
    const shrunk = shrunkMean(count, observedMean, baseline.scoreMean, configuration.priorStrength);
    return { name: group.name, count, scoredCount: numbers(group.books.map(scoreOf)).length,
      observedMean, shrunkMean: shrunk, scoreLift: shrunk === null ? null : shrunk - baseline.scoreMean,
      enjoymentMean: mean(group.books.map(book => book.enjoyment)),
      confidence: evidenceConfidence(count, configuration) };
  }
  function historicalModels(history, baseline, configuration) {
    const recentHistory = newestFirst(history), scoreSD = Math.max(baseline.scoreSD ?? 0, .01);
    const enjoymentSD = Math.max(baseline.attributes.enjoyment.sd ?? 0, .01);
    const attributeSD = Math.max(mean(ATTRIBUTES.map(name => baseline.attributes[name].sd)) ?? 0, .01);
    function groupedModel(field) {
      return grouped(history, field).map(group => {
        const result = commonEvidence(group, baseline, configuration);
        const recent = weightedRecent(recentHistory, book => key(book[field]) === key(group.name), configuration);
        result.recentMean = recent.value;
        result.recentWindows = recent.windows;
        result.recentDelta = recent.value === null || result.observedMean === null ? null : recent.value - result.observedMean;
        if (field === 'author') {
          const enjoyment = shrunkMean(result.count, result.enjoymentMean, baseline.attributes.enjoyment.mean, configuration.priorStrength);
          const w = configuration.authorWeights;
          result.affinity = result.scoreLift === null || enjoyment === null ? null :
            w[0] * result.scoreLift / scoreSD + w[1] * (enjoyment - baseline.attributes.enjoyment.mean) / enjoymentSD +
            w[2] * (recent.value === null ? 0 : recent.value - baseline.scoreMean) / scoreSD;
        } else {
          result.attributes = Object.fromEntries(ATTRIBUTES.map(name => [name, mean(group.books.map(book => book[name]))]));
          const lifts = ATTRIBUTES.map(name => {
            const prior = baseline.attributes[name].mean;
            const value = shrunkMean(result.count, result.attributes[name], prior, configuration.priorStrength);
            return value === null ? null : value - prior;
          });
          const w = configuration.genreWeights;
          // Missing category evidence stays unavailable, not a coerced zero lift.
          result.affinity = result.scoreLift === null || lifts.some(value => value === null) ? null :
            w[0] * result.scoreLift / scoreSD + w[1] * mean(lifts) / attributeSD +
            w[2] * (recent.value === null ? 0 : recent.value - baseline.scoreMean) / scoreSD;
        }
        return result;
      });
    }
    // Preserve legacy THE BOOKS groups, not the app's optional series field.
    const seriesHistory = history.filter(book => text(book.volumes) && key(book.volumes) !== 'standalone');
    const series = grouped(seriesHistory, 'title').filter(group => group.books.length >= configuration.minimumEvidence).map(group => {
      const result = commonEvidence(group, baseline, configuration);
      const scored = group.books.filter(book => scoreOf(book) !== null), ordered = newestFirst(scored);
      const recent = weightedRecent(ordered, () => true, configuration);
      result.latestScore = ordered.length ? scoreOf(ordered[0]) : null;
      result.recentMean = recent.value;
      result.recentWindows = recent.windows;
      result.recentDelta = recent.value === null || result.observedMean === null ? null : recent.value - result.observedMean;
      // Ascending SORTBY retains source order within tied completion dates.
      const chronological = scored.map((book, index) => ({book, index})).sort((a, b) =>
        (dateOrder(a.book.dateFinished) ?? -Infinity) - (dateOrder(b.book.dateFinished) ?? -Infinity) || a.index - b.index);
      result.momentum = slope(chronological.map(item => scoreOf(item.book)));
      const enjoyment = shrunkMean(result.count, result.enjoymentMean, baseline.attributes.enjoyment.mean, configuration.priorStrength);
      const w = configuration.seriesWeights;
      result.affinity = result.scoreLift === null || enjoyment === null || recent.value === null ? null :
        w[0] * result.scoreLift / scoreSD + w[1] * (enjoyment - baseline.attributes.enjoyment.mean) / enjoymentSD +
        w[2] * (recent.value - baseline.scoreMean) / scoreSD + w[3] * result.momentum / scoreSD;
      return result;
    });
    return { genres: groupedModel('genre'), authors: groupedModel('author'), series };
  }
  function evaluateHistoricalEvidence({ books = [], configuration = DEFAULT_CONFIGURATION } = {}) {
    validateConfiguration(configuration);
    const history = completedHistory(books), baseline = baselineFor(history);
    return { engineVersion: configuration.version, configurationVersion: configuration.referenceVersion,
      stage: 'historical-evidence', baseline, ...historicalModels(history, baseline, configuration),
      warnings: history.filter(book => dateOrder(book.dateFinished) === null).map(book => ({
        bookId: book.id ?? null, code: 'INVALID_FINISH_DATE', message: 'Finish date cannot be used for chronological ordering.'
      })) };
  }

  const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
  const zero = value => optionalNumber(value) ?? 0;
  const round = (value, places = 3) => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 10 ** places) / 10 ** places;
  const sum = values => values.reduce((a, b) => a + b, 0);
  const flag = value => value === true || ['true', '1', 'yes'].includes(key(value));
  const MOMENTUM = Object.freeze({'Flew Through':5,'Pretty Fast':4,'Normal Pace':3,'A Bit Slow':2,'Took My Time':1});
  const BANDWIDTH = Object.freeze({Free:.75,Normal:1,Busy:1.25,Swamped:1.5});
  function volumeOrder(book) {
    return optionalNumber(book.sortVolume) ?? (key(book.volumes) === 'standalone' ? 0 : optionalNumber(text(book.volumes).match(/(?:vol(?:ume)?\.?\s*)?(\d+(?:\.\d+)?)/i)?.[1]));
  }
  function pagesOf(book) {
    return optionalNumber(book.count) ?? optionalNumber(book.pageCount) ?? optionalNumber(text(book.pageCount).match(/^(\d+)\s+pages?$/i)?.[1]);
  }
  function prepareBooks(books, derive) {
    const rows = books.map(book => {
      const pages = pagesOf(book), start = dateOrder(book.dateStarted), finish = dateOrder(book.dateFinished);
      return {...book, count:pages, pageBracket:optionalNumber(book.pageBracket) ?? (derive && pages !== null ? Math.round(pages/100)*100 : null),
        daysToFin:optionalNumber(book.daysToFin) ?? (derive && start !== null && finish !== null && finish >= start ? finish-start+1 : null)};
    });
    if (!derive) return rows;
    return rows.map(book => {
      const peers = rows.filter(other => other.pageBracket === book.pageBracket && other.daysToFin !== null);
      const avgDays = optionalNumber(book.avgDays) ?? mean(peers.map(other=>other.daysToFin));
      const pace = book.daysToFin > 0 && avgDays > 0 ? avgDays*(BANDWIDTH[book.readingBandwidth] || 1)/book.daysToFin : null;
      const momentum = text(book.momentum) || (pace === null ? '' : pace>=1.25?'Flew Through':pace>=1.1?'Pretty Fast':pace>=.9?'Normal Pace':pace>=.75?'A Bit Slow':'Took My Time');
      return {...book, avgDays, momentum, pagesRead:optionalNumber(book.pagesRead) ?? (text(book.dateFinished) && key(book.readingStatus) !== 'dnf' ? book.count : null)};
    });
  }
  function byRank(history) {
    return history.map((book,index)=>({book,index,date:dateOrder(book.dateFinished)})).sort((a,b)=>{
      const ar=optionalNumber(a.book.finishRank),br=optionalNumber(b.book.finishRank);
      if(ar!==null && br!==null && ar!==br)return ar-br;
      return (b.date ?? -Infinity)-(a.date ?? -Infinity)||a.index-b.index;
    }).map(item=>item.book);
  }
  function regression(xs, ys) {
    if(xs.length<2)return {slope:0,correlation:0};
    const xbar=mean(xs),ybar=mean(ys),cross=sum(xs.map((x,i)=>(x-xbar)*(ys[i]-ybar)));
    const xx=sum(xs.map(x=>(x-xbar)**2)),yy=sum(ys.map(y=>(y-ybar)**2));
    return {slope:xx?cross/xx:0,correlation:xx&&yy?cross/Math.sqrt(xx*yy):0};
  }
  function calculateState(books, evidence) {
    const history=completedHistory(books), ranked=byRank(history), scored=ranked.filter(b=>scoreOf(b)!==null);
    const recent=scored.slice(0,5),previous=scored.slice(5,10),base=evidence.baseline.scoreMean;
    const recentScore=mean(recent.map(scoreOf)) ?? base,previousScore=mean(previous.map(scoreOf)) ?? base;
    const scoreTrend=round((recentScore ?? 0)-(previousScore ?? 0));
    const moms=ranked.filter(b=>text(b.momentum)),momentum=mean(moms.slice(0,5).map(b=>MOMENTUM[b.momentum]||3)) ?? 3;
    const velocity=moms.length>5?((mean(moms.slice(0,5).map(b=>MOMENTUM[b.momentum]||3))??3)-(mean(moms.slice(5).map(b=>MOMENTUM[b.momentum]||3))??3))/2:0;
    const genres=ranked.filter(b=>text(b.genre)).slice(0,5).map(b=>key(b.genre));
    const saturation=genres.length?Math.max(...genres.map(g=>genres.filter(x=>x===g).length))/genres.length:0;
    const paces=ranked.filter(b=>b.daysToFin>0&&optionalNumber(b.pageBracket)!==null).slice(0,5).map(b=>{
      const expected=books.find(other=>other.pageBracket===b.pageBracket)?.avgDays;
      return expected>0?b.daysToFin/(BANDWIDTH[b.readingBandwidth]||1)/expected:null;
    }).filter(value=>value!==null&&value>0);
    const variability=paces.length>1?round(clamp(sampleStandardDeviation(paces)/mean(paces))):0;
    const diff=(recentScore??0)-(previousScore??0),trend=clamp(diff,-1,1);
    const lowRate=previous.length&&recent.length?recent.filter(b=>scoreOf(b)<previousScore).length/recent.length:0;
    const validMom=recent.filter(b=>text(b.momentum));
    const slowRate=validMom.length?validMom.filter(b=>['A Bit Slow','Took My Time'].includes(b.momentum)).length/validMom.length:0;
    const enjoyTrend=clamp(slope(recent.map(b=>optionalNumber(b.enjoyment)).filter(v=>v!==null).reverse()),-1,1);
    const burnout=previous.length?clamp(.25*lowRate+.15*slowRate+.15*variability+.15*saturation+.15*Math.max(0,-trend)+.15*Math.max(0,-enjoyTrend)):0;
    const pressures=Object.fromEntries(MODES.map(mode=>[mode,0]));
    let mode='NEUTRAL';
    if(scored.length>=10) {
      const ml=mean(recent.map(b=>MOMENTUM[b.momentum]||3))/5;
      const mt=clamp((mean(recent.map(b=>MOMENTUM[b.momentum]||3))-mean(previous.map(b=>MOMENTUM[b.momentum]||3)))/4,-1,1);
      const slow=recent.filter(b=>['A Bit Slow','Took My Time'].includes(b.momentum)).length/5;
      const fast=recent.filter(b=>['Flew Through','Pretty Fast'].includes(b.momentum)).length/5;
      const gs=Math.max(...recent.map(b=>recent.filter(x=>key(x.genre)===key(b.genre)).length))/5;
      const et=clamp(slope(recent.map(b=>zero(b.enjoyment)).reverse()),-1,1);
      const streak=recent.filter(b=>scoreOf(b)>=previousScore).length/5;
      const resilience=clamp(.5+Math.max(0,trend)*.21+ml*.12+Math.max(0,et)*.12+streak*.06-burnout*.32-lowRate*.12);
      pressures.FLOW=clamp(8+Math.max(0,diff)*28+ml*18+fast*12+Math.max(0,trend)*14+streak*10+Math.max(0,et)*10+(resilience-.5)*8-burnout*24,0,85);
      pressures.SAVOUR=clamp(5+Math.max(0,diff)*42+(1-ml)*18+slow*23+streak*10+Math.max(0,et)*20+(resilience-.5)*6-burnout*28-ml*8,0,100);
      pressures.ESCAPE=clamp(5+Math.max(0,-diff)*22+ml*15+fast*15+lowRate*12+Math.max(0,-trend)*12+gs*18+Math.max(0,.5-resilience)*6,0,75);
      pressures.DANGER=clamp(variability*25+Math.max(0,-mt)*22+Math.max(0,-trend)*22+lowRate*18+Math.max(0,-et)*10+gs*12+burnout*15+Math.max(0,.45-resilience)*10-Math.max(0,.4-variability)*15,0,100);
      pressures.BURNOUT=clamp(burnout*40+lowRate*14+slow*10+Math.max(0,-trend)*16+Math.max(0,-et)*14+gs*8+Math.max(0,-mt)*10+Math.max(0,burnout-.7)*80+Math.max(0,.4-resilience)*15-streak*10,0,90);
      pressures.RESET=clamp(gs*15+lowRate*15+variability*10+Math.max(0,burnout-.5)*25+Math.max(0,.35-resilience)*8-streak*15-Math.max(0,trend)*12,0,100);
      pressures.NEUTRAL=clamp(38+Math.max(0,.45-Math.abs(trend))*18+Math.max(0,.5-variability)*15+Math.max(0,1-Math.abs(ml-.5))*12+Math.max(0,.25-Math.abs(diff))*25+Math.max(0,.5-Math.abs(streak-.4))*12-burnout*12-lowRate*10,0,80);
      mode=MODES.reduce((best,next)=>pressures[next]>pressures[best]?next:best,MODES[0]);
    }
    const proportions=[saturation,1-saturation,clamp((momentum-1)/4),Math.max(0,1-Math.min(1,Math.abs(scoreTrend))),clamp(Math.abs((recentScore??0)-(base??0)))];
    const total=sum(proportions),pcts=proportions.map(v=>total?v/total:0),sorted=pcts.slice().sort((a,b)=>b-a);
    const names=['Curated Reader','Exploratory Reader','Momentum Reader','Consistency Seeker','Taste Developing'];
    const profile=!history.length?'New Reader':sorted[0]-sorted[1]<.15?'Balanced Reader':names[pcts.indexOf(sorted[0])];
    return {mode,profile,profileProportions:Object.fromEntries(names.map((name,i)=>[name,pcts[i]])),baseline:base,recentScore,previousScore,scoreTrend,momentum,velocity,saturation,paceVariability:variability,burnout,pressures,scoredCount:scored.length,
      explanation:scored.length<10?'Using Neutral until ten rated completions are available.':`Latest five average ${recentScore.toFixed(2)} / 5; previous five ${previousScore.toFixed(2)} / 5.`};
  }
  function eligibleCandidates(books, policy) {
    return books.filter(book=>{
      const status=key(book.readingStatus||book.workbookStatus||book.status),collection=key(book.collectionStatus||book.status);
      if(!text(book.id)||text(book.dateFinished)||flag(book.finished)||flag(book.reading)||['sold','unhauled','did not finish','dropped','blocked','reading','dnf','read'].includes(status)||['sold','unhauled'].includes(collection))return false;
      if(policy==='desktop' && (['loaned out','wishlist'].includes(collection)||status==='wishlist'))return false;
      const order=volumeOrder(book);
      if(key(book.volumes)==='standalone'||order!==null&&order<=1)return true;
      if(order===null)return false;
      const previous=books.filter(other=>key(other.title)===key(book.title)&&volumeOrder(other)!==null&&volumeOrder(other)<order);
      if(!previous.length)return false;
      const preceding=Math.max(...previous.map(volumeOrder));
      // Workbook permits the highest prior listed volume; desktop requires the
      // immediately preceding integer volume so a missing gap is not hidden.
      if(policy==='desktop'&&Number.isInteger(order)&&order>1&&preceding!==order-1)return false;
      return previous.some(other=>volumeOrder(other)===preceding&&(flag(other.finished)||text(other.dateFinished)));
    }).sort((a,b)=>key(a.title)<key(b.title)?-1:key(a.title)>key(b.title)?1:zero(a.pageBracket)-zero(b.pageBracket)||compareIds(a.id,b.id));
  }
  function compareIds(a,b) {return text(a)<text(b)?-1:text(a)>text(b)?1:0;}
  function modeFit(features,weights) {
    const denominator=sum(weights.map(Math.abs));
    if(!denominator)throw new RangeError('Mode weights must not all be zero.');
    return sum(features.map((value,index)=>(weights[index]>=0?value:1-value)*Math.abs(weights[index])))/denominator;
  }
  function predictCandidates(books,evidence,configuration) {
    const history=completedHistory(books),{baseline}=evidence,settings=configuration.pipeline||PIPELINE_SETTINGS;
    const base=baseline.scoreMean,cap=settings.signalCap,limit=x=>clamp(x,-cap,cap);
    const find=(rows,name)=>rows.find(row=>key(row.name)===key(name));
    const grPairs=history.filter(b=>optionalNumber(b.goodreads)!==null&&scoreOf(b)!==null);
    const gr=regression(grPairs.map(b=>Number(b.goodreads)),grPairs.map(scoreOf));
    gr.count=grPairs.length;gr.mean=mean(grPairs.map(b=>Number(b.goodreads)));gr.confidence=evidenceConfidence(gr.count,configuration)*Math.abs(gr.correlation);
    const pageValues=history.map(pagesOf),pageMean=mean(pageValues),pageSD=sampleStandardDeviation(pageValues)??0;
    const bands=new Map();
    for(const book of history)if(optionalNumber(book.pageBracket)!==null){if(!bands.has(book.pageBracket))bands.set(book.pageBracket,[]);bands.get(book.pageBracket).push(book);}
    const length=new Map([...bands].map(([band,rows])=>{
      const n=rows.length,score=shrunkMean(n,mean(rows.map(scoreOf)),base,configuration.priorStrength),enjoy=shrunkMean(n,mean(rows.map(b=>b.enjoyment)),baseline.attributes.enjoyment.mean,configuration.priorStrength);
      return [band,{count:n,confidence:evidenceConfidence(n,configuration),affinity:score===null||enjoy===null?0:settings.lengthWeights[0]*(score-base)/Math.max(baseline.scoreSD??0,.01)+settings.lengthWeights[1]*(enjoy-baseline.attributes.enjoyment.mean)/Math.max(baseline.attributes.enjoyment.sd??0,.01)}];
    }));
    return books.map(book=>{
      const genre=find(evidence.genres,book.genre),author=find(evidence.authors,book.author),series=key(book.volumes)==='standalone'?null:find(evidence.series,book.title),len=length.get(book.pageBracket);
      const sd=baseline.scoreSD??0,gc=genre?.confidence||0,ac=author?.confidence||0,sc=series?.confidence||0;
      const direct=ATTRIBUTES.filter(name=>optionalNumber(book[name])!==null&&baseline.attributes[name].mean!==null);
      const proxy=genre&&genre.count>=configuration.minimumEvidence?genre:null;
      const deltas=proxy?ATTRIBUTES.map(name=>{const avg=baseline.attributes[name].mean;const shrunk=shrunkMean(proxy.count,proxy.attributes[name],avg,configuration.priorStrength);return shrunk===null?null:shrunk-avg;}).filter(v=>v!==null):[];
      const attrSignal=limit(direct.length?mean(direct.map(name=>Number(book[name])-baseline.attributes[name].mean))/2:(mean(deltas)??0)/2);
      const attrConf=direct.length?(direct.length/7)*evidenceConfidence(baseline.attributes.enjoyment.count,configuration):deltas.length?gc*.75:0;
      const gcSignal=limit(gc*(.7*zero(genre?.scoreLift)+.2*zero(genre?.affinity)*sd+.1*zero(genre?.recentDelta)));
      const acSignal=limit(ac*(.75*zero(author?.scoreLift)+.15*zero(author?.affinity)*sd+.1*zero(author?.recentDelta)));
      const scSignal=limit(sc*(.5*zero(series?.scoreLift)+.2*zero(series?.affinity)*sd+.1*((series?.latestScore??base)-base)+.1*((series?.recentMean??base)-base)+.1*zero(series?.momentum)));
      const recentRows=[genre,author,series].filter(row=>row?.recentDelta!=null),recentDen=sum(recentRows.map(row=>row.confidence));
      const recentSignal=limit(recentDen?sum(recentRows.map(row=>row.recentDelta*row.confidence))/recentDen:0);
      const goodreads=optionalNumber(book.goodreads),grConf=goodreads!==null?gr.confidence:0;
      const grSignal=goodreads!==null&&gr.mean!==null?limit((goodreads-gr.mean)*gr.slope*grConf):0;
      const signals={genre:gcSignal,author:acSignal,series:scSignal,attributes:attrSignal,goodreads:grSignal,length:limit((len?.affinity||0)*sd*(len?.confidence||0)),recentTaste:recentSignal};
      const predictedScore=base===null?null:clamp(base+sum(Object.values(signals).map((value,i)=>value*settings.predictionWeights[i])),0,5);
      const strength=1-(1-.3*gc)*(1-.2*ac)*(1-.2*sc)*(1-.15*attrConf)*(1-.1*grConf)*(1-.1*(len?.confidence||0))*(1-.05*(recentRows.length?Math.max(gc,ac,sc):0));
      const confidence=settings.confidenceFloor+(1-settings.confidenceFloor)*strength;
      const isSeries=key(book.volumes)!=='standalone',novelty=((gc<.2?1:0)+(ac===0?1:0)+(isSeries&&sc===0?1:0))/(2+Number(isSeries));
      const unusual=book.count!==null&&pageMean!==null?Math.min(1,Math.abs(book.count-pageMean)/Math.max(2*pageSD,1)):0;
      const mismatch=Math.min(1,sum(Object.values(signals).map(v=>Math.max(0,-v)))/(4*cap)+.25*unusual);
      const positive=Math.min(1,sum(Object.values(signals).map(v=>Math.max(0,v)))/(3*cap));
      const risk=clamp(settings.riskWeights[0]*(1-confidence)+settings.riskWeights[1]*mismatch+settings.riskWeights[2]*novelty);
      const reward=predictedScore===null?null:clamp(settings.rewardWeights[0]*(predictedScore/5)+settings.rewardWeights[1]*positive+settings.rewardWeights[2]*novelty);
      const contributions=Object.entries(signals).map(([channel,value],i)=>({channel,signal:value,weight:settings.predictionWeights[i],adjustment:value*settings.predictionWeights[i]}));
      return {book,bookId:book.id,predictedScore,confidence,risk,reward,strength,signals,contributions,evidence:{genre:genre?.count||0,author:author?.count||0,series:series?.count||0,attributes:direct.length?`Direct (${direct.length}/7)`:deltas.length?'Genre proxy':'No evidence',goodreads:goodreads!==null?gr.count:0,length:len?.count||0},confidences:{genre:gc,author:ac,series:sc,attributes:attrConf,goodreads:grConf,length:len?.confidence||0},pageSD,pageMean};
    });
  }
  function candidateFeatures(candidate,books,evidence,state,settings) {
    const {book,predictedScore,confidence,confidences:c,signals:s}=candidate,history=newestFirst(completedHistory(books));
    const share=n=>history.length?history.slice(0,n).filter(row=>key(row.genre)===key(book.genre)).length/Math.min(n,history.length):0;
    const continuity=clamp(.45*(candidate.evidence.series?c.series:0)+.25*c.author+.2*c.genre+.1*Math.max(0,s.recentTaste)/settings.signalCap);
    const diversity=clamp(1-(.7*share(5)+.3*share(25))),fatigue=clamp(share(5)*(.5+.5*state.saturation));
    const commitment=key(book.volumes)==='standalone'?1:(volumeOrder(book)??1)<=1?.75:candidate.evidence.series>0?.55:.4;
    const median=evidence.baseline.pagesMedian??candidate.pageMean??300,pages=book.count,pageSD=Math.max(candidate.pageSD,1);
    const shortness=pages===null?.5:clamp(1-Math.max(0,pages-median)/(2*pageSD));
    const enjoyment=predictedScore===null?.5:predictedScore/5;
    const burnoutFit=clamp(.35*enjoyment+.2*confidence+.2*shortness+.15*commitment+.1*(1-fatigue));
    const pageBurden=pages===null?.5:clamp(.5+(pages-median)/(4*pageSD));
    const resistance=clamp(.3*pageBurden+.25*(1-commitment)+.2*(1-confidence)+.15*fatigue+.1*clamp(-state.velocity/2)*(.5+.5*state.burnout));
    const exploration=clamp(.35*diversity+.25*(1-c.genre)+.2*(1-c.author)+.1*(key(book.volumes)==='standalone'?.5:1-c.series)+.1*(1-c.attributes));
    const momentum=clamp(.35*enjoyment+.25*continuity+.2*Math.max(0,s.recentTaste)/settings.signalCap+.2*(1-resistance));
    const immersion=clamp(.5+s.attributes/(2*settings.signalCap))*c.attributes+.5*(1-c.attributes);
    const vector=[enjoyment,confidence,continuity,diversity,fatigue,burnoutFit,resistance,commitment,exploration,candidate.reward??0,candidate.risk,momentum,immersion];
    const fits=Object.fromEntries(MODES.map(mode=>[mode,modeFit(vector,settings.modeWeights[mode])]));
    const vol=text(book.volumes).match(/Vol\. (\d+(?:\.\d+)?)/)?.[1];
    const continuation=vol>1&&history.some(row=>key(row.title)===key(book.title)&&Number(text(row.volumes).match(/Vol\. (\d+(?:\.\d+)?)/)?.[1])>0&&Number(text(row.volumes).match(/Vol\. (\d+(?:\.\d+)?)/)?.[1])<Number(vol));
    return {enjoyment,confidence,continuity,diversity,fatigue,burnoutFit,resistance,commitment,exploration,momentum,immersion,fits,seriesContinuation:!!continuation,strongAuthor:candidate.evidence.author>=3&&s.author>0};
  }
  function evaluateRoles(candidates,mode,history,settings,policy) {
    const pc=percentileInc(candidates.map(c=>c.confidence),.5)??0,pe=percentileInc(candidates.map(c=>c.features.exploration),.6)??0,pr=percentileInc(candidates.map(c=>c.reward),.6)??0,rr=percentileInc(candidates.map(c=>c.risk),.5)??0,rs=percentileInc(candidates.map(c=>c.features.resistance),.4)??0;
    return candidates.map(c=>{
      const f=c.features,p=(c.predictedScore??0)/5,fit=f.fits[mode],cf=c.confidence,r=c.risk,rw=c.reward??0,ev=c.strength;
      const scores=[.3*p+.2*fit+.12*cf+.1*(1-r)+.1*rw+.08*(1-f.resistance)+.05*f.continuity+.05*f.exploration,
        .25*p+.25*cf+.15*ev+.15*(1-r)+.1*(1-f.resistance)+.1*fit,
        .25*f.continuity+.2*c.confidences.series+.15*p+.15*fit+.1*f.momentum+.1*Number(f.strongAuthor)+.05*rw,
        .25*f.exploration+.2*f.diversity+.15*rw+.15*p+.1*cf+.1*(1-f.resistance)+.05*fit,
        .25*rw+.2*Math.max(0,1-Math.abs(r-.65)/.65)+.2*f.exploration+.15*p+.1*fit+.1*(1-c.confidences.attributes),
        .3*(1-f.resistance)+.2*p+.15*cf+.15*f.commitment+.1*f.burnoutFit+.1*f.fits.RESET];
      const conditions=[c.predictedScore>=3.8,cf>=pc&&c.predictedScore>=4,f.seriesContinuation&&(policy==='workbook'||c.evidence.series>=3),f.exploration>=pe&&f.diversity>=.8&&c.predictedScore>=4,rw>=pr&&r>=rr&&c.predictedScore>=3.9,f.resistance<=rs&&c.predictedScore>=4];
      const roleResults=Object.fromEntries(ROLES.map((role,index)=>{
        const declined=history.some(event=>event.bookId===c.bookId&&event.mode===mode&&event.role===role&&event.action==='Declined'&&!event.restored);
        const qualifies=c.predictedScore!==null&&!!conditions[index]&&!declined;
        return [role,{score:scores[index],qualifies,reason:declined?'Dismissed for this role and mode.':c.predictedScore===null?'Add a personal rating to establish a baseline.':conditions[index]?'Qualifies for this role.':'Below this role’s quality or evidence threshold.',priority:100*(.55*scores[index]+.2*fit+.2*p+.05*settings.modeRolePriorities[mode][index]/Math.max(...Object.values(settings.modeRolePriorities).flat()))}];
      }));
      return {...c,modeFit:fit,modeScore:100*fit,recommendationScore:65*p+35*fit,roles:roleResults};
    });
  }
  function ranking(role) {return (a,b)=>b.roles[role].priority-a.roles[role].priority||(b.predictedScore??0)-(a.predictedScore??0)||b.confidence-a.confidence||compareIds(a.bookId,b.bookId);}
  function assemblePortfolio(candidates,settings) {
    const used=new Set(),genres=[];
    return ROLES.map((role,index)=>{
      const alternatives=candidates.filter(c=>c.roles[role].qualifies).sort(ranking(role)),winner=alternatives[0];
      if(!winner)return {role,candidate:null,alternatives:[],reason:'No qualifying candidate for this role.'};
      const remaining=alternatives.filter(c=>!used.has(c.bookId));
      const floor=settings.alternativeFloors[index]*(role==='CONTINUATION'?(remaining[0]?.roles[role].priority||0):winner.roles[role].priority);
      const adjusted=c=>c.roles[role].priority-2*genres.filter(g=>g===key(c.book.genre)).length;
      const options=remaining.filter(c=>c.roles[role].priority>=floor).sort((a,b)=>adjusted(b)-adjusted(a)||ranking(role)(a,b));
      const candidate=index===0?winner:options[0]||(!used.has(winner.bookId)?winner:null);
      if(candidate){used.add(candidate.bookId);genres.push(key(candidate.book.genre));}
      return {role,candidate,alternatives,reason:candidate?'': 'No distinct candidate meets the alternative floor.'};
    });
  }
  function evaluateEngine({books=[],configuration=DEFAULT_CONFIGURATION,mode=null,recommendationHistory=[],policy='desktop',evaluationDate}={}) {
    validateConfiguration(configuration);
    if(!['desktop','workbook'].includes(policy))throw new RangeError('Unknown eligibility policy.');
    if(mode!==null&&!MODES.includes(mode))throw new RangeError('Unknown reading mode.');
    if(evaluationDate!==undefined&&dateOrder(evaluationDate)===null)throw new RangeError('Invalid evaluation date.');
    const prepared=prepareBooks(books,policy==='desktop'),evidence=evaluateHistoricalEvidence({books:prepared,configuration}),state=calculateState(prepared,evidence);
    const effectiveMode=mode||state.mode,settings=configuration.pipeline||PIPELINE_SETTINGS;
    const eligible=eligibleCandidates(prepared,policy),predictions=predictCandidates(prepared,evidence,configuration);
    const byId=new Map(predictions.map(c=>[c.bookId,c]));
    const pool=eligible.map(b=>byId.get(b.id)).map(c=>({...c,features:candidateFeatures(c,prepared,evidence,state,settings)}));
    const candidateEvaluations=evaluateRoles(pool,effectiveMode,recommendationHistory,settings,policy).sort((a,b)=>b.recommendationScore-a.recommendationScore||(b.predictedScore??0)-(a.predictedScore??0)||b.confidence-a.confidence||compareIds(a.bookId,b.bookId));
    return {engineVersion:'engine2-desktop-2',configurationVersion:configuration.referenceVersion,evaluationDate:evaluationDate??null,policy,state:{...state,effectiveMode,modeSource:mode?'preview':'automatic'},evidence,candidateEvaluations,portfolio:assemblePortfolio(candidateEvaluations,settings),excludedCount:books.length-eligible.length};
  }

  const api = Object.freeze({ MODES, ROLES, evaluateEngine, modeFit, calculateState, prepareBooks, assemblePortfolio, ATTRIBUTES, DEFAULT_CONFIGURATION, optionalNumber, mean, percentileInc,
    sampleStandardDeviation, evidenceConfidence, shrunkMean, completedHistory, evaluateHistoricalEvidence });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovelTrackerEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
