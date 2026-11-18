/* Interactive yearbook. Historical predictions remain immutable; choices are separate from ratings. */
(function(root){
  const numeric=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
  const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
  const pages=b=>{const v=Number(String(b.pageCount||b.count||'').replaceAll(',','').match(/\d+(?:\.\d+)?/)?.[0]);return Number.isFinite(v)&&v>0?v:null};
  function collect(state,year,quizSeed=0){
    let randomState=quizSeed>>>0;
    const random=()=>{randomState=(randomState+0x6D2B79F5)|0;let t=Math.imul(randomState^(randomState>>>15),1|randomState);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};
    const shuffle=items=>{const result=items.slice();for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;};
    const appearances=new Map();
    const leastSeen=items=>shuffle(items).sort((a,b)=>(appearances.get(a.id)||0)-(appearances.get(b.id)||0));
    const C=root.NovelTrackerCore,y=String(year),books=(state.books||[]).filter(b=>C.isComplete(b)&&day(b.dateFinished)&&b.dateFinished.startsWith(y+'-')).slice().sort((a,b)=>a.dateFinished.localeCompare(b.dateFinished)||String(a.id).localeCompare(String(b.id))),byId=new Map((state.books||[]).map(b=>[b.id,b]));
    const scored=books.map(b=>({book:b,value:numeric(b.scoreExact)??numeric(b.score)})).filter(x=>x.value!==null&&x.value>0),lengths=books.map(b=>({book:b,value:pages(b)})).filter(x=>x.value!==null),questions=[];
    function question(id,prompt,rows,detail,minimum=false){
      rows=rows.filter(x=>Number.isFinite(x.value));
      if(rows.length<2)return;
      const best=(minimum?Math.min:Math.max)(...rows.map(x=>x.value));
      const answers=rows.filter(x=>x.value===best).map(x=>x.book.id);
      if(answers.length===rows.length)return;
      const winner=leastSeen(rows.filter(x=>answers.includes(x.book.id)).map(x=>x.book))[0];
      const others=leastSeen(rows.filter(x=>!answers.includes(x.book.id)).map(x=>x.book)).slice(0,3);
      const options=shuffle([winner,...others]);
      options.forEach(book=>appearances.set(book.id,(appearances.get(book.id)||0)+1));
      questions.push({id,prompt,answers,options,detail:detail(best,winner)});
    }
    const dateValue=value=>Date.parse(value+'T12:00:00Z');
    const daysBetween=(start,end)=>(dateValue(end)-dateValue(start))/86400000;
    const dated=field=>books.filter(b=>day(b[field])).map(book=>({book,value:dateValue(book[field])}));
    question('rating','Which book did you rate highest?',scored,v=>`Your highest recorded rating was ${v.toFixed(2)} / 5.`);
    question('length','Which was your longest book?',lengths,v=>`Your longest recorded book was ${v.toLocaleString()} pages.`);
    question('first','Which book did you finish first?',dated('dateFinished'),(v,b)=>`Your first finish was recorded on ${b.dateFinished}.`,true);
    question('shortest','Which was your shortest book?',lengths,v=>`Your shortest recorded book was ${v.toLocaleString()} pages.`,true);
    question('last','Which book did you finish most recently that year?',dated('dateFinished'),(v,b)=>`Your latest finish in this year was recorded on ${b.dateFinished}.`);
    const durations=books.filter(b=>day(b.dateStarted)&&b.dateStarted<=b.dateFinished).map(book=>({book,value:daysBetween(book.dateStarted,book.dateFinished)+1}));
    question('fastest','Which book took you the fewest calendar days to finish?',durations,v=>`Your recorded start and finish span ${v.toLocaleString()} calendar ${v===1?'day':'days'}, counting both dates.`,true);
    question('slowest','Which book stayed on your reading journey the longest?',durations,v=>`Your recorded start and finish span ${v.toLocaleString()} calendar days, including any breaks.`);
    question('earliest-start','Which of these books had you started earliest?',dated('dateStarted'),(v,b)=>`You recorded starting this book on ${b.dateStarted}.`,true);
    const waits=books.filter(b=>day(b.dateBought)&&day(b.dateStarted)&&b.dateBought<=b.dateStarted).map(book=>({book,value:daysBetween(book.dateBought,book.dateStarted)}));
    question('shelf-wait','Which book waited longest between purchase and starting?',waits,v=>`There were ${v.toLocaleString()} days between its recorded purchase and start dates.`);
    question('oldest-purchase','Which book had you bought longest ago?',dated('dateBought'),(v,b)=>`Its recorded purchase date was ${b.dateBought}.`,true);
    const costs=books.map(book=>({book,value:numeric(book.cost)})).filter(x=>x.value!==null&&x.value>=0);
    question('cost','Which book had the highest recorded purchase cost?',costs,v=>`Its recorded purchase cost was ${v.toFixed(2)} in your library currency.`);
    function frequency(field,id,prompt,label){
      const counts=new Map();
      books.forEach(b=>{const value=String(b[field]||'').trim();if(value)counts.set(value,(counts.get(value)||0)+1);});
      question(id,prompt,books.filter(b=>String(b[field]||'').trim()).map(book=>({book,value:counts.get(String(book[field]).trim())})),(v,b)=>`${label}: ${String(b[field]).trim()}, with ${v} finished books recorded this year.`);
    }
    frequency('author','author','Which book was by an author you finished most often that year?','One of your most-read authors');
    frequency('genre','genre','Which book belonged to your most-finished recorded genre?','One of your most-read genres');
    const snapshots=new Map((state.recommendationSnapshots||[]).map(s=>[s.id,s])),seen=new Set(),predictions=[];
    for(const attempt of state.readingAttempts||[]){const s=snapshots.get(attempt.snapshotId),actual=numeric(attempt.actualScore),predicted=numeric(s?.predictedScore);if(!s||attempt.status!=='Finished'||s.bookId!==attempt.bookId||!day(attempt.finishedDate)||!attempt.finishedDate.startsWith(y+'-')||!day(attempt.startedDate)||!day(s.recommendedDate)||s.recommendedDate>attempt.startedDate||attempt.startedDate>attempt.finishedDate||actual===null||predicted===null||actual<0||actual>5||predicted<0||predicted>5||seen.has(attempt.id))continue;if(root.NovelTrackerRecommendationLifecycle&&root.NovelTrackerRecommendationLifecycle.statusOf(state,s.id)!=='Finished')continue;seen.add(attempt.id);predictions.push({id:attempt.id,book:byId.get(attempt.bookId)||{id:attempt.bookId,title:s.bookTitle||'Book no longer in library',author:s.author||''},snapshotId:s.id,actual,predicted,error:actual-predicted,date:attempt.finishedDate});}
    predictions.sort((a,b)=>b.date.localeCompare(a.date));
    // Use only immutable predictions made before reading began, as validated above.
    const predictedBooks=predictions.filter(p=>books.some(b=>b.id===p.book.id));
    const outcomes=new Map();
    predictedBooks.forEach(p=>{if(!outcomes.has(p.book.id))outcomes.set(p.book.id,p);});
    const outcomeRows=Array.from(outcomes.values());
    question('surprise','Which book exceeded its pre-reading prediction by the most?',outcomeRows.map(p=>({book:p.book,value:p.error})),(v,b)=>{const p=outcomes.get(b.id);return `Its recorded score was ${p.actual.toFixed(2)} / 5 against a pre-reading prediction of ${p.predicted.toFixed(2)} / 5.`;});
    // A positive surprise needs an outcome above its prediction.
    const surprise=questions.findIndex(q=>q.id==='surprise');
    if(surprise>=0&&!outcomeRows.some(p=>p.error>0))questions.splice(surprise,1);
    question('prediction','Which book came closest to its pre-reading prediction?',outcomeRows.map(p=>({book:p.book,value:Math.abs(p.error)})),(v,b)=>{const p=outcomes.get(b.id);return `Its prediction was ${p.predicted.toFixed(2)} / 5 and its recorded score was ${p.actual.toFixed(2)} / 5, a difference of ${v.toFixed(2)}.`;},true);
    const notes=Object.entries(state.readingLife?.reflections||{}).filter(([date,n])=>day(date)&&date.startsWith(y+'-')&&n&&typeof n==='object'&&(String(n.text||'').trim()||String(n.mood||'').trim())).map(([date,n])=>({date,text:String(n.text||'').slice(0,500),mood:String(n.mood||''),book:byId.get(n.bookId||state.readingLife?.booksByDay?.[date])||null})).sort((a,b)=>a.date.localeCompare(b.date));
    return {year:y,books,questions,predictions,notes};
  }
  const lastMonth=year=>String(year)===String(new Date().getFullYear())?new Date().getMonth()+1:12;
  function session(){const year=String(ui.wrappedYear||new Date().getFullYear());ui.wrappedPlay=ui.wrappedPlay||{};if(!ui.wrappedPlay[year])ui.wrappedPlay[year]={month:lastMonth(year),playing:false,quiz:0,answers:{},note:0,turned:false,revealed:{},round:0,champion:null,animate:''};return ui.wrappedPlay[year];}
  let collectionCache=null;
  const current=()=>{
    const s=session();if(s.quizSeed==null)s.quizSeed=Math.floor(Math.random()*4294967296);
    const year=String(ui.wrappedYear||new Date().getFullYear()),inputs=[model.books,model.readingLife,model.recommendationSnapshots,model.readingAttempts,model.recommendationEvents,year,s.quizSeed];
    if(collectionCache&&inputs.every((value,index)=>value===collectionCache.inputs[index]))return collectionCache.data;
    const data=collect(model,year,s.quizSeed);collectionCache={inputs,data};return data;
  };
  let timer=null;
  function stop(){if(timer!==null){clearInterval(timer);timer=null;}if(typeof ui!=='undefined'&&ui.wrappedPlay)Object.values(ui.wrappedPlay).forEach(s=>s.playing=false);}
  function refresh(){const container=document.querySelector('.wrapped-interactive'),active=document.activeElement,action=active?.dataset?.action,book=active?.dataset?.book,id=active?.id;if(container)renderCards(container);bind();const target=id?document.getElementById(id):action?Array.from(document.querySelectorAll('.wrapped-content [data-action]')).find(el=>el.dataset.action===action&&el.dataset.book===book):null;target?.focus({preventScroll:true});}
  function scrub(value){stop();const s=session();s.month=Math.max(1,Math.min(lastMonth(current().year),Number(value)||1));s.animate='shelf';refresh();s.animate='';}
  function play(){stop();const s=session();s.month=1;s.animate='shelf';const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement?.dataset.motionInput==='keyboard';if(reduced){s.month=lastMonth(current().year);refresh();s.animate='';return;}s.playing=true;refresh();s.animate='';const year=current().year;timer=setInterval(()=>{if(ui.page!=='NookWrapped'||current().year!==year){stop();return;}if(s.month>=lastMonth(year)){stop();refresh();return;}s.month++;s.animate='shelf';refresh();s.animate='';},1400);}
  function answer(id){const d=current(),s=session(),q=d.questions[s.quiz%d.questions.length];if(!q||!q.options.some(b=>b.id===id)||s.answers[q.id])return;s.answers[q.id]=id;s.animate='answer';refresh();s.animate='';}
  function quizMove(delta){const d=current(),s=session();s.quiz=(s.quiz+delta+d.questions.length)%Math.max(1,d.questions.length);s.animate='question';refresh();s.animate='';}
  function quizReplay(){const s=session();s.quiz=0;s.answers={};s.quizSeed=Math.floor(Math.random()*4294967296);refresh();}
  function choose(id){const d=current(),s=session(),candidate=d.books[s.round+1],champion=d.books.find(b=>b.id===s.champion)||d.books[0];if(!candidate||![champion.id,candidate.id].includes(id))return;s.champion=id;s.round++;s.animate='winner';refresh();s.animate='';}
  function restart(){const s=session();s.champion=null;s.round=0;refresh();}
  function saveWinner(){const d=current(),s=session(),book=d.books.find(b=>b.id===s.champion)||(d.books.length===1?d.books[0]:null);if(!book||s.round<d.books.length-1)return;model.wrappedPreferences=model.wrappedPreferences&&typeof model.wrappedPreferences==='object'&&!Array.isArray(model.wrappedPreferences)?model.wrappedPreferences:{};model.wrappedPreferences[d.year]={...(model.wrappedPreferences[d.year]||{}),bookOfYearId:book.id};persist(false);s.animate='winner';refresh();s.animate='';toast('Your personal favourite is saved. Its rating is unchanged.');}
  function noteMove(delta){const d=current(),s=session();s.note=(s.note+delta+d.notes.length)%Math.max(1,d.notes.length);s.turned=false;s.animate='note';refresh();s.animate='';}
  function flip(){const s=session();s.turned=!s.turned;s.animate='paper';refresh();s.animate='';}
  function reveal(id){const s=session();s.revealed=s.revealed||{};s.revealed[id]=!s.revealed[id];s.animate='answer';refresh();s.animate='';}
  function openBook(id){stop();if(model.books.some(b=>b.id===id))showBook(id);}
  function bookButton(book,action,extra=''){return `<button class="wrapped-cover-choice ${extra}" data-action="${action}" data-book="${esc(book.id)}" aria-label="${esc(book.title)}">${cover(book)}<b>${esc(book.title)}</b></button>`;}
  function markup(){
    const d=current(),s=session(),months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],visible=d.books.filter(b=>Number(b.dateFinished.slice(5,7))<=s.month),q=d.questions[s.quiz%d.questions.length],picked=q?s.answers[q.id]:null,right=q&&picked&&q.answers.includes(picked),champion=d.books.find(b=>b.id===s.champion)||d.books[0],challenger=d.books[s.round+1],saved=d.books.find(b=>b.id===model.wrappedPreferences?.[d.year]?.bookOfYearId),prediction=d.predictions.slice().sort((a,b)=>Math.abs(a.error)-Math.abs(b.error))[0],surprise=d.predictions.filter(p=>p.error>0).sort((a,b)=>b.error-a.error)[0],note=d.notes[s.note%d.notes.length],now=new Date(),ongoing=d.year===String(now.getFullYear());
    const heading=(k,title,note)=>`<div class="wi-heading"><div class="eyebrow">${k}</div><h2>${title}</h2><p>${note}</p></div>`;
    const predictionCard=(p,title)=>p?`<div class="wi-prediction ${s.revealed?.[p.id]&&s.animate==='answer'?'wi-paper-turn':''}"><h3>${title}</h3>${bookButton(p.book,'open')}<div class="wi-score-pair"><span>Saved prediction<b>${p.predicted.toFixed(2)}</b></span><span>Your rating<b>${s.revealed?.[p.id]?p.actual.toFixed(2):'?'}</b></span></div><button class="text-button" data-action="reveal" data-book="${esc(p.id)}">${s.revealed?.[p.id]?'Hide rating':'Reveal your rating'}</button>${s.revealed?.[p.id]?`<p>${p.error>0?'+':''}${(Math.round(p.error*100)/100).toFixed(2)} points · finished ${esc(dateLabel(p.date))}</p>`:''}</div>`:'';
    return `<section class="panel panel-pad wi-shelf">${heading('TURN BACK THE PAGES',ongoing?'Your year so far, unfolding':'Your year, unfolding','Move the bookmark through the months to revisit your finished books.')}<div class="wi-shelf-controls"><label for="wrapped-month-slider">Through <b>${months[s.month-1]} ${esc(d.year)}</b></label><div><button class="secondary" data-action="play">Replay year</button>${s.playing?'<button class="secondary" data-action="pause">Pause</button>':''}</div></div><input id="wrapped-month-slider" type="range" min="1" max="${lastMonth(d.year)}" value="${s.month}" aria-label="Books finished through month" aria-valuetext="Through ${months[s.month-1]} ${d.year}"><div class="wi-month-labels" aria-hidden="true"><span>Jan</span><span>${months[Math.floor((lastMonth(d.year)-1)/2)]}</span><span>${months[lastMonth(d.year)-1]}</span></div><div class="wi-unfolding-shelf ${s.animate==='shelf'?'wi-arrive':''}">${visible.length?visible.map(b=>bookButton(b,'open')).join(''):'<p class="wi-empty">No finish dates recorded through this month.</p>'}</div><p class="wi-caption" aria-live="polite">${visible.length} ${visible.length===1?'book':'books'} through ${months[s.month-1]} · click a cover to revisit it.</p></section>
    <div class="wi-pair"><section class="panel panel-pad wi-quiz">${heading('A LITTLE MEMORY TEST','How well do you remember?','A few questions drawn from your recorded reading year.')}${q?`<div class="wi-question"><span class="wi-caption">Question ${s.quiz+1} of ${d.questions.length}</span><h3>${esc(q.prompt)}</h3><div class="wi-quiz-options">${q.options.map(b=>bookButton(b,'answer',picked===b.id?'is-picked':'')).join('')}</div>${picked?`<div class="wi-answer ${s.animate==='answer'?'wi-paper-turn':''}" role="status"><b>${right?'You remembered!':'A little surprise from your shelf.'}</b><p>${esc(q.detail)}</p><p>${q.options.filter(b=>q.answers.includes(b.id)).map(b=>esc(b.title)).join(' · ')}</p></div>`:'<p class="wi-caption">Choose a cover to reveal the answer.</p>'}<div class="wi-actions"><button class="text-button" data-action="quiz-prev">← Previous</button><button class="text-button" data-action="quiz-replay">Play again</button><button class="text-button" data-action="quiz-next">Next →</button></div></div>`:'<p class="wi-empty">A quiz appears when at least two finished books have enough distinct ratings, page counts or finish dates. Tied answers count as correct.</p>'}</section>
    <section class="panel panel-pad wi-favourite">${heading('THE ONE YOU WILL REMEMBER',ongoing?'Your personal favourite so far':'Your personal Book of the Year','Your choice, kept separately from your calculated ratings.')}${saved?`<div class="wi-saved-favourite">✦ Saved favourite: <b>${esc(saved.title)}</b></div>`:''}${champion?challenger?`<p class="wi-caption">Which would you keep? Choice ${s.round+1} of ${d.books.length-1}</p><div class="wi-duel">${bookButton(champion,'choose')}<span aria-hidden="true">or</span>${bookButton(challenger,'choose')}</div><p class="wi-caption">Every finished book gets a turn. Your choice is saved at the end.</p>`:`<div class="wi-chosen ${s.animate==='winner'?'wi-glint':''}">${bookButton(champion,'open')}<p>Your pick: <b>${esc(champion.title)}</b></p><button class="primary" data-action="save-winner">Save my favourite</button></div>`:'<p class="wi-empty">Finish a book this year to choose your personal favourite.</p>'}<button class="text-button" data-action="restart">${saved?'Choose again':'Restart choices'}</button></section></div>
    <div class="wi-pair"><section class="panel panel-pad wi-reality">${heading('THE PLOT TWIST','Prediction versus reality','Only predictions saved before the linked reading attempt began.')}${prediction?`<div class="wi-prediction-grid">${predictionCard(prediction,'Closest prediction')}${surprise&&surprise.id!==prediction.id?predictionCard(surprise,'Biggest pleasant surprise'):''}</div><details><summary>All ${d.predictions.length} recorded ${d.predictions.length===1?'comparison':'comparisons'}</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>Book</th><th>Predicted</th><th>Actual</th><th>Difference</th></tr></thead><tbody>${d.predictions.map(p=>`<tr><td>${esc(p.book.title)}</td><td>${p.predicted.toFixed(2)}</td><td>${p.actual.toFixed(2)}</td><td>${p.error>0?'+':''}${p.error.toFixed(2)}</td></tr>`).join('')}</tbody></table></div></details>`:'<p class="wi-empty">No finished, rated reading attempts with a saved pre-start prediction for this year yet. Future recommendation-linked finishes will appear here; older predictions won’t be reconstructed.</p>'}</section>
    <section class="panel panel-pad wi-words">${heading('IN THE MARGINS','Your year in your own words','Little reflections you saved along the way.')}${note?`<button class="wi-note ${s.animate==='paper'?'wi-paper-turn':''}" data-action="flip" aria-label="${s.turned?'Show reflection':'Turn card to reveal its book and date'}"><span class="wi-caption">${s.turned?'THE BOOK BEHIND THE MOMENT':'A MOMENT YOU KEPT'}</span>${s.turned?`${note.book?cover(note.book):''}<h3>${esc(note.book?.title||'A reading moment')}</h3><p>${esc(dateLabel(note.date))}</p>`:`${note.text?`<blockquote>${esc(note.text)}</blockquote>`:''}${note.mood?`<p>${esc(note.mood)}</p>`:''}`}<span class="wi-caption">${s.turned?'Click to return to your words':'Click to turn the card'}</span></button><div class="wi-actions"><button class="text-button" data-action="note-prev">← Previous</button><span class="wi-caption">${s.note+1} / ${d.notes.length}</span><button class="text-button" data-action="note-next">Next →</button></div>${s.turned&&note.book?`<button class="text-button" data-action="open" data-book="${esc(note.book.id)}">Open book →</button>`:''}`:'<p class="wi-empty">Your dated reading-life reflections will collect here. Save a mood or a note on a reading day to begin your yearbook.</p>'}</section></div>`;
  }
  // Independent stacks let shorter cards pull the following cards up naturally.
  function renderCards(container){
    const content=container.closest('.wrapped-content');
    const monthly=content.querySelector('.wrapped-months')?.closest('.panel');
    const awards=content.querySelector('.award-grid')?.closest('.panel');
    const previousShelf=container.querySelector('.wi-unfolding-shelf');
    const previousBooks=new Map(Array.from(previousShelf?.querySelectorAll('.wrapped-cover-choice')||[],book=>[book.dataset.book,book]));
    if(session().playing&&session().month===1&&session().animate==='shelf')previousBooks.clear();
    container.innerHTML=markup();
    const shelf=container.querySelector('.wi-unfolding-shelf');
    const moving=session().animate==='shelf'&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement?.dataset.motionInput!=='keyboard'&&!document.hidden;
    let arrival=0;
    shelf.querySelectorAll('.wrapped-cover-choice').forEach(book=>{
      const previous=previousBooks.get(book.dataset.book);
      if(previous){book.replaceWith(previous);return;}
      if(!moving||arrival>=8||typeof book.animate!=='function')return;
      book.animate([
        {opacity:0,transform:'translateY(8px) scale(.97)'},
        {opacity:1,transform:'translateY(0) scale(1)'}
      ],{duration:260,delay:Math.min(arrival++*40,120),easing:'cubic-bezier(0.23,1,0.32,1)',fill:'backwards'});
    });
    const effect=session().animate;
    if(effect==='question')root.NookUI?.animateFeedback?.(container.querySelector('.wi-question'));
    if(effect==='note')root.NookUI?.animateFeedback?.(container.querySelector('.wi-note'));
    if(effect==='answer')root.NookUI?.animateFeedback?.(container.querySelector('.wi-answer')||container.querySelector('.wi-score-pair'));
    if(effect==='winner')root.NookUI?.animateFeedback?.(container.querySelector('.wi-chosen')||container.querySelector('.wi-duel'));
    const columns=document.createElement('div');columns.className='wi-card-columns';
    const left=document.createElement('div'),right=document.createElement('div');
    left.className=right.className='wi-card-column';
    for(const card of [container.querySelector('.wi-quiz'),container.querySelector('.wi-reality'),monthly])if(card)left.appendChild(card);
    for(const card of [container.querySelector('.wi-favourite'),container.querySelector('.wi-words'),awards])if(card)right.appendChild(card);
    container.querySelectorAll('.wi-pair').forEach(pair=>pair.remove());
    columns.append(left,right);container.appendChild(columns);
    content.querySelector('.wrapped-columns')?.remove();
  }
  function bind(){const el=document.querySelector('.wrapped-content');if(!el)return;const actions={play,pause:()=>{stop();refresh()},answer,choose,'save-winner':saveWinner,restart,'quiz-prev':()=>quizMove(-1),'quiz-next':()=>quizMove(1),'quiz-replay':quizReplay,'note-prev':()=>noteMove(-1),'note-next':()=>noteMove(1),flip,reveal,open:openBook};el.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>{const action=actions[button.dataset.action];if(action)action(button.dataset.book)});el.querySelector('#wrapped-month-slider')?.addEventListener('change',event=>scrub(event.target.value));}
  function mount(){stop();const content=document.querySelector('.wrapped-content');if(!content||!content.querySelector('.wrapped-metrics'))return;let el=content.querySelector('.wrapped-interactive');if(!el){el=document.createElement('div');el.className='wrapped-interactive';content.querySelector('.wrapped-metrics').after(el);}renderCards(el);bind();const year=String(ui.wrappedYear||new Date().getFullYear());if(year===String(new Date().getFullYear())){const title=content.querySelector('.wrapped-hero h1');if(title)title.textContent=`Your ${year} in stories, so far.`;}}
  if(typeof document!=='undefined')document.addEventListener?.('visibilitychange',()=>{if(document.hidden)stop()});
  root.NookWrapped={collect,mount,stop,session};
})(typeof globalThis!=='undefined'?globalThis:this);
