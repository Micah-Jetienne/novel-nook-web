(function(root){
  'use strict';
  const Engine=root.NovelTrackerEngine || (typeof require==='function'?require('./NovelTrackerEngine.js'):null);
  const clone=value=>JSON.parse(JSON.stringify(value));
  function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
  function eventsFor(state,id){return (state.recommendationEvents||[]).filter(e=>e.snapshotId===id);}
  function statusOf(state,id){
    let status='Recommended';
    const changes={Accepted:'Accepted',Started:'Started',Finished:'Finished',Dropped:'Dropped',Declined:'Declined',Restored:'Recommended',Unchosen:'Recommended',Reopened:'Started',Cancelled:'Recommended'};
    for(const event of eventsFor(state,id))status=event.action==='OutcomeCorrected'?(event.outcome||status):(changes[event.action]||status);
    return status;
  }
  function snapshotFor(evaluation,candidate,role,{id,evaluationId,date,timestamp,book=candidate.book}){
    if(!id||!evaluationId||!validDate(date)||!Engine.ROLES.includes(role)||!candidate.roles[role]?.qualifies)throw new Error('Cannot capture an unqualified recommendation.');
    return clone({id,evaluationId,bookId:book.id,bookTitle:book.title,volume:book.volumes||'',series:book.series||'',author:book.author||'',genre:book.genre||'',role,
      source:'ENGINE_RECOMMENDED',recommendedDate:date,capturedAt:timestamp,engineVersion:evaluation.engineVersion,configurationVersion:evaluation.configurationVersion,
      mode:evaluation.state.effectiveMode,inferredMode:evaluation.state.mode,modeSource:evaluation.state.modeSource,readerProfile:evaluation.state.profile,
      predictedScore:candidate.predictedScore,confidence:candidate.confidence,risk:candidate.risk,reward:candidate.reward,
      stateFit:candidate.modeFit,roleScore:candidate.roles[role].score,portfolioPriority:candidate.roles[role].priority,
      baseline:evaluation.state.baseline,state:evaluation.state,signals:candidate.signals,contributions:candidate.contributions,evidence:candidate.evidence,
      features:candidate.features});
  }
  function applyCommand(state,command){
    const {snapshotId,action,commandId,date,timestamp}=command;
    if(!commandId||!validDate(date)||!timestamp||!Number.isFinite(Date.parse(timestamp)))throw new Error('A command needs an ID and valid dates.');
    if((state.recommendationEvents||[]).some(e=>e.commandId===commandId))return state;
    const snapshot=(state.recommendationSnapshots||[]).find(s=>s.id===snapshotId);
    if(!snapshot)throw new Error('Recommendation no longer exists.');
    const status=statusOf(state,snapshotId),book=(state.books||[]).find(b=>b.id===snapshot.bookId);
    const allowed={Accept:['Recommended'],Start:['Recommended','Accepted'],Decline:['Recommended'],Restore:['Declined'],Unchoose:['Accepted'],Finish:['Started'],Drop:['Started'],CorrectDates:['Started'],CorrectOutcome:['Finished','Dropped'],Reopen:['Finished','Dropped'],Cancel:['Started']};
    if(!allowed[action]?.includes(status))throw new Error(`Cannot ${action.toLowerCase()} a ${status.toLowerCase()} recommendation.`);
    if(['Accept','Start'].includes(action)&&!book)throw new Error('This book is no longer in your library.');
    if(['Accept','Start'].includes(action)&&(['Sold','Unhauled','Loaned Out'].includes(book?.collectionStatus)||['Sold','Unhauled','Wishlist'].includes(book?.workbookStatus)))throw new Error('This book is not currently available.');
    const events=[...(state.recommendationEvents||[])],attempts=(state.readingAttempts||[]).map(a=>({...a})),legacy=[...(state.recommendationHistory||[])];
    let books=(state.books||[]).slice();
    const add=(type,extra={})=>events.push({id:commandId+':'+type,commandId,snapshotId,bookId:snapshot.bookId,action:type,date,timestamp,...extra});
    const active=attempts.find(a=>a.snapshotId===snapshotId&&a.status==='Started');
    const updateBook=patch=>{books=books.map(b=>b.id===snapshot.bookId?{...b,...patch}:b);};
    if(action==='Accept'){
      if(attempts.some(a=>a.bookId===book.id&&a.status==='Started')||['Reading','Read','DNF','Blocked'].includes(book.readingStatus)||book.dateFinished)throw new Error('This book is no longer available to choose.');
      if((state.recommendationSnapshots||[]).some(s=>s.bookId===book.id&&s.id!==snapshotId&&['Accepted','Started'].includes(statusOf(state,s.id))))throw new Error('This book has already been chosen.');
      add('Accepted');
    } else if(action==='Start'){
      if(attempts.some(a=>a.bookId===book.id&&a.status==='Started'))throw new Error('A reading attempt already exists for this book.');
      if(!command.reconcile&&['Reading','Read','DNF','Blocked'].includes(book.readingStatus))throw new Error('This book is no longer available to start.');
      if(book.dateFinished&&!command.reconcile)throw new Error('This book already has a finish date.');
      const conflicting=(state.recommendationSnapshots||[]).some(s=>s.bookId===book.id&&s.id!==snapshotId&&['Accepted','Started'].includes(statusOf(state,s.id)));
      if(conflicting)throw new Error('Another chosen recommendation already tracks this book.');
      const bandwidth=Object.hasOwn(EngineBandwidth,command.bandwidth)?command.bandwidth:'Normal';
      if(status==='Recommended')add('Accepted');
      const attemptId=commandId+':attempt';
      attempts.push({id:attemptId,bookId:book.id,snapshotId,status:'Started',startedDate:date,finishedDate:null,actualScore:null,bandwidth});
      add('Started',{attemptId,bandwidth});
      updateBook({readingStatus:'Reading',workbookStatus:'Reading',status:'Reading',reading:'1',finished:'0',completed:'0',dateStarted:date,detailedStart:book.detailedStart||timestamp,dateFinished:'',readingBandwidth:bandwidth,recommended:'1',readingAttemptId:attemptId});
      legacy.push({id:commandId+':legacy-start',snapshotId,bookId:book.id,mode:snapshot.mode,role:snapshot.role,action:'Started',date,readingBandwidth:bandwidth});
    } else if(action==='Finish'||action==='Drop'){
      if(!active)throw new Error('No active attempt is linked to this recommendation.');
      if(date<active.startedDate)throw new Error('Finish date cannot be before the start date.');
      const finish=action==='Finish',actualScore=finish?(Engine.optionalNumber(command.actualScore)):null;
      if(actualScore!==null&&(actualScore<0||actualScore>5))throw new Error('Personal score must be between zero and five.');
      active.status=finish?'Finished':'Dropped';active.finishedDate=date;active.actualScore=actualScore;
      add(active.status,{attemptId:active.id,actualScore});
      updateBook({readingStatus:finish?'Read':'DNF',workbookStatus:finish?'Read!':'DNF',status:finish?'Read!':'DNF',reading:'0',finished:'1',completed:finish?'1':'0',dateFinished:date,detailedFinish:book?.detailedFinish||timestamp});
    } else if(action==='CorrectDates'){
      if(!active||!validDate(command.startedDate))throw new Error('A valid corrected start date is required.');
      active.startedDate=command.startedDate;add('DatesCorrected',{attemptId:active.id,startedDate:command.startedDate});updateBook({dateStarted:command.startedDate});
    } else if(action==='CorrectOutcome'){
      const attempt=attempts.find(a=>a.snapshotId===snapshotId&&['Finished','Dropped'].includes(a.status));
      if(!attempt)throw new Error('No completed attempt is linked to this recommendation.');
      const startedDate=command.startedDate||attempt.startedDate;
      if(!validDate(startedDate)||date<startedDate)throw new Error('Finish date cannot be before the start date.');
      attempt.startedDate=startedDate;
      const outcome=command.outcome||status;
      if(!['Finished','Dropped'].includes(outcome))throw new Error('Invalid corrected outcome.');
      const actualScore=outcome==='Finished'?Engine.optionalNumber(command.actualScore):null;
      if(actualScore!==null&&(actualScore<0||actualScore>5))throw new Error('Personal score must be between zero and five.');
      attempt.actualScore=actualScore;attempt.finishedDate=date;attempt.status=outcome;
      add('OutcomeCorrected',{attemptId:attempt.id,actualScore,finishedDate:date,startedDate:attempt.startedDate,outcome});
    } else if(action==='Reopen'){
      const attempt=attempts.find(a=>a.snapshotId===snapshotId);
      if(!attempt)throw new Error('Attempt no longer exists.');
      attempt.status='Started';attempt.finishedDate=null;attempt.actualScore=null;
      add('Reopened',{attemptId:attempt.id});
    } else if(action==='Cancel'){
      if(active)active.status='Cancelled';
      add('Cancelled');
    } else if(action==='Decline'){
      add('Declined');legacy.push({id:commandId+':legacy-decline',snapshotId,bookId:snapshot.bookId,mode:snapshot.mode,role:snapshot.role,action:'Declined',date});
    } else if(action==='Restore'){
      add('Restored');
      for(let i=0;i<legacy.length;i++)if(legacy[i].snapshotId===snapshotId&&legacy[i].action==='Declined')legacy[i]={...legacy[i],restored:true};
    } else if(action==='Unchoose')add('Unchosen');
    return {...state,books,readingAttempts:attempts,recommendationEvents:events,recommendationHistory:legacy};
  }
  const EngineBandwidth={Free:.75,Normal:1,Busy:1.25,Swamped:1.5};
  function reconcileBook(state,bookId,{commandId,date,timestamp}){
    let next=state;
    const book=state.books.find(b=>b.id===bookId);if(!book)return state;
    const attempts=(state.readingAttempts||[]).filter(a=>a.bookId===bookId&&book.readingAttemptId===a.id);
    for(const attempt of attempts){
      const status=statusOf(next,attempt.snapshotId),reading=book.readingStatus;
      const finished=reading==='Read',dropped=reading==='DNF';
      const score=Engine.optionalNumber(book.scoreExact)??Engine.optionalNumber(book.score);
      if(status==='Started'&&validDate(book.dateStarted)&&book.dateStarted!==attempt.startedDate)next=applyCommand(next,{snapshotId:attempt.snapshotId,action:'CorrectDates',commandId:commandId+':dates',date,timestamp,startedDate:book.dateStarted});
      if(status==='Started'&&(finished||dropped)&&validDate(book.dateFinished))next=applyCommand(next,{snapshotId:attempt.snapshotId,action:finished?'Finish':'Drop',commandId,date:book.dateFinished,timestamp,actualScore:score});
      else if(['Finished','Dropped'].includes(status)&&reading==='Reading'&&!book.dateFinished)next=applyCommand(next,{snapshotId:attempt.snapshotId,action:'Reopen',commandId,date,timestamp});
      else if(status==='Started'&& !['Read','DNF','Reading'].includes(reading))next=applyCommand(next,{snapshotId:attempt.snapshotId,action:'Cancel',commandId,date,timestamp});
      else if(['Finished','Dropped'].includes(status)&&(finished||dropped)&&validDate(book.dateFinished)&&(status!==(finished?'Finished':'Dropped')||attempt.actualScore!==(finished?score:null)||attempt.finishedDate!==book.dateFinished||(validDate(book.dateStarted)&&attempt.startedDate!==book.dateStarted)))next=applyCommand(next,{snapshotId:attempt.snapshotId,action:'CorrectOutcome',commandId,date:book.dateFinished,timestamp,actualScore:score,outcome:finished?'Finished':'Dropped',startedDate:validDate(book.dateStarted)?book.dateStarted:attempt.startedDate});
    }
    return next;
  }
  function diagnostics(state,snapshotId){
    const snapshot=state.recommendationSnapshots.find(s=>s.id===snapshotId);if(!snapshot)return null;
    const attempt=(state.readingAttempts||[]).find(a=>a.snapshotId===snapshotId),status=statusOf(state,snapshotId);
    const actual=status==='Finished'?(attempt?.actualScore??null):null,predicted=snapshot.predictedScore;
    const error=actual!==null&&predicted!==null?actual-predicted:null;
    const days=(a,b)=>validDate(a)&&validDate(b)?(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000:null;
    const rounded=x=>Math.round((x+Number.EPSILON)*100);
    return {status,actualScore:actual,predictionError:error,absoluteError:error===null?null:Math.abs(error),recommendationLift:actual===null||snapshot.baseline===null?null:actual-snapshot.baseline,
      predictionLabel:error===null?null:rounded(actual)===rounded(predicted)?'EXACT':actual>predicted?'UNDERPREDICTED':'OVERPREDICTED',
      daysToStart:attempt?days(attempt.startedDate,snapshot.recommendedDate):null,daysToFinish:attempt&&['Finished','Dropped'].includes(status)?days(attempt.finishedDate,attempt.startedDate):null};
  }
  const api=Object.freeze({validDate,statusOf,snapshotFor,applyCommand,reconcileBook,diagnostics});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.NovelTrackerRecommendationLifecycle=api;
})(typeof globalThis!=='undefined'?globalThis:this);
