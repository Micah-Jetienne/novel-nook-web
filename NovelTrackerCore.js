(function (root) {
  'use strict';
  const STATUSES = ['On Hold', 'Blocked', 'Reading', 'Read', 'DNF', 'Wishlist'];
  const MODES = ['FLOW', 'SAVOUR', 'NEUTRAL', 'ESCAPE', 'DANGER', 'BURNOUT', 'RESET'];
  const ROLES = ['PRIMARY', 'EXPLORER', 'WILDCARD', 'LOW-RESISTANCE'];
  const HEADER_MAP = {
    thebooks:'title', datebought:'dateBought', month:'month', genre:'genre', publisher:'publisher', imprint:'imprint', author:'author', illustrator:'illustrator',
    arcschapters:'arcsAndChapters', gender:'gender', myvolumes:'volumes', pagecount:'pageCount', relationshipwithauthor:'relationshipWithAuthor', datestarted:'dateStarted',
    datefinished:'dateFinished', completed:'completionMonth', recommended:'recommended', reading:'reading', finished:'finished', adaptations:'adaptations', subgenre:'subGenre',
    agerating:'ageRating', country:'country', year:'year', characters:'characters', atmosphere:'atmosphere', writing:'writing', plot:'plot', pacing:'pacing',
    worldbuilding:'worldbuilding', enjoyment:'enjoyment', score:'score', goodreads:'goodreads', scoreband:'scoreBand', momentum:'momentum', acquired:'acquired', cost:'cost',
    merchant:'merchant', status:'status', count:'count', pagesread:'pagesRead', daystofin:'daysToFin', id:'workbookId', detailedstart:'detailedStart', detailedfinish:'detailedFinish',
     yearcount:'yearCount', pagebracket:'pageBracket', avgdays:'avgDays', finishrank:'finishRank', sortvolume:'sortVolume', burnoutrisk:'burnoutRisk', booknotes:'bookNotes', authornotes:'authorNotes', readingbandwidth:'readingBandwidth'
  };
  const READING_BANDWIDTH = Object.freeze({ Free: 0.75, Normal: 1, Busy: 1.25, Swamped: 1.5 });
  const normKey = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const truthy = value => ['1', 'true', 'yes', 'y', 'x', 'completed'].includes(String(value ?? '').trim().toLowerCase());
  const text = value => value == null ? '' : String(value).trim();
  const FRACTIONAL_DATA_KEY = /(score|rating|goodreads|cost|price|money|spend|budget|discount|weight|average|avg|ratio|rate|correlation|index|stamina|confidence|accuracy|trust|momentum|lift|success|satisfaction|variance|percent|percentage)/i;
  const DATE_DATA_KEY = /(date|time|timestamp)/i;
  function roundTwo(value) { const number=Number(value);return Number.isFinite(number)?Number((Math.round((number+Number.EPSILON*Math.sign(number)*Math.abs(number))*100)/100).toFixed(2)):value; }
  const EXACT_DATA_KEYS = new Set(['engineConfiguration', 'engineEvaluations', 'recommendationSnapshots', 'recommendationEvents', 'readingAttempts']);
  function roundDataNumbers(value, key = '', preservePrecision = false) {
    preservePrecision = preservePrecision || EXACT_DATA_KEYS.has(key);
    if (Array.isArray(value)) return value.map(item => roundDataNumbers(item, key, preservePrecision));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, roundDataNumbers(child, childKey, preservePrecision)]));
    if (preservePrecision) return value;
    if (DATE_DATA_KEY.test(key) || key === 'scoreExact') return value;
    if (typeof value === 'number') return roundTwo(value);
    if (typeof value !== 'string') return value;
    const raw = value.trim();
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return value;
    const number = Number(raw);
    if (!Number.isFinite(number)) return value;
    return FRACTIONAL_DATA_KEY.test(key) || !Number.isInteger(number) ? number.toFixed(2) : value;
  }
  function excelDate(value) {
    const str = text(value);
    if (!str) return '';
    if (/^\d{4}-\d\d-\d\d$/.test(str)) return str;
    if (/^\d+(\.\d+)?$/.test(str) && Number(str) > 20000 && Number(str) < 90000) {
      return new Date(Date.UTC(1899, 11, 30) + Number(str) * 86400000).toISOString().slice(0, 10);
    }
    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? str : parsed.toISOString().slice(0, 10);
  }
  function statusOf(book) {
    const raw = text(book?.readingStatus || book?.workbookStatus || book?.status).toLowerCase();
    const aliases = { 'read!':'Read', read:'Read', finished:'Read', complete:'Read', completed:'Read', reading:'Reading', 'on hold':'On Hold', paused:'On Hold', unread:'On Hold', 'to read':'On Hold', blocked:'Blocked', dropped:'DNF', dnf:'DNF', 'did not finish':'DNF', 'did not finish reading':'DNF', wishlist:'Wishlist' };
    if (aliases[raw]) return aliases[raw];
    if (STATUSES.includes(book?.readingStatus)) return book.readingStatus;
    if (truthy(book?.completed) || truthy(book?.finished) || book?.dateFinished) return 'Read';
    if (truthy(book?.reading) || book?.dateStarted) return 'Reading';
    return 'On Hold';
  }
  function collectionStatusOf(book) {
    if (book?.collectionStatus) return book.collectionStatus;
    const raw = text(book?.workbookStatus || book?.status);
    return ['Sold', 'Unhauled', 'Owned', 'Borrowed', 'Loaned Out'].includes(raw) ? raw : 'Owned';
  }
  function normalizeBook(input, index = 0) {
    const source = input && typeof input === 'object' ? input : {};
    const out = { ...source };
    for (const [key, value] of Object.entries(source)) {
      const mapped = HEADER_MAP[normKey(key)];
      if (mapped && !(mapped in out)) out[mapped] = value;
    }
    out.title = text(out.title) || 'Untitled book';
    if (!out.engineSeriesKey && text(source['THE BOOKS'])) out.engineSeriesKey = text(source['THE BOOKS']);
    out.author = text(out.author);
    out.id = text(out.id || out.workbookId) || `book-${index + 1}-${hash([out.title,out.author,out.volumes||'',out.series||''].join('|'))}`;
    for (const key of ['dateBought', 'dateStarted', 'dateFinished']) out[key] = excelDate(out[key]);
    for (const key of ['detailedStart', 'detailedFinish']) out[key] = excelDateTime(out[key]);
    out.workbookStatus = text(out.workbookStatus || out.status);
    if (out.workbookStatus === 'Favourite' && out.isFavourite == null) out.isFavourite = true;
    // Number('') and Number(null) are zero. Missing ratings must stay missing,
    // including when a backup contains an empty scoreExact and a valid SCORE.
    const scoreNumber = value => typeof value !== 'boolean' && text(value) !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    out.scoreExact = scoreNumber(out.scoreExact) ?? scoreNumber(out.score) ?? '';
    out.score = text(out.score);
    out.scoreBand = text(out.scoreBand) || scoreBand(out.score);
    out.readingStatus = statusOf(out);
    if (!Object.prototype.hasOwnProperty.call(READING_BANDWIDTH, text(out.readingBandwidth))) out.readingBandwidth = 'Normal';
    out.collectionStatus = collectionStatusOf(out);
    if (out.readingStatus === 'Read' && !numeric(out.pagesRead)) out.pagesRead = numeric(out.count) || numeric(out.pageCount) || ''; 
    if (out.readingStatus === 'Read' && out.dateStarted && out.dateFinished) out.completed = '1';
    if (out.readingStatus === 'DNF') out.completed = '0';
    return roundDataNumbers(out);
  }
  function hash(value) { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16); }
  function isComplete(book) { return statusOf(book) === 'Read'; }
  function percentileInc(scores, percentile) {
    const list = (scores || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return 0;
    const position = (list.length - 1) * Math.max(0, Math.min(1, percentile));
    const lower = Math.floor(position), upper = Math.ceil(position), fraction = position - lower;
    return list[lower] + (list[upper] - list[lower]) * fraction;
  }
  function percentRankInc(scores, value) {
    const list = (scores || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (list.length <= 1) return 1;
    const n = Number(value);
    if (n < list[0]) return 0;
    if (n > list[list.length - 1]) return 1;
    let low = 0, high = list.length;
    while (low < high) { const mid = (low + high) >> 1; if (list[mid] < n) low = mid + 1; else high = mid; }
    if (list[low] === n) return low / (list.length - 1);
    const lower = low - 1, fraction = (n - list[lower]) / (list[low] - list[lower]);
    return (lower + fraction) / (list.length - 1);
  }
  function scoreBandName(value, scores = [], thresholds = null) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    const list = (scores || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const cutoff = (key, p) => thresholds?.[key] != null && thresholds[key] !== '' && Number.isFinite(Number(thresholds[key])) ? Number(thresholds[key]) : percentileInc(list, p);
    const high = cutoff('Exceptional', .85);
    const great = cutoff('Great', .65);
    const good = cutoff('Good', .4);
    const decent = cutoff('Decent', .2);
    return n >= high ? 'Exceptional' : n >= great ? 'Great' : n >= good ? 'Good' : n >= decent ? 'Decent' : 'Weak';
  }
  function scoreBand(value, scores = [], thresholds = null) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    const list = (scores || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = Math.round(percentRankInc(list, n) * 1000) / 1000;
    const top = Math.round(Math.max(1 - percentile, .01) * 100);
    const name = scoreBandName(n, list, thresholds);
    const icon = {Exceptional:'🪎', Great:'🔥', Good:'🔮', Decent:'🪫', Weak:'💣'}[name];
    return `${icon} ${name} • Top ${top}%`;
  }
  function weightedScore(book, genreRows = []) {
    const fields = ['characters', 'atmosphere', 'writing', 'plot', 'pacing', 'worldbuilding', 'enjoyment'];
    const ratings = fields.map(k => numeric(book?.[k]));
    if (!fields.some(k => book?.[k] !== '' && book?.[k] != null && Number.isFinite(Number(book[k])))) return null;
    const pages = numeric(book?.count || book?.pageCount);
    const bracket = Math.round(pages / 100) * 100;
    const short = bracket <= 300, epic = bracket > 600;
    const genre = String(book?.genre || '').toLowerCase();
    const row = (genreRows || []).find(r => String(r.Genre || r.genre || '').toLowerCase() === genre);
    const genreWeight = key => row && Number.isFinite(Number(row[key])) ? Number(row[key]) : 1;
    const format = [short ? 0.8 : epic ? 1.2 : 1, short ? 1.2 : 1, 1, 1, epic ? 0.9 : 1, short ? 0.6 : epic ? 1.3 : 1, short ? 1.3 : 1.1];
    const weights = fields.map((k, i) => genreWeight(k[0].toUpperCase()+k.slice(1)) * format[i]);
    const numerator = ratings.reduce((sum, rating, i) => sum + rating * weights[i], 0);
    const denominator = weights.reduce((sum, weight) => sum + weight, 0);
    return denominator ? numerator / denominator / 2 : null;
  }
  function readingMetrics(book, books = []) {
    const pages = numeric(book?.count || book?.pageCount);
    const pageBracket = pages ? Math.round(pages / 100) * 100 : '';
    const start = Date.parse(String(book?.dateStarted || '') + 'T00:00:00Z');
    const end = Date.parse(String(book?.dateFinished || '') + 'T00:00:00Z');
    const days = Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.floor((end - start) / 86400000) + 1 : (!book?.dateFinished && book?.dateStarted ? 'Reading' : '');
    const peers = (books || []).filter(b => numeric(b?.count || b?.pageCount) && Math.round(numeric(b?.count || b?.pageCount) / 100) * 100 === pageBracket).map(b => {
      const a = Date.parse(String(b?.dateStarted || '') + 'T00:00:00Z'), z = Date.parse(String(b?.dateFinished || '') + 'T00:00:00Z');
      return Number.isFinite(a) && Number.isFinite(z) && z >= a ? Math.floor((z-a)/86400000)+1 : null;
    }).filter(Number.isFinite);
    const avgDays = peers.length ? peers.reduce((a,b)=>a+b,0)/peers.length : '';
    const bandwidth = READING_BANDWIDTH[text(book?.readingBandwidth)] || 1;
    const adjustedExpectedDays = avgDays ? avgDays * bandwidth : '';
    const pace = typeof days === 'number' && adjustedExpectedDays ? adjustedExpectedDays / days : 0;
    const momentum = pace >= 1.25 ? 'Flew Through' : pace >= 1.1 ? 'Pretty Fast' : pace >= .9 ? 'Normal Pace' : pace >= .75 ? 'A Bit Slow' : pace ? 'Took My Time' : '';
    const finished = (books || []).filter(b => b?.dateFinished).map(b => String(b.dateFinished)).sort((a,b)=>b.localeCompare(a));
    const finishRank = book?.dateFinished ? finished.filter(d => d > String(book.dateFinished)).length + 1 : '';
    return { count: pages || '', pagesRead: statusOf(book) === 'Read' ? (numeric(book?.pagesRead) || pages) : (book?.pagesRead || ''), daysToFin: days, pageBracket, avgDays, adjustedExpectedDays, readingBandwidth: text(book?.readingBandwidth) || 'Normal', readingBandwidthMultiplier: bandwidth, paceRatio: pace, momentum, finishRank, yearCount: book?.dateFinished ? String(book.dateFinished).slice(0,4) : '' };
  }
  function finishedNewestFirst(books = []) {
    return (books || []).filter(book => ['Read','DNF'].includes(statusOf(book)) && text(book.dateFinished)).slice().sort((a,b) => String(b.dateFinished).localeCompare(String(a.dateFinished)) || numeric(a.finishRank)-numeric(b.finishRank));
  }
  function engineMode(books = []) {
    const finished = finishedNewestFirst(books);
    const recent = finished.slice(0, 5), previous = finished.slice(5, 10);
    const score = book => numeric(book.scoreExact) || numeric(book.score);
    const pace = book => numeric(book.paceRatio) || numeric(readingMetrics(book, books).paceRatio);
    const recentScores = recent.map(score).filter(value => value > 0), previousScores = previous.map(score).filter(value => value > 0);
    const recentPaces = recent.map(pace).filter(value => value > 0), previousPaces = previous.map(pace).filter(value => value > 0);
    const scoreHistory = finished.map(score).filter(value => value > 0);
    const recentAverage = recentScores.length ? meanValue(recentScores) : 0;
    const previousAverage = previousScores.length ? meanValue(previousScores) : 0;
    const overallAverage = scoreHistory.length ? meanValue(scoreHistory) : 4;
    const profile = readingProfile(books).name.replace(' Reader','');
    const highPercentile = ({'Curated':.8,'Exploratory':.65,'Momentum':.7,'Consistency Seeker':.75,'Taste Developing':.75,'Balanced':.75})[profile] ?? .75;
    const lowPercentile = ({'Curated':.2,'Exploratory':.15,'Momentum':.25,'Consistency Seeker':.3,'Taste Developing':.25,'Balanced':.25})[profile] ?? .25;
    const highThreshold = percentileInc(scoreHistory, highPercentile) - ({'Curated':.05,'Exploratory':.12,'Momentum':.08}[profile] ?? .1);
    const lowThreshold = percentileInc(scoreHistory, lowPercentile);
    const recentPace = recentPaces.length ? meanValue(recentPaces) : 0;
    const previousPace = previousPaces.length ? meanValue(previousPaces) : 0;
    const comparisonReady = recent.length >= 5 && previous.length >= 5;
    const scoreDelta = comparisonReady ? recentAverage - previousAverage : 0;
    const paceDelta = comparisonReady && previousPace ? (recentPace - previousPace) / previousPace : 0;
    const recentHasDNF = recent.some(book => statusOf(book) === 'DNF');
    const momentumFactor = recentAverage >= overallAverage || (comparisonReady && scoreDelta >= 0) ? 1 : .6;
    const isFastStrong = recentPace >= 1.25 && momentumFactor === 1;
    const isFastWeak = recentPace >= 1.25 && momentumFactor < 1;
    let mode = 'NEUTRAL';
    if (recentHasDNF && recent[0] && statusOf(recent[0]) === 'DNF') mode = 'RESET';
    else if (recentScores.length && recentAverage >= highThreshold && recentPace > 0.0 && recentPace < .75) mode = 'SAVOUR';
    else if (recentScores.length && recentAverage >= highThreshold && isFastStrong) mode = 'FLOW';
    else if (recentAverage < lowThreshold && isFastStrong) mode = 'ESCAPE';
    else if (recentScores.length && recentAverage < lowThreshold && recentPace > 0 && recentPace < .75) mode = 'BURNOUT';
    else if (recentScores.length && recentAverage < lowThreshold && recentPace > 0 && recentPace < .9) mode = 'DANGER';
    else if (recentAverage < lowThreshold && isFastWeak) mode = 'DANGER';
    return { mode, comparisonReady, recentCount: recent.length, previousCount: previous.length, recentAverage, previousAverage, scoreDelta, recentPace, previousPace, paceDelta };
  }
  function excelDateTime(value) {
    const str = text(value);
    if (!str) return '';
    if (/^\d+(\.\d+)?$/.test(str) && Number(str) > 20000 && Number(str) < 90000)
      return new Date(Date.UTC(1899, 11, 30) + Number(str) * 86400000).toISOString().slice(0, -1);
    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? str : parsed.toISOString();
  }
  function applyReadingEvents(previous = {}, next = {}, timestamp = new Date().toISOString()) {
    const book = { ...previous, ...next };
    const day = String(timestamp).slice(0, 10);
    if (!previous.title && book.title && !book.dateBought) book.dateBought = day;
    const reading = statusOf(book) === 'Reading';
    const wasReading = truthy(previous.reading);
    if (reading && !wasReading) { if (!book.dateStarted) book.dateStarted = day; if (!book.detailedStart && book.dateStarted === day) book.detailedStart = timestamp; }
    if (!reading && wasReading && !['Read', 'DNF'].includes(statusOf(book))) { book.dateStarted = ''; book.detailedStart = ''; }
    book.reading = reading ? '1' : '0';
    const readingState = statusOf(book);
    const finished = ['Read', 'DNF'].includes(readingState);
    book.completed = readingState === 'Read' && !!book.dateStarted && !!book.dateFinished ? '1' : '0';
    const wasFinished = truthy(previous.finished);
    if (finished && (!wasFinished || !book.dateFinished)) { if (!book.dateFinished) book.dateFinished = day; if (!book.detailedFinish && book.dateFinished === day) book.detailedFinish = timestamp; }
    if (!finished && wasFinished) { book.dateFinished = ''; book.detailedFinish = ''; }
    book.finished = finished ? '1' : '0';
    return book;
  }
  function numeric(value) { const n = Number(String(value ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; }
  function recommendationLabel(book) {
    const volume = text(book?.volumes);
    if (!volume) return text(book?.title) || 'Untitled book';
    return `${text(book?.title) || 'Untitled book'} · ${/^standalone$/i.test(volume) ? 'Standalone' : volume}`;
  }
  function recommendationSeries(book) { return text(book?.series || book?.title).toLowerCase(); }
  function recommendationVolume(book) {
    const volume = text(book?.volumes);
    if (/^standalone$/i.test(volume)) return { standalone: true, number: -1 };
    const match = volume.match(/(?:vol(?:ume)?\.?\s*)?(\d+(?:\.\d+)?)/i);
    return { standalone: false, number: match ? Number(match[1]) : -1 };
  }
  function recommendationPages(book) { return numeric(book?.count || book?.pageCount); }
  function recommendationRating(book) { return numeric(book?.goodreads); }
  function percentile(values, p) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return Infinity;
    const position = (sorted.length - 1) * p, low = Math.floor(position), high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
  }
  function recommendationHistory(books) {
    return books.filter(book => text(book.dateFinished)).slice().sort((a, b) => {
      const rankA = numeric(a.finishRank), rankB = numeric(b.finishRank);
      if (rankA && rankB && rankA !== rankB) return rankA - rankB;
      return text(b.dateFinished).localeCompare(text(a.dateFinished));
    });
  }
  function eligible(book, history, mode, role) {
    const unavailable = ['Sold', 'Unhauled', 'Loaned Out'].includes(collectionStatusOf(book)) || ['Blocked','DNF'].includes(statusOf(book));
    const priorDecline = (history || []).some(x => !x.restored && x.bookId === book.id && x.mode === mode && x.role === role && (x.action || 'Declined') === 'Declined');
    // The workbook uses an empty finish date as the recommendation gate. A current
    // reading record can therefore be suggested as the next volume to continue.
    return !text(book?.dateFinished) && !unavailable && !priorDecline;
  }
  function recommendationContext(books) {
    const finished = recommendationHistory(books);
    const last = finished[0] || null;
    const pages = finished.map(recommendationPages).filter(Boolean);
    const ratings = finished.map(recommendationRating).filter(v => v > 0);
    const avgGoodreads = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 4.1;
    const genres = finished.map(b => text(b.genre)).filter(Boolean);
    const recentGenres = genres.slice(0, 5).map(g => g.toLowerCase());
    const lastVolume = last ? recommendationVolume(last) : { standalone: true, number: -1 };
    const lastSeries = last ? recommendationSeries(last) : '';
    const nextSeriesVolume = last && !lastVolume.standalone
      ? Math.min(...books.filter(b => !text(b.dateFinished) && recommendationSeries(b) === lastSeries && !['Sold', 'Unhauled', 'Loaned Out'].includes(collectionStatusOf(b)) && !['Blocked','DNF'].includes(statusOf(b)))
          .map(b => recommendationVolume(b).number).filter(n => n > lastVolume.number), Infinity)
      : Infinity;
    const genreScores = {};
    for (const book of finished) {
      const genre = text(book.genre).toLowerCase(), score = numeric(book.score);
      if (!genre || !score) continue;
      genreScores[genre] ||= { total: 0, count: 0 };
      genreScores[genre].total += score; genreScores[genre].count++;
    }
    return {
      finished, last, lastGenre: text(last?.genre).toLowerCase(), lastSeries, lastVolume,
      nextSeriesVolume, finishedCount: finished.length, pageThresholds: {
        0.3: percentile(pages, 0.3), 0.4: percentile(pages, 0.4), 0.6: percentile(pages, 0.6)
      }, avgGoodreads, recentGenres, genreScores
    };
  }
  function workbookBaseCandidates(books, history, mode, role) {
    return books.filter(book => eligible(book, history, mode, role));
  }
  function seriesGate(book, context, allowNext = false) {
    const volume = recommendationVolume(book);
    return volume.standalone || volume.number === 1 || (allowNext && recommendationSeries(book) === context.lastSeries && volume.number === context.nextSeriesVolume);
  }
  function stableRotation(items, offset) {
    if (items.length < 2) return items.slice();
    const start = ((offset % items.length) + items.length) % items.length;
    return items.slice(start).concat(items.slice(0, start));
  }
  function workbookModePool(books, history, mode, context, role = 'PRIMARY') {
    const base = workbookBaseCandidates(books, history, mode, role);
    const byOrder = new Map(books.map((book, index) => [book.id, index]));
    const sorted = (items, score) => items.map(book => ({ book, score: score(book), order: byOrder.get(book.id) ?? 0 }))
      .sort((a, b) => b.score - a.score || a.order - b.order);
    const genre = book => text(book.genre).toLowerCase();
    const volume = book => recommendationVolume(book);
    const group = (items, reason) => ({ items, reason });
    let picked;
    switch (mode) {
      case 'FLOW': {
        const next = !context.lastVolume.standalone && Number.isFinite(context.nextSeriesVolume)
          ? base.filter(b => recommendationSeries(b) === context.lastSeries && volume(b).number === context.nextSeriesVolume) : [];
        const sameGenreStandalone = base.filter(b => genre(b) === context.lastGenre && volume(b).standalone);
        const sameGenre = base.filter(b => genre(b) === context.lastGenre);
        picked = next.length ? group(sorted(next, recommendationRating), 'Continues the series you most recently finished.')
          : sameGenreStandalone.length ? group(sorted(sameGenreStandalone, recommendationRating), 'Returns to your most recently read genre with a standalone book.')
          : sameGenre.length ? group(sorted(sameGenre, recommendationRating), 'Stays with your most recently read genre.')
          : group(sorted(base, recommendationRating), 'The recent reading history has no matching genre or series, so this uses the best available rating match.');
        break;
      }
      case 'SAVOUR': {
        const next = Number.isFinite(context.nextSeriesVolume)
          ? base.filter(b => recommendationSeries(b) === context.lastSeries && volume(b).number === context.nextSeriesVolume) : [];
        const sameGenreStandalone = base.filter(b => genre(b) === context.lastGenre && volume(b).standalone);
        const sameGenre = base.filter(b => genre(b) === context.lastGenre);
        picked = next.length ? group(sorted(next, recommendationRating), 'Keeps your current series going, with Goodreads rating used to order the next volumes.')
          : sameGenreStandalone.length ? group(sorted(sameGenreStandalone, recommendationRating), 'Chooses a standalone in your recent genre.')
          : sameGenre.length ? group(sorted(sameGenre, recommendationRating), 'Chooses from your recent genre.')
          : group(sorted(base, recommendationRating), 'No recent-genre match was available, so this uses the highest-rated available books.');
        break;
      }
      case 'NEUTRAL': {
        const pool = base.filter(b => seriesGate(b, context, true));
        picked = group(stableRotation(pool, context.finishedCount).map((book, order) => ({ book, score: 0, order })), 'Cycles through standalone books, first volumes, and the next volume in a series.');
        break;
      }
      case 'ESCAPE': {
        const pool = base.filter(b => seriesGate(b, context, false) && genre(b) !== context.lastGenre && recommendationPages(b) <= context.pageThresholds[0.4]);
        picked = group(sorted(pool, recommendationRating), 'Switches away from your recent genre and favors a shorter book (at or below your 40th-percentile reading length).');
        break;
      }
      case 'DANGER': {
        const pool = base.filter(b => seriesGate(b, context, true) && !context.recentGenres.includes(genre(b)) && recommendationPages(b) <= context.pageThresholds[0.4]);
        const topFive = sorted(pool, recommendationRating).slice(0, 5);
        picked = group(stableRotation(topFive, context.finishedCount).map((item, order) => ({ ...item, order })), 'Looks beyond your five most recent genres, favors a shorter book, and cycles through the five highest Goodreads matches.');
        break;
      }
      case 'BURNOUT': {
        const danger = workbookModePool(books, history, 'DANGER', context, role).items[0]?.book;
        const avgGR = context.avgGoodreads;
        const pool = base.filter(b => seriesGate(b, context, false) && genre(b) !== context.lastGenre && recommendationPages(b) <= context.pageThresholds[0.3] && recommendationRating(b) >= avgGR - 0.2 && recommendationSeries(b) !== recommendationSeries(danger || {}));
        const score = b => (recommendationRating(b) >= avgGR ? 2 : 0) + (!context.recentGenres.includes(genre(b)) ? 1 : 0);
        picked = group(sorted(pool, score), 'Favors a short, well-rated book in a genre you have not read recently; avoids the current Danger pick.');
        break;
      }
      case 'RESET': {
        const danger = workbookModePool(books, history, 'DANGER', context, role).items[0]?.book;
        const burnout = workbookModePool(books, history, 'BURNOUT', context, role).items[0]?.book;
        const pool = base.filter(b => seriesGate(b, context, false) && genre(b) !== context.lastGenre && recommendationSeries(b) !== context.lastSeries && recommendationPages(b) <= context.pageThresholds[0.6] && recommendationRating(b) >= context.avgGoodreads && recommendationSeries(b) !== recommendationSeries(danger || {}) && recommendationSeries(b) !== recommendationSeries(burnout || {}));
        const score = b => {
          const genreScore = context.genreScores[genre(b)];
          return recommendationRating(b) + (genreScore ? genreScore.total / genreScore.count : 0);
        };
        picked = group(sorted(pool, score), 'Changes both genre and series, stays within your 60th-percentile page length, and favors above-average Goodreads ratings.');
        break;
      }
      default:
        picked = group(sorted(base, recommendationRating), 'Uses the highest Goodreads rating among available books.');
    }
    return picked;
  }
  function recommendationRoleBoost(book, books, role) {
    const genre = text(book.genre).toLowerCase();
    const finishedGenres = new Set(recommendationHistory(books).map(b => text(b.genre).toLowerCase()).filter(Boolean));
    if (role === 'EXPLORER') return genre && !finishedGenres.has(genre) ? 1 : 0;
    if (role === 'WILDCARD') return (parseInt(hash(book.id || book.title).slice(0, 2), 16) % 10) / 100;
    if (role === 'LOW-RESISTANCE') return recommendationPages(book) > 0 && recommendationPages(book) <= 300 ? 1 : 0;
    return 0;
  }
  function recommendationScore(book, books, mode, role) {
    const context = recommendationContext(books);
    const entry = workbookModePool(books, [], mode, context, role).items.find(item => item.book.id === book.id);
    return (entry?.score || 0) + recommendationRoleBoost(book, books, role);
  }
  function recommendationReason(book, mode, role, context, workbookReason) {
    let reason = workbookReason;
    const genre = text(book.genre).toLowerCase();
    if (role === 'EXPLORER' && genre && !context.finished.some(b => text(b.genre).toLowerCase() === genre)) reason += ' This also introduces a genre you have not finished yet.';
    else if (role === 'LOW-RESISTANCE' && recommendationPages(book) > 0 && recommendationPages(book) <= 300) reason += ' It also fits the low-resistance page-length preference.';
    else if (role === 'WILDCARD') reason += ' The wildcard role favors a less predictable option within this mode.';
    return reason;
  }
  function candidates(books, history = [], mode = 'NEUTRAL', role = 'PRIMARY') {
    const normalizedMode = MODES.includes(mode) ? mode : 'NEUTRAL';
    const normalizedRole = ROLES.includes(role) ? role : 'PRIMARY';
    const context = recommendationContext(books);
    const pool = workbookModePool(books, history, normalizedMode, context, normalizedRole);
    const ranked = pool.items.map((item, index) => ({
      book: item.book,
      score: item.score,
      roleBoost: recommendationRoleBoost(item.book, books, normalizedRole),
      reason: recommendationReason(item.book, normalizedMode, normalizedRole, context, pool.reason),
      label: recommendationLabel(item.book),
      workbookScore: item.score,
      order: index
    }));
    if (normalizedRole !== 'PRIMARY') ranked.sort((a, b) => b.roleBoost - a.roleBoost || a.order - b.order);
    return ranked.map(({ roleBoost, order, ...item }) => item);
  }
  function randomDraftPool(books = [], options = {}) {
    const statuses = new Set((options.statuses || ['On Hold']).map(value => String(value).toLowerCase()));
    const genre = text(options.genre).toLowerCase();
    const excluded = new Set((options.excludeIds || []).map(String));
    const band = options.pageBand || 'Any length';
    return (books || []).filter(book => {
      if (!statuses.has(statusOf(book).toLowerCase())) return false;
      if (['Sold', 'Unhauled', 'Loaned Out'].includes(collectionStatusOf(book)) || ['Blocked','DNF'].includes(statusOf(book))) return false;
      if (excluded.has(String(book.id))) return false;
      if (genre && text(book.genre).toLowerCase() !== genre) return false;
      const volume = recommendationVolume(book);
      if (!volume.standalone && volume.number > 1) {
        const previousVolumeRead = (books || []).some(previous =>
          (recommendationSeries(previous) === recommendationSeries(book) ||
            (text(previous.title).toLowerCase() === text(book.title).toLowerCase() &&
              text(previous.author).toLowerCase() === text(book.author).toLowerCase())) &&
          recommendationVolume(previous).number === volume.number - 1 &&
          isComplete(previous)
        );
        if (!previousVolumeRead) return false;
      }
      const pages = numeric(book.count || book.pageCount);
      if (band === 'Under 300 pages' && (!pages || pages >= 300)) return false;
      if (band === '300–499 pages' && (pages < 300 || pages >= 500)) return false;
      if (band === '500–699 pages' && (pages < 500 || pages >= 700)) return false;
      if (band === '700+ pages' && pages < 700) return false;
      return true;
    });
  }
  function randomDraftPick(books = [], options = {}, random = Math.random) {
    const pool = randomDraftPool(books, options);
    if (!pool.length) return null;
    const sample = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    return pool[Math.floor(sample * pool.length)];
  }
  function bestBooks(books = [], mode = 'year', year = new Date().getFullYear(), limit = 10, thresholds = null) {
    const candidates = (books || []).filter(book => {
      const finished = text(book.dateFinished), status = statusOf(book);
      return !!finished && status !== 'DNF' && numeric(book.scoreExact ?? book.score) > 0 &&
        (mode === 'all' || finished.slice(0, 4) === String(year));
    });
    const groups = new Map();
    for (const book of candidates) {
      const key = text(book.series || book.title).toLocaleLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(book);
    }
    const ranked = [];
    for (const rows of groups.values()) {
      const maxScore = Math.max(...rows.map(book => numeric(book.scoreExact ?? book.score)));
      const tied = rows.filter(book => numeric(book.scoreExact ?? book.score) === maxScore);
      tied.sort((a, b) => Number(truthy(b.isFavourite)) - Number(truthy(a.isFavourite)) ||
        text(b.dateFinished).localeCompare(text(a.dateFinished)) || text(a.title).localeCompare(text(b.title)));
      const book = tied[0], volume = text(book.volumes);
      let bookLabel = text(book.title);
      if (/^standalone$/i.test(volume)) bookLabel += ' - STND';
      else if (volume) bookLabel += ` - ${volume}`;
      ranked.push({ bookId: book.id, title: bookLabel, author: book.author || '', genre: book.genre || '', score: maxScore,
        scoreBand: scoreBand(maxScore, candidates.map(item => numeric(item.scoreExact ?? item.score)), thresholds),
        isFavourite: truthy(book.isFavourite), dateFinished: book.dateFinished || '' });
    }
    ranked.sort((a, b) => b.score - a.score || Number(b.isFavourite) - Number(a.isFavourite) ||
      text(a.title).localeCompare(text(b.title)));
    return ranked.slice(0, mode === 'all' ? Math.min(25, limit || 25) : Math.min(10, limit || 10));
  }
  function dashboardData(books = [], recommendationHistory = []) {
    const finished = (books || []).filter(book => isComplete(book) && text(book.dateFinished)).slice().sort((a, b) => {
      const rankA = numeric(a.finishRank), rankB = numeric(b.finishRank);
      if (rankA && rankB && rankA !== rankB) return rankA - rankB;
      return text(b.dateFinished).localeCompare(text(a.dateFinished));
    });
    const scored = finished.map(book => numeric(book.score)).filter(score => score > 0);
    const averageScore = scored.length ? meanValue(scored) : 0;
    const quantile = (values, p) => {
      const sorted = values.slice().sort((a, b) => a - b);
      if (!sorted.length) return 0;
      const pos = (sorted.length - 1) * p, low = Math.floor(pos), high = Math.ceil(pos);
      return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
    };
    const average = values => values.length ? meanValue(values) : 0;
    const byYear = {};
    const genres = new Map();
    const seasons = [[], [], [], []];
    const pageGroups = {'Under 300 pages': [], '300–499 pages': [], '500–699 pages': [], '700+ pages': []};
    const ratings = [], goodreads = [], durations = [], weekend = [];
    let pagesRead = 0;
    for (const book of books || []) {
      const genre = text(book.genre);
      if (genre) {
        const row = genres.get(genre) || { genre, books: 0, finished: 0, spend: 0, scores: [] };
        row.books++;
        row.spend += numeric(book.cost);
        if (isComplete(book) && text(book.dateFinished)) { row.finished++; if (numeric(book.score)) row.scores.push(numeric(book.score)); }
        genres.set(genre, row);
      }
    }
    finished.forEach(book => {
      const year = text(book.dateFinished).slice(0, 4);
      if (year) byYear[year] = (byYear[year] || 0) + 1;
      const score = numeric(book.score), pages = numeric(book.count || book.pageCount);
      if (score) ratings.push(score);
      if (pages && score) {
        const key = pages < 300 ? 'Under 300 pages' : pages < 500 ? '300–499 pages' : pages < 700 ? '500–699 pages' : '700+ pages';
        pageGroups[key].push(score);
      }
      pagesRead += numeric(book.pagesRead || book.count || book.pageCount);
      const day = Date.parse(text(book.dateFinished) + 'T12:00:00');
      if (Number.isFinite(day)) { const date = new Date(day); seasons[date.getMonth() < 2 || date.getMonth() === 11 ? 0 : date.getMonth() < 5 ? 1 : date.getMonth() < 8 ? 2 : 3].push(score); weekend.push(date.getDay() === 0 || date.getDay() === 6); }
      const duration = numeric(book.daysToFin) || numeric(readingMetrics(book, books).daysToFin);
      if (duration > 0) durations.push(duration);
      if (numeric(book.goodreads)) goodreads.push(numeric(book.goodreads));
    });
    const genreRows = [...genres.values()].map(row => ({...row, averageScore: average(row.scores)})).sort((a, b) => b.books - a.books || a.genre.localeCompare(b.genre));
    const scoredRows = finished.filter(book => numeric(book.goodreads) && numeric(book.score));
    const grValues = scoredRows.map(book => numeric(book.goodreads)), userValues = scoredRows.map(book => numeric(book.score));
    const grLow = quantile(grValues, .4), grHigh = quantile(grValues, .6), userLow = quantile(userValues, .4), userHigh = quantile(userValues, .6);
    const hiddenGems = scoredRows.filter(book => numeric(book.goodreads) <= grLow && numeric(book.score) >= userHigh).length;
    const disappointments = scoredRows.filter(book => numeric(book.goodreads) >= grHigh && numeric(book.score) <= userLow).length;
    const uniqueAuthors = new Set(finished.map(book => text(book.author).toLowerCase()).filter(Boolean)).size;
    const genreBooks = finished.filter(book => text(book.genre));
    const genreCounts = new Map(); genreBooks.forEach(book => genreCounts.set(text(book.genre), (genreCounts.get(text(book.genre)) || 0) + 1));
    const loyalty = genreBooks.length ? Math.max(0, ...genreCounts.values()) / genreBooks.length : 0;
    const authorRatio = finished.filter(book => text(book.author)).length ? uniqueAuthors / finished.filter(book => text(book.author)).length : 0;
    const profile = readingProfile(books);
    const recentScores = ratings.slice(0, 3);
    const scoreDeviation = scored.length > 1 ? Math.sqrt(scored.reduce((sum, value) => sum + (value - averageScore) ** 2, 0) / (scored.length - 1)) : 0;
    const seasonsNames = ['Winter', 'Spring', 'Summer', 'Autumn'];
    const seasonAverages = seasons.map((values, i) => ({season: seasonsNames[i], averageScore: average(values), count: values.filter(Boolean).length})).filter(row => row.count);
    const pageRows = Object.entries(pageGroups).map(([pages, values]) => ({pages, averageScore: average(values), count: values.length})).filter(row => row.count).sort((a, b) => b.averageScore - a.averageScore);
    const publisherCount = new Set(finished.map(book => text(book.publisher).toLowerCase()).filter(Boolean)).size;
    const favorites = finished.filter(book => truthy(book.isFavourite)).length;
    const unreadCount = (books || []).filter(book => statusOf(book) === 'On Hold' && !['Sold', 'Unhauled', 'Loaned Out'].includes(collectionStatusOf(book))).length;
    const startEvents = (recommendationHistory || []).filter(event => !event.restored && event.action === 'Started').length;
    const decisionEvents = (recommendationHistory || []).filter(event => !event.restored && ['Started', 'Declined'].includes(event.action)).length;
    const completedRecommendations = finished.filter(book => truthy(book.recommended)).length;
    const recommendedBooks = (books || []).filter(book => truthy(book.recommended));
    const recommendationAverage = average(finished.filter(book => truthy(book.recommended)).map(book => numeric(book.score)).filter(Boolean));
    const manualAverage = average(finished.filter(book => !truthy(book.recommended)).map(book => numeric(book.score)).filter(Boolean));
    const speedBooks = finished.map(book => numeric(book.daysToFin) || numeric(readingMetrics(book, books).daysToFin)).filter(days => days > 0);
    const engine = engineMode(books);
    const speedTrend = engine.comparisonReady && engine.previousPace ? (engine.recentPace - engine.previousPace) / engine.previousPace : 0;
    const days = Object.values(byYear).reduce((a, b) => a + b, 0);
    const averageDays = durations.length ? average(durations) : 0;
    const bestSeason = seasonAverages.slice().sort((a, b) => b.averageScore - a.averageScore)[0] || null;
    const worstSeason = seasonAverages.slice().sort((a, b) => a.averageScore - b.averageScore)[0] || null;
    const maxGenre = genreRows.filter(row => row.finished && row.averageScore).slice().sort((a, b) => b.averageScore - a.averageScore)[0] || null;
    const minGenre = genreRows.filter(row => row.finished && row.averageScore).slice().sort((a, b) => a.averageScore - b.averageScore)[0] || null;
    return {
      total: (books || []).length, finished, finishedCount: finished.length, scoredCount: scored.length, discoveryCount: scoredRows.length, readingDateCount: weekend.length, readingCount: (books || []).filter(book => statusOf(book) === 'Reading').length, blockedCount: (books || []).filter(book => statusOf(book) === 'Blocked').length,
      unreadCount, pagesRead, averageScore, ratedCount: scored.length, uniqueAuthors, authorRatio, profile, droppedRate: dropRisk(books),
      byYear: Object.entries(byYear).sort((a, b) => a[0].localeCompare(b[0])).map(([year, count]) => ({year, count})),
      genreRows, topGenre: maxGenre, riskiestGenre: minGenre, genreLoyalty: loyalty,
      weekendRate: weekend.length ? weekend.filter(Boolean).length / weekend.length : 0, seasonAverages, bestSeason, worstSeason,
      averageDays, speedTrend, engine, pageRows, pageStamina: pageGroups['500–699 pages'].length && pageGroups['Under 300 pages'].length ? average(pageGroups['500–699 pages']) / average(pageGroups['Under 300 pages']) : null,
      adaptationDifference: (() => { const adapted = scoredRows.filter(book => text(book.adaptations) && text(book.adaptations) !== 'No Other Adaptations').map(book => numeric(book.score)); const original = scoredRows.filter(book => !text(book.adaptations) || text(book.adaptations) === 'No Other Adaptations').map(book => numeric(book.score)); return adapted.length && original.length ? average(adapted) - average(original) : null; })(),
      hiddenGemRate: scoredRows.length ? hiddenGems / scoredRows.length : 0, disappointmentRate: scoredRows.length ? disappointments / scoredRows.length : 0,
      publisherVariety: finished.length ? publisherCount / finished.length : 0, favoriteRate: finished.length ? favorites / finished.length : 0,
      hotStreak: recentScores.length >= 3 && Math.min(...recentScores) >= averageScore ? 1 : recentScores.length >= 3 && average(recentScores) >= averageScore ? .5 : 0,
      coldStreak: recentScores.length >= 3 && Math.max(...recentScores) <= quantile(scored, .3) ? 1 : recentScores.length >= 3 && average(recentScores) < averageScore ? .5 : 0,
      scoreConsistency: averageScore && scored.length >= 3 ? Math.max(0, 1 - scoreDeviation / averageScore) : 0,
      topPageRange: pageRows[0] || null, recommendationTrust: decisionEvents ? startEvents / decisionEvents : null,
      recommendationLift: recommendationAverage && manualAverage ? recommendationAverage - manualAverage : null,
      recommendationCompletionRate: recommendedBooks.length ? completedRecommendations / recommendedBooks.length : null,
      achievement: finished.length >= 100 ? '📚 Bibliophile' : finished.length >= 50 ? '📗 Bookworm' : finished.length >= 25 ? '📖 Well-Read' : finished.length >= 10 ? '🌱 Page Turner' : '✨ Story Seeker',
      bestSeason, worstSeason, pageGroups
    };
  }
  function meanValue(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

  function parseCSV(source) {
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) { if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && source[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift().map(x => x.replace(/^\uFEFF/, '').trim());
    return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  }
  function importBookPatch(item) {
    const patch = { ...item };
    for (const [key, value] of Object.entries(item || {})) {
      const mapped = HEADER_MAP[normKey(key)];
      if (mapped && !(mapped in patch)) patch[mapped] = value;
    }
    return patch;
  }
  function importBookMatch(existing, item) {
    const patch = importBookPatch(item);
    const id = text(patch.id || patch.workbookId);
    const exact = id && existing.find(book => text(book.id) === id || text(book.workbookId) === id);
    if (exact) return exact;
    const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();
    const matches = existing.filter(book => same(book.title, patch.title) && same(book.author, patch.author) &&
      same(book.volumes, patch.volumes));
    if (matches.length > 1) throw new Error(`Ambiguous import match for "${patch.title}" (${patch.volumes || 'no volume'}). Use saved book IDs to identify the correct record.`);
    return matches[0] || null;
  }
  function mergeBooks(existing, incoming) {
    // Work on a copy so a later ambiguous match cannot partially change the library.
    const result = (existing || []).map(book => ({ ...book }));
    (incoming || []).forEach((item, i) => {
      const patch = importBookPatch(item);
      const old = importBookMatch(result, patch);
      if ('status' in patch && !('workbookStatus' in patch)) patch.workbookStatus = patch.status;
      const combined = { ...(old || {}), ...patch };
      if (old) combined.id = old.id;
      const legacyStatus = text(patch.workbookStatus || patch.status);
      const collectionStatus = ['Sold','Unhauled','Owned','Borrowed','Loaned Out'].includes(legacyStatus);
      const readingStatus = legacyStatus && !collectionStatus && legacyStatus !== 'Favourite';
      if (!('readingStatus' in patch) && (readingStatus || ['reading','finished','completed'].some(key => key in patch))) {
        combined.readingStatus = statusOf(patch);
      }
      if (!('collectionStatus' in patch) && collectionStatus) {
        combined.collectionStatus = collectionStatusOf(patch);
      }
      if ('score' in patch && !('scoreExact' in patch)) combined.scoreExact = patch.score;
      const book = normalizeBook(combined, i);
      if (old) result[result.indexOf(old)] = book;
      else {
        while (result.some(row => row.id === book.id)) book.id += '-new';
        result.push(book);
      }
    });
    return result;
  }
  function readingProfile(books = []) {
    const finished = (books || []).filter(isComplete);
    const scores = finished.map(b => numeric(b.score)).filter(v => v > 0).sort((a,b)=>a-b);
    if (!scores.length) return { name: 'No reading profile yet', scores: {}, highRate: 0, lowRate: 0, midRate: 0 };
    const q = p => { const pos = (scores.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos); return scores[lo] + (scores[hi] - scores[lo]) * (pos - lo); };
    const high = scores.filter(x => x >= q(.75)).length, low = scores.filter(x => x <= q(.25)).length;
    const mid = Math.max(0, scores.length - high - low), total = scores.length;
    const highRate = high / total, lowRate = low / total, midRate = mid / total;
    const momentum = finished.map(b => b.momentum || readingMetrics(b, books).momentum);
    const fastRate = momentum.filter(x => x === 'Flew Through').length / finished.length;
    const slowRate = momentum.filter(x => x === 'Took My Time').length / finished.length;
    const values = {
      'Curated Reader': Math.min(1, (highRate/.35)*.7 + ((1-lowRate)/.8)*.3),
      'Exploratory Reader': Math.min(1, (highRate/.35)*.5 + (lowRate/.25)*.5),
      'Momentum Reader': Math.min(1, (fastRate/.4)*.7 + (highRate/.4)*.3),
      'Consistency Seeker': Math.min(1, (midRate/.6)*.6 + ((1-lowRate)/.4)*.4),
      'Taste Developing': Math.min(1, ((Math.max(0,.25-highRate)/.25)*.7) + ((1-lowRate)/.85)*.3)
    };
    const max = Math.max(...Object.values(values));
    const name = Math.abs(max-values['Consistency Seeker']) < .05 ? 'Balanced Reader' : Object.keys(values).find(k=>values[k]===max) || 'Balanced Reader';
    return { name, scores: values, highRate, lowRate, midRate, fastRate, slowRate };
  }
  function dropRisk(books = []) {
    const started = (books || []).filter(b => b.dateStarted || ['Reading','Read','DNF'].includes(statusOf(b))).length;
    const dropped = (books || []).filter(b => statusOf(b) === 'DNF').length;
    return started ? dropped / started : 0;
  }
  function emptyState(seed = []) { return { schemaVersion: 3, books: (seed || []).map(normalizeBook), quotes: [], shopping: [], discounts: [], budget: 0, mode: 'NEUTRAL', recommendationHistory: [], recommendationSnapshots: [], recommendationEvents: [], readingAttempts: [], engineEvaluations: [], draftPickerHistory: [], draftPickerRounds: {}, sourceTables: {} }; }
  function migrateState(value, seed = []) {
    if (Array.isArray(value)) return roundDataNumbers({ ...emptyState(seed), books: value.map(normalizeBook) });
    if (value && typeof value === 'object') {
      const migrated = { ...emptyState(seed), ...value, books: (Array.isArray(value.books) ? value.books : seed).map(normalizeBook), schemaVersion: 3 };
      for (const key of ['recommendationSnapshots','recommendationEvents','readingAttempts','engineEvaluations','recommendationHistory']) if (!Array.isArray(migrated[key])) migrated[key] = [];
      return roundDataNumbers(migrated);
    }
    return emptyState(seed);
  }
  const api = { STATUSES, MODES, ROLES, READING_BANDWIDTH, normalizeBook, statusOf, collectionStatusOf, isComplete, scoreBand, scoreBandName, weightedScore, readingMetrics, readingProfile, engineMode, dashboardData, randomDraftPool, randomDraftPick, bestBooks, roundDataNumbers, applyReadingEvents, excelDateTime, dropRisk, eligible, candidates, recommendationScore, recommendationLabel, parseCSV, importBookMatch, mergeBooks, emptyState, migrateState, numeric, excelDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovelTrackerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
