(function(root){
 'use strict';
 const E=root.NovelTrackerEngine,L=root.NovelTrackerRecommendationLifecycle;
 const names={PRIMARY:'Your next read',SAFE:'A dependable choice',CONTINUATION:'Continue a series',EXPLORER:'Try something different',WILDCARD:'A calculated chance','LOW-RESISTANCE':'An easier next step'};
 const intents={PRIMARY:'The strongest overall fit for you now.',SAFE:'Quality backed by comparatively stronger evidence.',CONTINUATION:'Return to an established series.',EXPLORER:'Expand beyond your recent reading patterns.',WILDCARD:'Discovery upside with meaningful uncertainty.','LOW-RESISTANCE':'A strong choice with less reading friction.'};
 const jsarg=value=>esc(JSON.stringify(String(value)));
 const fmt=value=>value==null?'—':Number(value).toFixed(2);
 const clone=value=>JSON.parse(JSON.stringify(value));
 let cache=null;
 function initialize(){
  for(const key of ['recommendationSnapshots','recommendationEvents','readingAttempts','engineEvaluations','recommendationHistory'])if(!Array.isArray(model[key]))model[key]=[];
 }
 function evaluation(){
  initialize();
  const taken=new Set(model.recommendationSnapshots.filter(s=>['Accepted','Started'].includes(L.statusOf(model,s.id))).map(s=>s.bookId));
  const fields=['id','title','series','volumes','engineSeriesKey','dateFinished','dateStarted','scoreExact','score','author','genre','count','pageCount','pageBracket','daysToFin','avgDays','finishRank','sortVolume','momentum','readingBandwidth','pagesRead','readingStatus','collectionStatus','workbookStatus','status','finished','reading',...E.ATTRIBUTES];
  const inputs=model.books.map(book=>Object.fromEntries(fields.map(field=>[field,book[field]]))).map(book=>({...book,title:book.engineSeriesKey||(book.volumes&&!/^standalone$/i.test(book.volumes)?book.series||book.title:book.title),readingStatus:taken.has(book.id)?'Blocked':book.readingStatus}));
  const config=model.engineConfiguration||E.DEFAULT_CONFIGURATION;
  const fingerprint=JSON.stringify([inputs,config,ui.modeOverride?ui.mode:null,model.recommendationHistory.filter(e=>e.action==='Declined'),today()]);
  if(!cache||cache.fingerprint!==fingerprint){
   const value=E.evaluateEngine({books:inputs,configuration:config,mode:ui.modeOverride?ui.mode:null,recommendationHistory:model.recommendationHistory,policy:'desktop',evaluationDate:today()});
   cache={fingerprint,value};
  }
  return cache.value;
 }
 function capture(candidate,role,evaluationRecord){
  const result=evaluation();
  let record=evaluationRecord||model.engineEvaluations.find(row=>row.fingerprint===cache.fingerprint);
  if(!record){record={id:crypto.randomUUID(),fingerprint:cache.fingerprint,date:today(),engineVersion:result.engineVersion,configurationVersion:result.configurationVersion,state:clone(result.state),configuration:clone(model.engineConfiguration||E.DEFAULT_CONFIGURATION)};model.engineEvaluations.push(record);}
  let snapshot=model.recommendationSnapshots.find(s=>s.evaluationId===record.id&&s.bookId===candidate.bookId&&s.role===role);
  if(!snapshot){const book=model.books.find(b=>b.id===candidate.bookId);snapshot=L.snapshotFor(result,candidate,role,{id:crypto.randomUUID(),evaluationId:record.id,date:today(),timestamp:new Date().toISOString(),book});model.recommendationSnapshots.push(snapshot);}
  return snapshot;
 }
 function captureAlternatives(role){const slot=evaluation().portfolio.find(s=>s.role===role);if(!slot)return;const count=model.recommendationSnapshots.length;for(const candidate of slot.alternatives.filter(c=>c.bookId!==slot.candidate?.bookId).slice(0,5))capture(candidate,role);if(model.recommendationSnapshots.length!==count)persist(false);}
 function presentation(){
  const result=evaluation(),before=model.recommendationSnapshots.length;
  for(const slot of result.portfolio)if(slot.candidate)capture(slot.candidate,slot.role);
  if(model.recommendationSnapshots.length!==before)persist(false);
  return result;
 }
 function dispatch(snapshotId,action,extra={}){
  try{const next=L.applyCommand(model,{snapshotId,action,commandId:crypto.randomUUID(),date:today(),timestamp:new Date().toISOString(),...extra});Object.assign(model,next);persist(false);render();return true;}
  catch(error){toast(error.message,'error');return false;}
 }
 function choose(snapshotId){if(dispatch(snapshotId,'Accept'))toast('Chosen for later. Reading has not started.');}
 function start(snapshotId){
  const snapshot=model.recommendationSnapshots.find(s=>s.id===snapshotId);if(!snapshot)return;
  startBook(snapshot.bookId,true);ui.startRecommendationSnapshotId=snapshot.id;
 }
 function startCandidate(bookId,role){const candidate=evaluation().candidateEvaluations.find(c=>c.bookId===bookId);if(!candidate?.roles[role]?.qualifies)return toast('This book no longer qualifies. Recalculate your recommendations.','error');const snapshot=capture(candidate,role);persist(false);start(snapshot.id);}
 function chooseCandidate(bookId,role){const candidate=evaluation().candidateEvaluations.find(c=>c.bookId===bookId);if(!candidate?.roles[role]?.qualifies)return toast('This book no longer qualifies. Recalculate your recommendations.','error');choose(capture(candidate,role).id);}
 function decline(snapshotId){if(dispatch(snapshotId,'Decline'))toast('Dismissed for this role and mode.','success',()=>dispatch(snapshotId,'Restore'));}
 function restore(snapshotId){dispatch(snapshotId,'Restore');}
 function unchoose(snapshotId){dispatch(snapshotId,'Unchoose');}
 function drop(snapshotId){if(dispatch(snapshotId,'Drop'))toast('Reading attempt marked as dropped.');}
 function recalculate(){cache=null;render();toast('Recommendations recalculated from your current history.');}
 function reconcile(){
  initialize();
  for(const book of model.books.slice()){
   if(['Reading','Read','DNF'].includes(book.readingStatus)&&!book.readingAttemptId){
    const accepted=model.recommendationSnapshots.filter(s=>s.bookId===book.id&&L.statusOf(model,s.id)==='Accepted');
    if(accepted.length===1&&L.validDate(book.dateStarted)){Object.assign(model,L.applyCommand(model,{snapshotId:accepted[0].id,action:'Start',reconcile:true,bandwidth:book.readingBandwidth,commandId:crypto.randomUUID(),date:book.dateStarted,timestamp:new Date().toISOString()}));const linked=model.books.find(row=>row.id===book.id);model.books=model.books.map(row=>row.id===book.id?{...book,readingAttemptId:linked.readingAttemptId,recommended:'1'}:row);}
   }
   if(model.books.find(row=>row.id===book.id)?.readingAttemptId)Object.assign(model,L.reconcileBook(model,book.id,{commandId:crypto.randomUUID(),date:today(),timestamp:new Date().toISOString()}));
  }
 }
 function evidenceLabel(value){return value>=.6?'Strong':value>=.3?'Moderate':'Limited';}
 function reasons(c){
  const labels={genre:'genre history',author:'author history',series:'series history',attributes:'category fit',goodreads:'your relationship with Goodreads',length:'length preference',recentTaste:'recent taste'};
  const signals=c.contributions.filter(row=>Math.abs(row.adjustment)>.0005).sort((a,b)=>Math.abs(b.adjustment)-Math.abs(a.adjustment)).slice(0,2);
  return signals.length?signals.map(row=>`Your ${labels[row.channel]} ${row.adjustment>0?'raises':'lowers'} the estimate by ${Math.abs(row.adjustment).toFixed(3)} rating points.`).join(' '):'The estimate stays close to your personal reading baseline; individual evidence signals are limited.';
 }
 function explanation(c,role){
  return `<details class="engine-explanation"><summary>Why this book?</summary><p>${esc(intents[role])}</p><p>Personal baseline ${fmt(evaluation().state.baseline)} / 5. Evidence: ${esc(evidenceLabel(c.confidence))}. Confidence measures evidence strength, not a probability.</p><table><caption>Contributions to the predicted personal rating</caption><thead><tr><th>Evidence</th><th>Rating adjustment</th></tr></thead><tbody>${c.contributions.map(row=>`<tr><td>${esc(row.channel==='recentTaste'?'Recent taste':row.channel)}</td><td>${row.adjustment>=0?'+':''}${row.adjustment.toFixed(3)}</td></tr>`).join('')}</tbody></table><p>Risk ${fmt(c.risk)} · Reward ${fmt(c.reward)} · Current fit ${fmt(c.modeFit)} · Role suitability ${fmt(c.roles[role].score)} · Portfolio priority ${fmt(c.roles[role].priority)}</p><p>Historical evidence: ${c.evidence.genre} genre records, ${c.evidence.author} author records, ${c.evidence.series} series volumes. Categories: ${esc(c.evidence.attributes)}.</p><p>Limited history can make the estimate uncertain. Risk and reward describe different aspects of the choice.</p></details>`;
 }
 function card(slot){
  const c=slot.candidate,role=slot.role;
  if(!c)return `<article class="panel engine-role-empty" data-role="${role}"><div class="eyebrow">${esc(role)}</div><h2>${esc(names[role])}</h2><p>${esc(slot.reason.includes('floor')?'The strongest options are already featured in other roles.':'No book meets this role’s quality and evidence requirements yet.')}</p><small>${esc(intents[role])}</small></article>`;
  const b=model.books.find(book=>book.id===c.bookId)||c.book,s=capture(c,role);
  return `<article class="panel engine-book-card ${role==='PRIMARY'?'engine-primary':''}" data-role="${role}" data-book-id="${esc(b.id)}"><div class="engine-card-heading"><div class="eyebrow">${esc(role)}</div><h2>${esc(names[role])}</h2></div><div class="engine-book-body"><button type="button" class="engine-cover-button" aria-label="View ${esc(b.title)}" onclick="showBook(${jsarg(b.id)})">${cover(b,role==='PRIMARY')}</button><div class="engine-book-copy"><h3>${esc(Core.recommendationLabel(b))}</h3><p class="panel-note">${esc(b.author||'Author not recorded')} · ${esc(b.genre||'Genre not recorded')}${c.book.count!==null?' · '+c.book.count+' pages':''}</p><div class="engine-prediction"><strong>${fmt(c.predictedScore)} <small>/ 5</small></strong><span>Predicted personal rating<br><small>${evidenceLabel(c.confidence)} evidence</small></span></div><p class="engine-reason">${esc(reasons(c))}</p><div class="rec-actions"><button class="primary" onclick="NookRecommendations.choose(${jsarg(s.id)})">Choose for later</button><button class="secondary" onclick="NookRecommendations.start(${jsarg(s.id)})">Start now</button><button class="text-button" onclick="NookRecommendations.decline(${jsarg(s.id)})">Not for now</button></div></div></div>${explanation(c,role)}${slot.alternatives.length>1?`<details class="engine-alternatives" ontoggle="if(this.open)NookRecommendations.captureAlternatives('${role}')"><summary>See other qualified options</summary><ul>${slot.alternatives.filter(other=>other.bookId!==b.id).slice(0,5).map(other=>{const book=model.books.find(row=>row.id===other.bookId)||other.book;return `<li><div><b>${esc(Core.recommendationLabel(book))}</b><small>${fmt(other.predictedScore)} / 5 · ${evidenceLabel(other.confidence)} evidence</small></div><button class="secondary" onclick="NookRecommendations.chooseCandidate(${jsarg(book.id)},'${role}')">Choose</button></li>`;}).join('')}</ul></details>`:''}</article>`;
 }
 function decisions(){
  const snapshots=model.recommendationSnapshots,chosen=snapshots.filter(s=>['Accepted','Started'].includes(L.statusOf(model,s.id)));
  const decided=snapshots.filter(s=>L.statusOf(model,s.id)!=='Recommended').slice().sort((a,b)=>{
   const latest=s=>model.recommendationEvents.filter(e=>e.snapshotId===s.id).at(-1)?.timestamp||s.capturedAt;
   return latest(b).localeCompare(latest(a));
  }).slice(0,20);
  const legacy=model.recommendationHistory.filter(e=>!e.snapshotId).slice(-8).reverse();
  const finished=decided.map(s=>L.diagnostics(model,s.id)).filter(d=>d.predictionError!==null);
  return `${chosen.length?`<section class="panel engine-chosen"><h2>Chosen books & reading now</h2><p class="panel-note">Choosing a book keeps it here until you start. It does not add it to your shopping wishlist.</p><ul>${chosen.map(s=>{const status=L.statusOf(model,s.id),exists=model.books.some(b=>b.id===s.bookId);return `<li><div><b>${esc(s.bookTitle)}${s.volume?' · '+esc(s.volume):''}</b><small>${status==='Accepted'?'Chosen for later':'Reading now'} · ${esc(s.role)} · Prediction ${fmt(s.predictedScore)} / 5</small></div><div class="rec-actions">${status==='Accepted'?`${exists?`<button class="primary" onclick="NookRecommendations.start(${jsarg(s.id)})">Start reading</button>`:'<span>Book removed from library</span>'}<button class="text-button" onclick="NookRecommendations.unchoose(${jsarg(s.id)})">Undo choice</button>`:`${exists?`<button class="secondary" onclick="finishBook(${jsarg(s.bookId)})">Finish & rate</button>`:''}<button class="text-button" onclick="NookRecommendations.drop(${jsarg(s.id)})">Drop attempt</button>`}</div></li>`;}).join('')}</ul></section>`:''}<details class="panel engine-history"><summary>Recommendation history <span>${decided.length} recent decisions</span></summary><div class="engine-history-body">${finished.length?`<p>Average absolute prediction error: ${(finished.reduce((sum,d)=>sum+d.absoluteError,0)/finished.length).toFixed(3)} across ${finished.length} rated outcomes in this view.</p>`:''}${decided.length?`<div class="engine-table-scroll"><table><caption>Your recent recommendation decisions and outcomes</caption><thead><tr><th>Book & role</th><th>Status</th><th>Prediction</th><th>Actual</th><th>Outcome</th></tr></thead><tbody>${decided.map(s=>{const d=L.diagnostics(model,s.id),lastEvent=model.recommendationEvents.filter(e=>e.snapshotId===s.id).at(-1);return `<tr><td>${esc(s.bookTitle)}<small>${esc(s.role)} · ${esc(s.mode)} · Recommended ${esc(s.recommendedDate)}</small></td><td>${esc(d.status)}<small>${esc(lastEvent?.date||'')}</small>${d.status==='Declined'?`<button class="text-button" onclick="NookRecommendations.restore(${jsarg(s.id)})">Restore</button>`:''}</td><td>${fmt(s.predictedScore)}</td><td>${fmt(d.actualScore)}</td><td>${d.status==='Finished'&&d.actualScore===null?'Awaiting rating':d.predictionLabel?`${esc(d.predictionLabel)}<small>Error ${d.predictionError>=0?'+':''}${d.predictionError.toFixed(3)} · Lift ${fmt(d.recommendationLift)}</small>`:'—'}${d.daysToStart!==null?`<small>${d.daysToStart} days to start${d.daysToFinish!==null?' · '+d.daysToFinish+' days to finish':''}</small>`:''}</td></tr>`;}).join('')}</tbody></table></div>`:'<p>Your decisions will appear here after you choose or dismiss a recommendation.</p>'}${legacy.length?`<details><summary>Earlier history (legacy)</summary><p>These older records have no saved prediction or recommendation date. They are excluded from prediction accuracy.</p><ul>${legacy.map(e=>`<li>${esc(model.books.find(b=>b.id===e.bookId)?.title||'Book no longer in library')} · ${esc(e.action||'Declined')} · ${esc(e.date||'Date unknown')}</li>`).join('')}</ul></details>`:''}</div></details>`;
 }
 function page(){
  const result=presentation(),state=result.state;ui.mode=state.effectiveMode;
  const featured=result.portfolio[0].candidate,book=featured?model.books.find(b=>b.id===featured.bookId):null;
  return `<div class="content next-read-content engine-page"><section class="next-read-heading"><div><div class="eyebrow">YOUR NEXT CHAPTER</div><h1>A different purpose for every pick.</h1><p>Personal predictions, shaped into six ways to choose your next read.</p></div></section><section class="mode-card next-read-settings engine-state"><div class="next-settings-head"><div><div class="panel-title">Your reading mode · ${esc(state.effectiveMode)} · ${state.modeSource==='preview'?'Preview':'Automatic'}</div><p class="panel-note">${esc(state.explanation)}</p><small>Reader profile: ${esc(state.profile)}</small></div><div class="field"><label for="mode-select">TRY A READING MODE</label><select id="mode-select" onchange="setMode(this.value)">${E.MODES.map(mode=>`<option ${mode===state.effectiveMode?'selected':''}>${mode}</option>`).join('')}</select></div></div>${state.modeSource==='preview'?'<button class="text-button return-automatic-mode" onclick="setAutomaticMode()">Return to automatic mode</button>':''}<details class="mode-help"><summary>How your mode was chosen</summary><p>Automatic mode compares your recent ratings, momentum, genre concentration and bandwidth-adjusted pace. Previewing another mode changes current fit and role selection. Your predicted personal rating stays the same.</p><dl class="engine-pressures">${E.MODES.map(mode=>`<div><dt>${mode}</dt><dd>${fmt(state.pressures[mode])}</dd></div>`).join('')}</dl><p>Pressures are relative scores, not probabilities. Burnout is a reading-friction signal. DANGER favours calculated risk and upside.</p></details><button class="quiet" onclick="NookRecommendations.recalculate()">Recalculate recommendations</button></section>${decisions()}${readingEvidencePanel(book)}${!result.candidateEvaluations.length?'<section class="panel engine-no-pool"><h2>No eligible unread books</h2><p>Check available books and series prerequisites in your library, or add your next book.</p><button class="secondary" onclick="go(\'Library\')">Browse library</button></section>':''}${state.baseline===null?'<section class="panel engine-no-pool"><h2>Your taste history starts with a rating</h2><p>Add a personal score to a book with a finish date to establish your baseline. Predictions are unavailable until then.</p></section>':''}<section class="engine-portfolio" aria-label="Six recommendation roles">${card(result.portfolio[0])}<div class="engine-role-grid">${result.portfolio.slice(1).map(card).join('')}</div></section></div>`;
 }
 root.NookRecommendations=Object.freeze({evaluation,capture,captureAlternatives,presentation,choose,start,startCandidate,chooseCandidate,decline,restore,unchoose,drop,recalculate,reconcile,page,dispatch});
})(typeof globalThis!=='undefined'?globalThis:this);
