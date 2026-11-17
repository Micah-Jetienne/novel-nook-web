/* Shared interaction and accessibility foundation for Novel Nook. */
window.NookUI = (() => {
  let modalKey = '', draftBaseline = '', returnFocus = '', sequence = 0;
  let pendingRecovery = null, undoAction = null, confirmation = null;
  let busy = false, saveState = 'Saved on this device';
  const native = () => !!window.__NOVEL_TRACKER_NATIVE__;
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const flag = value => ['1', 'true', 'yes'].includes(String(value ?? '').toLowerCase());
  const stateKey = () => ui.importPreview ? 'import' : ui.finishPromptId ? 'finish:' + ui.finishPromptId : ui.startPromptId ? 'start:' + ui.startPromptId : ui.editing !== null ? 'edit:' + ui.editing : ui.listManager ? 'lists' : ui.settingsOpen ? 'settings' : ui.selected ? 'detail:' + ui.selected.id : '';
  function formValue() {
    const form = document.querySelector('#book-form,#finish-form');
    if (form) return JSON.stringify(Array.from(new FormData(form).entries()).filter(([, value]) => typeof value === 'string'));
    return ui.startPromptId ? String(ui.startBandwidth) : '';
  }
  function isDirty() { return !!modalKey && !!draftBaseline && formValue() !== draftBaseline; }
  function confirmAction({title, message, action = 'Continue', destructive = false, onConfirm, onCancel}) {
    if (confirmation) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'confirmation-dialog';
    dialog.setAttribute('aria-labelledby', 'confirmation-title');
    dialog.setAttribute('role','alertdialog');
    dialog.innerHTML = `<form method="dialog"><div class="modal-head"><h2 id="confirmation-title">${esc(title)}</h2></div><div class="modal-body"><p>${esc(message)}</p></div><div class="modal-foot"><button value="cancel" class="secondary" autofocus>Cancel</button><button value="confirm" class="${destructive ? 'danger' : 'primary'}">${esc(action)}</button></div></form>`;
    document.body.appendChild(dialog);
    confirmation = dialog;
    dialog.addEventListener('close', () => {
      const accepted = dialog.returnValue === 'confirm';
      confirmation = null;
      dialog.remove();
      if (accepted) onConfirm?.(); else onCancel?.();
    }, {once: true});
    dialog.showModal();
  }
  function guardDiscard(proceed) {
    if (!isDirty()) return false;
    confirmAction({title:'Discard unsaved changes?', message:'Your changes have not been saved. Cancel to keep editing, or discard this draft.', action:'Discard changes', destructive:true, onConfirm:() => {draftBaseline='';proceed();}});
    return true;
  }
  function dismissNotification() {
    const toast = document.querySelector('#toast');
    if (toast) { toast.classList.remove('show'); toast.hidden = true; }
  }
  function notify(message, type = 'success', undo = null) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    if (!document.getElementById) {toast.textContent=message;return;}
    clearTimeout(window.toastTimer);
    undoAction = undo;
    toast.hidden = false;
    toast.className = 'toast show notification-' + type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button" onclick="NookUI.undo()">Undo</button>' : ''}<button type="button" class="notification-dismiss" aria-label="Dismiss message" onclick="NookUI.dismissNotification()">×</button>`;
    if (type === 'error') {
      const form = document.querySelector('#book-form,#finish-form');
      if (form) {
        let error = form.querySelector('.form-error');
        if (!error) {error=document.createElement('p');error.className='form-error';error.setAttribute('role','alert');form.querySelector('.modal-body').prepend(error);}
        error.textContent = message;
      }
    }
    if (type !== 'error' && !undo && type !== 'loading') window.toastTimer = setTimeout(dismissNotification, 7000);
  }
  function undo() { const action=undoAction;undoAction=null;dismissNotification();action?.(); }
  function setSaveState(value) { saveState=value;if(!document.querySelectorAll)return;all('[data-save-state]').forEach(el => el.textContent=value); }
  function beforeRender() {
    if (!document.getElementById) return null;
    const active = document.activeElement;
    return {focus:active?.getAttribute('data-focus-key'),selection:active?.selectionStart,selectionEnd:active?.selectionEnd,modal:modalKey,
      page:document.querySelector('main')?.dataset.page,scroll:all('.modal-body,.library-scroll').map(el=>({className:el.className,top:el.scrollTop})),y:window.scrollY};
  }
  function makeLabels(root) {
    all('input:not([type=hidden]):not([type=file]),select,textarea,output',root).forEach((control,index) => {
      if (!control.id) control.id = 'nook-' + (control.closest('form')?.id || 'view') + '-' + (control.name || 'field') + '-' + index;
      if (control.labels?.length || control.hasAttribute('aria-label')) return;
      const field = control.closest('.field,.cover-url-field,.wish-status,.wish-priority-select');
      const label = field && all('label',field).find(el=>el.closest('.field,.cover-url-field,.wish-status,.wish-priority-select')===field&&!el.querySelector('input'));
      if (label && !label.htmlFor) label.htmlFor=control.id;
      else if (!label || label.htmlFor!==control.id) control.setAttribute('aria-label',(control.name||control.id).replace(/^nook-|-/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2'));
    });
    all('.structure-toggle button',root).forEach(button => button.setAttribute('aria-pressed',String(button.classList.contains('active'))));
    all('.filter-tabs button',root).forEach(button => button.setAttribute('aria-pressed',String(button.classList.contains('active'))));
    all('.modal .close',root).forEach(button=>button.setAttribute('aria-label','Close dialog'));
  }
  function focusable(root) { return all('button:not(:disabled),input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',root).filter(el=>el.getClientRects().length && !el.closest('[hidden]')); }
  function setBusy(value, message = 'Working…') {
    busy=value;
    document.documentElement.setAttribute('aria-busy',String(value));
    all('[data-import-action],.side-actions button[onclick="chooseImport()"],.mobile-import').forEach(button => {button.disabled=value;});
    if (value) notify(message,'loading'); else dismissNotification();
  }
  function recoverySnapshot(proceed) {
    if (busy) return;
    if (native()) {
      pendingRecovery=proceed;
      setBusy(true,'Saving a recovery copy before replacing your library…');
      window.webkit.messageHandlers.createRecovery.postMessage(JSON.stringify(model));
    } else {
      try {localStorage.setItem('novel-tracker-recovery-v1',JSON.stringify(model));proceed();}
      catch {notify('A recovery copy could not be saved. Export a full backup and free some browser storage before replacing your library.','error');}
    }
  }
  function receiveRecoverySnapshot(success,message) {
    const action=pendingRecovery;pendingRecovery=null;setBusy(false);
    if (success) action?.(); else notify(message||'Could not save a recovery copy. Your library has not been replaced.','error');
  }
  function recoverLibrary() {
    if (native()) window.webkit.messageHandlers.loadRecovery.postMessage('');
    else {
      try {const saved=localStorage.getItem('novel-tracker-recovery-v1');if(!saved){notify('No recovery copy exists yet. One is created before you restore or replace a library.','error');return;}showRecovery(JSON.parse(saved));}
      catch {notify('The recovery copy could not be opened. Import an exported backup instead.','error');}
    }
  }
  function showRecovery(state) {ui.settingsOpen=false;showImport({...state,name:'Previous library recovery copy',backup:true});}
  function requestImportAction() {
    const intent=ui.importIntent|| (ui.importPreview?.backup?'restore':'merge');
    if (intent==='merge') {applyImport(false);return;}
    const count=ui.importPreview?.books?.length||0;
    confirmAction({title:intent==='restore'?'Restore this full backup?':'Replace your book library?',message:`${intent==='restore'?'All current books, wishlist items, budgets, history and settings':'Your current books and workbook planning data'} will be replaced with the selected file (${count} books). A recovery copy will be saved first.`,action:intent==='restore'?'Restore full backup':'Replace library',destructive:true,onConfirm:()=>recoverySnapshot(()=>applyImport(true))});
  }
  function setImportIntent(value) {ui.importIntent=value;render();}
  function cancelTopModal() {
    if (ui.importPreview) cancelImport(); else if (ui.finishPromptId) cancelFinishBook(); else if (ui.startPromptId) cancelStartBook();
    else if (ui.editing!==null) cancelEdit(); else if (ui.listManager) closeDropdownManager(); else if (ui.settingsOpen) {ui.settingsOpen=false;render();} else if (ui.selected) closeDetail();
  }
  function openSettings() {if(guardDiscard(openSettings))return;ui.editing=null;ui.finishPromptId='';ui.startPromptId='';ui.selected=null;ui.settingsOpen=true;render();}
  function moveNavigation(page,delta) {
    const group=Object.keys(NAV_DEFAULTS).find(key=>NAV_DEFAULTS[key].includes(page));if(!group)return;
    const order=model.sidebarOrder[group]||(model.sidebarOrder[group]=[...NAV_DEFAULTS[group]]),index=order.indexOf(page),next=index+delta;
    if(index<0||next<0||next>=order.length)return;
    [order[index],order[next]]=[order[next],order[index]];persist(false);render();notify(`${NAV_ITEMS[page].label} moved ${delta<0?'up':'down'}`);
  }
  function settingsModal() {
    const links=Object.entries(NAV_ITEMS).map(([key,item])=>`<button class="secondary" onclick="ui.settingsOpen=false;go('${key}')">${esc(item.label)}</button>`).join('');
    return `<div class="overlay" onclick="if(event.target===this)NookUI.cancelTopModal()"><section class="modal settings-modal"><div class="modal-head"><h2 class="modal-title">Settings & shortcuts</h2><button class="close" onclick="NookUI.cancelTopModal()">×</button></div><div class="modal-body"><h3>Go to a screen</h3><div class="settings-links">${links}</div><h3>Library & backups</h3><div class="settings-links"><button class="secondary" onclick="ui.settingsOpen=false;chooseImport()">Import library or backup</button><button class="secondary" onclick="exportJSON()">Export full backup</button><button class="secondary" onclick="exportCSV()">Export books as CSV</button><button class="secondary" onclick="NookUI.recoverLibrary()">Recover previous library</button><button class="secondary" onclick="ui.settingsOpen=false;ui.listManager=true;render()">Manage dropdown lists</button></div><p class="panel-note">A recovery copy is saved on this device before every restore or replacement. Export a full backup to keep a separate copy.</p><h3>Keyboard shortcuts</h3><dl class="shortcut-list"><div><dt>Add book</dt><dd>⌘ / Ctrl + N</dd></div><div><dt>Search library</dt><dd>⌘ / Ctrl + F</dd></div><div><dt>Import library</dt><dd>⌘ / Ctrl + O</dd></div><div><dt>Save book form</dt><dd>⌘ / Ctrl + S</dd></div><div><dt>Zoom on Mac</dt><dd>⌘ + / − · ⌘ 0 resets</dd></div><div><dt>Close dialog</dt><dd>Escape</dd></div><div><dt>Reorder focused sidebar item</dt><dd>Alt + ↑ / ↓</dd></div></dl><details><summary>Arrange sidebar navigation</summary>${Object.entries(NAV_DEFAULTS).map(([group,defaults])=>`<div class="navigation-order">${(model.sidebarOrder[group]||defaults).map((page,index,order)=>`<div><span>${esc(NAV_ITEMS[page].label)}</span><button class="secondary" aria-label="Move ${esc(NAV_ITEMS[page].label)} up" ${index===0?'disabled':''} onclick="NookUI.moveNavigation('${page}',-1)">↑</button><button class="secondary" aria-label="Move ${esc(NAV_ITEMS[page].label)} down" ${index===order.length-1?'disabled':''} onclick="NookUI.moveNavigation('${page}',1)">↓</button></div>`).join('')}</div>`).join('')}</details><p class="panel-note">${native()?'The Mac app saves your library on this Mac.':'This browser stores its own library on this device.'} ${esc(saveState)}.</p></div><div class="modal-foot"><button class="primary" onclick="NookUI.cancelTopModal()">Done</button></div></section></div>`;
  }
  function mobileNavigation() {
    return `<nav class="mobile-bottom-nav" aria-label="Main navigation">${[['Home','home','Overview'],['Library','library','Books'],['ReadingLife','leaf','Reading'],['Planning','tag','Plan']].map(([page,icon,label])=>`<button aria-label="${label}" ${ui.page===page?'aria-current="page"':''} onclick="go('${page}')">${navIcon(icon)}<span>${label}</span></button>`).join('')}<button onclick="NookUI.openSettings()" aria-label="More screens and settings">${navIcon('compass')}<span>More</span></button></nav>`;
  }
  function emptyState(title,message,actions=true) {
    return `<section class="empty onboarding-empty"><h2>${esc(title)}</h2><p>${esc(message)}</p>${actions?'<div class="empty-actions"><button class="primary" onclick="editBook(null)">Add a book</button><button class="secondary" onclick="chooseImport()">Import library</button></div>':''}</section>`;
  }
  function resetPicker(){ui.pickerGenre='';ui.pickerPages='Any length';ui.pickerPaused=true;ui.pickerWishlist=false;ui.pickerRepeat=false;ui.pickerResultId='';render();}
  function clearFilters() {ui.query='';ui.filter='All';ui.collectionFilter='All';ui.genreFilter='All';render();}
  function filterSummary() {
    const values=[ui.filter!=='All'?'Reading: '+ui.filter:'',ui.collectionFilter&&ui.collectionFilter!=='All'?'Collection: '+ui.collectionFilter:'',ui.genreFilter!=='All'?ui.genreFilter:'',ui.query?`Search: ${ui.query}`:''].filter(Boolean);
    return values.length?`<div class="active-filters"><span>${values.map(esc).join(' · ')}</span><button class="text-button" onclick="NookUI.clearFilters()">Clear all filters</button></div>`:'';
  }
  function editorSections(book) {
    const details=formSections[0][1],reading=formSections[1][1],acquisition=formSections[2][1];
    const essential=new Set(['bookType','title','author','genre','series','volumes','pageCount']);
    const fields=items=>items.map(field=>inputField(field,book)).join('');
    return `<p class="form-intro">Start with the essentials. You can add edition, rating and purchase details whenever you like. <strong>Book title is required.</strong></p><div class="form-grid">${fields(details.filter(field=>essential.has(field[0])))}</div><section class="editor-section"><h3>Reading record</h3><div class="form-grid">${fields(reading.filter(field=>['readingSetup','readingProgress','readingChoices','bookNotes'].includes(field[0])))}</div><p class="panel-note">On Hold means unread and in your collection. Blocked means not yet received. DNF means stopped without finishing. Reading status determines completion.</p></section><details class="editor-section" ${scoreCategories.some(key=>book[key]!==''&&book[key]!=null)?'open':''}><summary>Rate your reading experience <span>optional · category scores 0–10</span></summary><div class="form-grid">${fields(reading.filter(field=>scoreCategories.includes(field[0])||field[0]==='scoreGuide'))}</div></details><details class="editor-section"><summary>Cover & edition <span>optional</span></summary><div class="form-grid">${fields(details.filter(field=>!essential.has(field[0])))}</div></details><details class="editor-section"><summary>Collection & purchase <span>optional</span></summary><div class="form-grid">${fields(acquisition)}</div></details>`;
  }
  function clearScore(form){
    scoreCategories.forEach(key=>{const input=form.elements.namedItem(key);if(input)input.value='';});
    const score=form.elements.namedItem('score');if(score)score.value='';
    const clear=form.elements.namedItem('clearScore');if(clear)clear.value='1';
    const output=form.querySelector('#computed-score-output');if(output)output.textContent='Not rated';
    const note=form.querySelector('#score-provenance');if(note)note.textContent='Score will be cleared when you save this book.';
  }
  function validateBookForm(form) {
    if (!form.elements?.namedItem) return true;
    const title=form.elements.namedItem('title'),start=form.elements.namedItem('dateStarted'),finish=form.elements.namedItem('dateFinished'),pages=form.elements.namedItem('pagesRead');
    if(title&&!title.value.trim()){title.setCustomValidity('Enter a book title.');title.reportValidity();notify('Enter a book title before saving.','error');title.focus();return false;}
    title?.setCustomValidity?.('');finish?.setCustomValidity?.('');pages?.setCustomValidity?.('');
    if(start?.value&&finish?.value&&start.value>finish.value){finish.setCustomValidity('Finish date must be on or after the start date.');finish.reportValidity();notify('Check the reading dates: the finish date is before the start date.','error');finish.focus();return false;}
    const total=Core.numeric(form.elements.namedItem('pageCount')?.value);
    if(total&&Core.numeric(pages?.value)>total){pages.setCustomValidity(`Enter no more than ${total} pages, or update the page count.`);pages.reportValidity();notify('Pages read exceeds the book’s page count.','error');pages.focus();return false;}
    return true;
  }
  function table(headers,rows) {return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(value=>`<th scope="col">${esc(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
  function chartData(title) {
    const finished=model.books.filter(Core.isComplete),year=String((ui.page==='NookWrapped'?ui.wrappedYear:ui.monthlyFinishYear||ui.dashboardYear)||new Date().getFullYear());
    if(/month|year in|year on/i.test(title))return table(['Month','Finished books'],Array.from({length:12},(_,index)=>[new Date(2026,index,1).toLocaleString('en-GB',{month:'long'}),finished.filter(book=>String(book.dateFinished||'').startsWith(`${year}-${String(index+1).padStart(2,'0')}`)).length]));
    if(/trend|pace/i.test(title))return '<p>Most recent 25 finished books with recorded dates.</p>'+table(['Book','Finished','Score (0–5)','Days'],finished.filter(book=>book.dateFinished).sort((a,b)=>b.dateFinished.localeCompare(a.dateFinished)).slice(0,25).map(book=>[book.title,dateLabel(book.dateFinished),rated(book)?rated(book).toFixed(2):'Not rated',computedMetrics(book).daysToFin||'Not recorded']));
    if(/country/i.test(title))return table(['Country','Books'],distribution(model.books.filter(book=>Core.collectionStatusOf(book)==='Owned'),'country'));
    if(/age rating/i.test(title)){const groups=distribution(model.books.filter(book=>rated(book)>0),'ageRating');return table(['Age rating','Average score (0–5)'],groups.map(([name])=>[name,mean(model.books.filter(book=>book.ageRating===name&&rated(book)>0).map(rated)).toFixed(2)]));}
    return '';
  }
  function layoutGenreLabels(genres) {
    const plot={left:104,right:896,top:100,bottom:560};
    const wrap=name=>{
      const words=String(name).split(/\s+/),lines=[];let line='';
      for(const word of words){if(line&&(line+' '+word).length>27){lines.push(line);line='';}if(word.length>27){if(line){lines.push(line);line='';}for(let i=0;i<word.length;i+=27)lines.push(word.slice(i,i+27));}else line=line?line+' '+word:word;}
      if(line)lines.push(line);return lines.length?lines:['Genre'];
    };
    const labelArea=genres.reduce((area,genre)=>{const lines=wrap(genre.name);return area+(Math.max(...lines.map(line=>line.length))*9.1+24)*(lines.length*22+10);},0);
    plot.bottom=plot.top+Math.max(460,Math.ceil(labelArea/((plot.right-plot.left)*.4)/28)*28);
    const points=genres.map((genre,index)=>({...genre,index,px:plot.left+genre.x*(plot.right-plot.left),py:plot.bottom-genre.y*(plot.bottom-plot.top)}));
    const used=[],overlap=(a,b,pad=6)=>a.x<b.x+b.width+pad&&a.x+a.width+pad>b.x&&a.y<b.y+b.height+pad&&a.y+a.height+pad>b.y;
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
    for(const point of points.slice().sort((a,b)=>a.py-b.py||a.px-b.px||a.name.localeCompare(b.name))){
      const lines=wrap(point.name),width=Math.max(...lines.map(line=>line.length))*9.1+12,height=lines.length*22;
      const candidates=[];
      for(let offset=0;offset<=440;offset+=28){
        for(const dy of offset?[offset,-offset]:[0]){
          for(const x of [point.px+16,point.px-width-16,point.px+44,point.px-width-44]){
            const box={x:clamp(x,plot.left+12,plot.right-width-12),y:clamp(point.py-height/2+dy,plot.top+10,plot.bottom-height-10),width,height};
            const dx=Math.max(box.x-point.px,0,point.px-box.x-width),distance=Math.hypot(dx,box.y+height/2-point.py);
            candidates.push({...box,distance});
          }
        }
      }
      // Extra lanes keep coincident points and long labels readable without changing their data positions.
      for(let y=plot.top+12;y+height<=plot.bottom-10;y+=28){
        for(const x of [plot.left+12,500-width/2,plot.right-width-12])candidates.push({x,y,width,height,distance:Math.hypot(x+width/2-point.px,y+height/2-point.py)+20});
      }
      const valid=box=>!used.some(other=>overlap(box,other))&&!points.some(other=>overlap(box,{x:other.px-7,y:other.py-7,width:14,height:14},2));
      const box=candidates.sort((a,b)=>a.distance-b.distance).find(valid);
      if(!box)throw new Error('Not enough room for the genre labels.');
      used.push(box);point.label={...box,lines};
    }
    points.plot=plot;return points;
  }
  function genreQuadrant(genres) {
    const points=layoutGenreLabels(genres),plot=points.plot,middle=(plot.top+plot.bottom)/2;
    const labels=points.map(point=>{
      const box=point.label,endX=Math.max(box.x,Math.min(box.x+box.width,point.px)),endY=Math.max(box.y+3,Math.min(box.y+box.height-3,point.py));
      return `<g class="genre-data-point"><title>${esc(point.name)} · ${(point.risk*100).toFixed(1)}% weak scores · reward ${point.reward.toFixed(2)}</title><path class="genre-label-leader" d="M ${point.px.toFixed(1)} ${point.py.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}"/><circle cx="${point.px.toFixed(1)}" cy="${point.py.toFixed(1)}" r="5"/><text class="genre-point-label" x="${box.x.toFixed(1)}" y="${(box.y+17).toFixed(1)}">${box.lines.map((line,index)=>`<tspan x="${box.x.toFixed(1)}" dy="${index?22:0}">${esc(line)}</tspan>`).join('')}</text></g>`;
    }).join('');
    return `<div class="genre-quadrant-scroll" tabindex="0" role="region" aria-label="Risk versus reward chart; scroll horizontally on small windows"><svg class="risk-scatter genre-quadrant" viewBox="0 0 1000 ${plot.bottom+100}" role="img" aria-labelledby="genre-risk-title genre-risk-description"><title id="genre-risk-title">Risk versus reward by genre</title><desc id="genre-risk-description">Genre names label the plotted points directly. Risk increases to the right; reward increases upward. The centre divides risk at 15 percent weak scores and reward at 0.50. Leader lines separate nearby labels; identical values share a point.</desc><rect class="genre-plot-surface" x="104" y="100" width="792" height="${plot.bottom-plot.top}" rx="12"/><text class="genre-quadrant-heading" x="302" y="52" text-anchor="middle">Low risk · high reward</text><text class="genre-quadrant-heading" x="698" y="52" text-anchor="middle">High risk · high reward</text><text class="genre-quadrant-heading" x="302" y="${plot.bottom+43}" text-anchor="middle">Low risk · low reward</text><text class="genre-quadrant-heading" x="698" y="${plot.bottom+43}" text-anchor="middle">High risk · low reward</text><line class="genre-axis" x1="500" y1="100" x2="500" y2="${plot.bottom}"/><line class="genre-axis" x1="104" y1="${middle}" x2="896" y2="${middle}"/>${labels}<text class="genre-axis-label" x="500" y="${plot.bottom+82}" text-anchor="middle">LOWER RISK ← · → HIGHER RISK</text><text class="genre-axis-label" transform="translate(36 ${middle}) rotate(-90)" text-anchor="middle">LOWER REWARD ← · → HIGHER REWARD</text></svg></div><p class="genre-chart-note">The cross marks 15% weak scores and 0.50 reward. Genres with identical values share a point. On smaller windows, scroll within the chart to keep the labels readable.</p><details class="chart-data"><summary>View genre risk and reward data</summary>${table(['Genre','Weak-score share','Weighted reward'],genres.map(genre=>[genre.name,(genre.risk*100).toFixed(1)+'%',genre.reward.toFixed(2)]))}</details>`;
  }
  // Display ownership only: no library, score, recommendation or persistence changes.
  function streamlinePages() {
    const root=document.querySelector('main');if(!root)return;
    const titled=(scope,title)=>all('.panel,.dash-panel',scope).find(el=>el.querySelector('.panel-title')?.textContent===title);
    const home=root.querySelector('.home-content');
    if(home){
      titled(home,'Your shelves, by genre')?.remove();home.querySelector('.home-best-panel')?.remove();home.querySelector('.home-open-book')?.remove();
      const columns=home.querySelector('.home-dashboard-columns');
      if(columns){const cards=all('.home-dashboard-column > *',columns);columns.replaceChildren(...cards);}
    }
    const life=root.querySelector('.reading-life-content');
    if(life){life.querySelector('.life-section-head > span')?.remove();const caption=life.querySelector('.life-kind p');if(caption&&readingLifeData().current)caption.textContent='Keep enjoying your book at your own pace.';}
    const plan=root.querySelector('.planning-content');
    if(plan){plan.querySelector('.shop-annual-summary')?.remove();all('.shop-budget-footer > span',plan).slice(0,2).forEach(el=>el.remove());}
    const wrapped=root.querySelector('.wrapped-content');
    if(wrapped){
      titled(wrapped,'The collection gender gap')?.remove();titled(wrapped,'The authors on your shelves')?.remove();
      all('.wrapped-metrics .metric',wrapped).find(el=>el.textContent.includes('COLLECTION AUTHORS'))?.remove();
      wrapped.querySelector('.wrapped-chat')?.remove();
      const caption=wrapped.querySelector('.shelf-copy p');if(caption)caption.textContent='The stories that made this year yours.';
      const columns=wrapped.querySelector('.wrapped-columns');if(columns)columns.replaceChildren(...all('.wrapped-column > *',columns));
      // A book can win several different awards: retain every category without repeating its title.
      const awards=wrapped.querySelector('.award-grid');if(awards){const groups=new Map();all('button.award-card',awards).forEach(card=>{const key=card.getAttribute('onclick');const previous=groups.get(key);if(!previous){groups.set(key,card);card.classList.add('award-winner');return;}const badge=document.createElement('span');badge.className='award-category';badge.textContent=card.querySelector('span').textContent+' · '+card.querySelector('small').textContent.split(' · ').pop();previous.appendChild(badge);card.remove();});}
    }
  }
  function organizeInsights() {
    const content=document.querySelector('.dashboard-content');if(!content)return;
    if(!model.books.length){const hero=content.querySelector('.dash-hero');content.innerHTML='';if(hero)content.appendChild(hero);content.insertAdjacentHTML('beforeend',emptyState('Your reading insights start here','Add or import your books. Finished books, dates and ratings will turn into useful reading patterns.'));return;}
    const hero=content.querySelector('.dash-hero'),metrics=content.querySelector('.dashboard-metrics');
    content.querySelector('.dash-hero-copy > p').textContent='Explore the patterns behind your reading, ratings and collection.';
    all('.dashboard-metrics .metric',content).filter(el=>/FINISHED STORIES|READING NOW/.test(el.textContent)).forEach(el=>el.remove());
    content.querySelector('.year-overview-panel')?.remove();content.querySelector('.recently-finished-panel')?.remove();content.querySelector('.next-read-card')?.remove();
    const rhythm=content.querySelector('.reading-rhythm-panel');if(rhythm)content.appendChild(rhythm);
    content.querySelector('.dashboard-showcase')?.remove();
    all('.intel-list > *',content).filter(el=>el.textContent.includes('Avg. days per book')).forEach(el=>el.remove());
    all('.intel-list small',content).filter(el=>/books completed$/.test(el.textContent)).forEach(el=>el.textContent='Your reading milestone');
    // Reuse the existing collection calculations and controls, in their new home.
    if((ui.statsGroup||'overview')==='collection'){
      const template=document.createElement('template');template.innerHTML=nookWrappedPage();
      all('.dash-panel',template.content).filter(el=>/^(The collection gender gap|The authors on your shelves)$/.test(el.querySelector('.panel-title')?.textContent||'')).forEach(el=>content.appendChild(el));
      const summary=document.createElement('article');summary.className='panel dash-panel collection-summary';
      const authors=new Set(model.books.map(book=>String(book.author||'').trim()).filter(Boolean)).size;
      summary.innerHTML='<div class="panel-title">Collection at a glance</div><div class="collection-summary-metrics">'+metric('COLLECTION AUTHORS',authors,'distinct author names','✧')+'</div>';if(metrics)summary.querySelector('.collection-summary-metrics').prepend(...metrics.children);content.appendChild(summary);
    }
    // Taste is about rated books; collection size belongs to the shelf report.
    const tasteTitle=all('.panel-title',content).find(el=>el.textContent==='Your taste map');if(tasteTitle){tasteTitle.textContent='Genre rating averages';const note=tasteTitle.parentElement.querySelector('.panel-note');if(note)note.textContent='Your average score by genre · shared 0–5 scale';}
    all('.taste-row',content).forEach(row=>{const score=row.querySelector('.taste-score')?.textContent||'';const value=Number(score.replace(/[^0-9.]/g,''));const bar=row.querySelector('.taste-meter i');if(bar)bar.style.width=(value/5*100)+'%';row.querySelector('.taste-count')?.remove();});
    const panels=all('.dash-panel,.stats-chart-card',content).filter(panel=>!panel.classList.contains('stats-chart-section')&&!panel.closest('.dashboard-showcase'));
    const buckets={overview:[],reading:[],ratings:[],collection:[]};
    panels.forEach(panel=>{
      const title=panel.querySelector('h3,.panel-title')?.textContent||'';
      if(title==='Reading weather')panel.classList.add('reading-weather-card');
      if(panel.querySelector('.stats-chart-card')||/Your year in stories|Score constellation/.test(title))return;
      const group=/genre shelf|country|publisher|collection|spend|authors on your shelves/i.test(title)?'collection':/score|rating|taste|category|risk|discovery|page-length/i.test(title)?'ratings':/year|month|pace|rhythm|season|stamina|weather|reading intelligence/i.test(title)?'reading':'overview';
      const data=chartData(title);panel.setAttribute('role','group');panel.setAttribute('aria-label',title||'Reading insight');
      if(data)panel.insertAdjacentHTML('beforeend',`<details class="chart-data"><summary>View data table</summary>${data}</details>`);
      const summary=(panel.querySelector('.panel-note,p,.chart-empty')?.textContent||title).trim();
      all('svg',panel).forEach(svg=>{svg.setAttribute('role','img');svg.setAttribute('aria-label',`${title}. ${summary}. ${data?'A data table follows.':''}`);});
      buckets[group].push(panel);
    });
    content.innerHTML='';if(hero)content.appendChild(hero);
    const current=ui.statsGroup||'overview';
    content.insertAdjacentHTML('beforeend',`<nav class="insight-tabs" aria-label="Insight categories">${Object.keys(buckets).map(group=>`<button class="${current===group?'primary':'secondary'}" aria-pressed="${current===group}" onclick="ui.statsGroup='${group}';render()">${group[0].toUpperCase()+group.slice(1)}</button>`).join('')}</nav>`);
    const grid=document.createElement('section');grid.className='insight-grid';grid.setAttribute('aria-label',current+' insights');
    
    if(current==='overview')grid.innerHTML='<article class="panel dash-panel insight-directory"><div class="panel-title">Explore your reading</div><p class="panel-note">Choose a view for the details behind your library.</p>'+[['reading','Reading','Pace, monthly finishes and reading patterns'],['ratings','Ratings','Taste, score trends and category comparisons'],['collection','Collection','Genres, authors, countries and collection history']].map(([group,label,note])=>`<button class="insight-directory-link" onclick="ui.statsGroup='${group}';render()"><span><b>${label}</b><small>${note}</small></span><span aria-hidden="true">→</span></button>`).join('')+'</article>';
    const priority=current==='reading'?['Reading rhythm','Monthly finishes','Reading weather','Reading pace','Reading intelligence','How the rhythm feels']:current==='collection'?['Collection at a glance','Genre shelf report','The authors on your shelves','Books owned by country','The collection gender gap']:[];
    buckets[current].sort((a,b)=>{const rank=panel=>{const index=priority.indexOf(panel.querySelector('.panel-title,h3')?.textContent);return index<0?99:index;};return rank(a)-rank(b);}).forEach(panel=>grid.appendChild(panel));
    if(!grid.children.length)grid.innerHTML=emptyState('More insights are on the way','Add reading dates and ratings to your books to build this view.',false);
    content.appendChild(grid);
    // Separate stacks share one top edge; avoid multi-column fragmentation offsets.
    const cards=Array.from(grid.children);
    if(current!=='overview'&&cards.length>1){
      const heights=cards.map(card=>card.getBoundingClientRect().height+16),total=heights.reduce((sum,height)=>sum+height,0);
      let accumulated=0,split=1,best=Infinity;
      heights.slice(0,-1).forEach((height,index)=>{accumulated+=height;const difference=Math.abs(total-2*accumulated);if(difference<best){best=difference;split=index+1;}});
      const columns=[document.createElement('div'),document.createElement('div')];
      columns.forEach(column=>column.className='insight-column');
      cards.forEach((card,index)=>columns[index<split?0:1].appendChild(card));grid.replaceChildren(...columns);grid.classList.add('insight-stacks');
    }
  }
  function enhanceEmptyStates(){
    const picker=document.querySelector('.picker-empty');
    if(picker&&document.querySelector('.draw-button')?.disabled&&!ui.pickerSpinning){picker.insertAdjacentHTML('beforeend',model.books.length?'<div class="empty-actions"><button class="secondary" onclick="NookUI.resetPicker()">Reset picker filters</button><button class="primary" onclick="editBook(null)">Add a book</button></div>':'<div class="empty-actions"><button class="primary" onclick="editBook(null)">Add a book</button><button class="secondary" onclick="chooseImport()">Import library</button></div>');}
    const best=document.querySelector('.best-empty');
    if(best)best.insertAdjacentHTML('beforeend',model.books.length?'<div class="empty-actions"><button class="secondary" onclick="setFilter(\'Read\')">Browse finished books</button></div>':'<div class="empty-actions"><button class="primary" onclick="editBook(null)">Add a book</button><button class="secondary" onclick="chooseImport()">Import library</button></div>');
    const wrapped=document.querySelector('.wrapped-content'),year=String(ui.wrappedYear||new Date().getFullYear());
    if(wrapped&&!model.books.some(book=>Core.isComplete(book)&&String(book.dateFinished||'').startsWith(year))){const hero=wrapped.querySelector('.wrapped-hero');wrapped.innerHTML='';if(hero)wrapped.appendChild(hero);wrapped.insertAdjacentHTML('beforeend',emptyState(`No finished books in ${year} yet`,'Record a finish date and a rating on a read book to create your year in stories.',!model.books.length));if(model.books.length)wrapped.insertAdjacentHTML('beforeend','<div class="empty-actions"><button class="secondary" onclick="setFilter(\'Read\')">Browse finished books</button></div>');}
  }
  function enhanceCharts() {
    const gender=document.querySelector('.gender-column-chart');
    if(gender&&!model.books.some(book=>String(book.gender||'').trim())){
      const panel=gender.closest('.dash-panel');gender.outerHTML='<p class="chart-empty">No author gender data recorded. Add it in a book’s optional edition details to see a distribution.</p>';panel.querySelector('.wrapped-footnote')?.remove();
    }
    all('.wrapped-months').forEach(chart=>{const data=chartData('Monthly finishes');chart.insertAdjacentHTML('afterend',`<details class="chart-data"><summary>View monthly reading table</summary>${data}</details>`);});
    all('.wrapped-author').forEach(row=>{row.title=row.textContent.trim();});
  }
  // Presentation only: keep page content/actions intact while sharing the
  // Parchment banner and recolouring dynamically generated chart marks.
  function parchmentColour(value) {
    if (!value || /url\(/i.test(value)) return value;
    function warm(r,g,b,alpha='') {
      r/=255;g/=255;b/=255;
      const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,light=(max+min)/2;
      if(!delta)return null;
      let hue=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
      hue=(hue*60+360)%360;
      const saturation=delta/(1-Math.abs(2*light-1));
      if(hue<270||hue>345||saturation<=.035)return null;
      const h=light>.75?32:27,s=light>.9?.36:.30,c=(1-Math.abs(2*light-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=light-c/2;
      const parts=[c,x,0].map(v=>Math.round((v+m)*255));
      return '#'+parts.map(v=>v.toString(16).padStart(2,'0')).join('')+alpha;
    }
    return value.replace(/#[0-9a-f]{3,8}(?![\w-])/gi,original=>{
      let raw=original.slice(1);if(![3,4,6,8].includes(raw.length))return original;
      if(raw.length<5)raw=Array.from(raw).map(c=>c+c).join('');
      return warm(parseInt(raw.slice(0,2),16),parseInt(raw.slice(2,4),16),parseInt(raw.slice(4,6),16),raw.slice(6))||original;
    }).replace(/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/gi,(original,r,g,b,a)=>{
      const alpha=a==null?'':Math.round(Number(a)*255).toString(16).padStart(2,'0');
      return warm(Number(r),Number(g),Number(b),alpha)||original;
    });
  }
  function decorateParchment() {
    const content=document.querySelector('main .content');if(!content)return;
    const selectors={Home:'.welcome',Library:'.parchment-library-banner',ReadingLife:'.life-welcome',BestBooks:'.best-books-banner',Planning:'.shop-hero',Recommendations:'.next-read-heading',Picker:'.picker-welcome',NookWrapped:'.wrapped-hero',Stats:'.dash-hero'};
    let banner=content.querySelector(selectors[ui.page]||'.parchment-banner');
    if(ui.page==='Library'&&!banner){
      banner=document.createElement('section');banner.className='parchment-library-banner';
      const copy=document.createElement('div'),eyebrow=document.createElement('div'),title=document.createElement('h1'),subtitle=document.createElement('p');
      eyebrow.className='eyebrow';eyebrow.textContent='YOUR COLLECTION';
      title.textContent=document.querySelector('.page-title')?.textContent||'My Library';
      subtitle.textContent=document.querySelector('.page-subtitle')?.textContent||'';
      copy.append(eyebrow,title,subtitle);banner.appendChild(copy);content.prepend(banner);
    }
    if(banner){
      banner.classList.add('parchment-banner');
      if(['Home','Library','ReadingLife','BestBooks','Planning','Recommendations'].includes(ui.page)&&!banner.querySelector('.parchment-banner-books')){
        const art=document.createElement('div');art.className='parchment-banner-books';art.setAttribute('aria-hidden','true');art.inert=true;
        let covers=ui.page==='Home'?all('.home-best-list .cover',content):all('.cover',content);
        if(ui.page==='Home'){
          const rows=Core.bestBooks(model.books,'year',String(new Date().getFullYear()),4,model.scoringThresholds);
          art.innerHTML=rows.map(row=>cover(model.books.find(book=>book.id===row.bookId),true)).join('');
        }else covers.slice(0,4).forEach(node=>art.appendChild(node.cloneNode(true)));
        if(!art.children.length)art.innerHTML=model.books.filter(book=>book.coverImageData||book.coverURL||book.coverUrl).slice(0,4).map(book=>cover(book,true)).join('');
        all('[id]',art).forEach(node=>node.removeAttribute('id'));
        if(art.children.length){banner.appendChild(art);banner.classList.add('parchment-has-books');}
      }
    }
    all('[style]',content).forEach(node=>{
      for(const property of ['color','background','background-color','background-image','border-color','box-shadow','fill','stroke']){
        const current=node.style.getPropertyValue(property);if(!current)continue;
        const next=parchmentColour(current);if(next!==current)node.style.setProperty(property,next,node.style.getPropertyPriority(property));
      }
    });
    all('svg [fill],svg [stroke]',content).forEach(node=>{
      for(const property of ['fill','stroke']){const value=node.getAttribute(property);if(value)node.setAttribute(property,parchmentColour(value));}
    });
  }
  function afterRender(snapshot) {
    if (!document.getElementById) return;
    document.documentElement.dataset.platform=native()?'desktop':'web';
    const root=document.getElementById('root');if(!root)return;
    const main=root.querySelector('main');if(main){main.dataset.page=ui.page;const heading=main.querySelector('.page-title');if(heading){heading.dataset.focusKey='page-heading-'+ui.page;heading.tabIndex=-1;}}
    streamlinePages();organizeInsights();enhanceEmptyStates();enhanceCharts();decorateParchment();makeLabels(root);
    all('.finish-action-slot .finish-book',root).forEach(button=>{
      const label=button.querySelector('span:first-child');if(!label)return;
      const range=document.createRange();range.selectNodeContents(label);
      const scale=button.getBoundingClientRect().width/button.offsetWidth||1;
      const textRight=(range.getBoundingClientRect().right-button.getBoundingClientRect().left)/scale;
      // Eight pixels before the tick, ten after it, plus the right border.
      button.style.setProperty('--finish-expanded-width',`${textRight+39}px`);
    });
    all('.quote-mark,.shop-stat-icon,.month-icon,.picker-doodle,.wrapped-chat-avatar,.dash-glyph,.metric-icon,.searchicon,.cover-fallback,.shop-orbit,.shop-spark',root).forEach(el=>el.setAttribute('aria-hidden','true'));
    all('.recent-row[onclick]',root).forEach(el=>{el.setAttribute('tabindex','0');el.setAttribute('role','button');});
    all('tr.click-row[onclick]',root).forEach(row=>{const cell=row.querySelector('td');if(cell){const name=cell.textContent;const button=document.createElement('button');button.className='text-button';button.textContent=name;button.setAttribute('aria-label',`Show ${name} books in your library`);button.addEventListener('click',event=>{event.stopPropagation();row.click();});cell.textContent='';cell.appendChild(button);}});
    all('.best-book-title strong,.best-author,.wish-title-line b',root).forEach(el=>el.title=el.textContent.trim());
    all('button,input,select,textarea,summary,[tabindex="0"]',root).forEach((el,index)=>{
      const row=el.closest('[data-nav-page]');
      el.dataset.focusKey=el.id||el.getAttribute('name')||(row?'nav-'+row.dataset.navPage:el.getAttribute('onclick')||el.getAttribute('onchange')||el.textContent.trim())||'control-'+index;
    });
    all('[data-save-state]').forEach(el=>el.textContent=saveState);
    const modal=root.querySelector('.modal'),nextKey=stateKey();
    document.body.style.overflow=modal?'hidden':'';
    all('#root > aside,#root > main,#root > .mobile-bottom-nav').forEach(el=>{el.inert=!!modal;});
    if(modal){
      modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
      const title=modal.querySelector('.modal-title');if(title){title.id='active-dialog-title';title.tabIndex=-1;modal.setAttribute('aria-labelledby',title.id);}
    }
    if(nextKey!==modalKey){
      if(nextKey){if(!snapshot?.modal)returnFocus=snapshot?.focus||returnFocus;modalKey=nextKey;draftBaseline=formValue();(modal?.querySelector('[name=title]')||modal?.querySelector('.modal-title'))?.focus({preventScroll:true});}
      else {modalKey='';draftBaseline='';const target=all('[data-focus-key]',root).find(el=>el.dataset.focusKey===returnFocus);if(target)target.focus({preventScroll:true});else{const heading=main?.querySelector('.page-title');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}returnFocus='';}
    }else if(snapshot?.focus){
      const target=all('[data-focus-key]',root).find(el=>el.dataset.focusKey===snapshot.focus);target?.focus({preventScroll:true});
      if(target&&snapshot.selection!=null){try{target.setSelectionRange(snapshot.selection,snapshot.selectionEnd);}catch{}}
    }
    if(nextKey&&!draftBaseline)draftBaseline=formValue();
    if(snapshot?.page===ui.page){window.scrollTo?.(0,snapshot.y||0);snapshot.scroll.forEach(saved=>{const el=all('.modal-body,.library-scroll').find(node=>node.className===saved.className);if(el)el.scrollTop=saved.top;});}
    else if(!modal){window.scrollTo?.(0,0);const heading=main?.querySelector('.page-title');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
  }
  function init() {
    if (!document.getElementById) return;
    window.receiveRecoverySnapshot=receiveRecoverySnapshot;window.receiveRecoveryLibrary=showRecovery;
    window.setImportBusy=value=>setBusy(value,'Reading workbook… Your original file is not changed.');
    window.receiveSaveResult=(success,message)=>{setSaveState(success?'Saved on this Mac':'Save failed — export a backup');if(!success)notify(message||'Your library could not be saved. Export a full backup to keep your changes.','error');};
    window.receiveExportResult=(success,message)=>{if(success)notify(message||'Backup exported');};
    window.requestAppClose=()=>{if(confirmation){window.webkit.messageHandlers.confirmClose.postMessage(false);return;}if(isDirty())confirmAction({title:'Close without saving?',message:'Your book changes have not been saved. Cancel to keep editing.',action:'Discard changes and close',destructive:true,onConfirm:()=>window.webkit.messageHandlers.confirmClose.postMessage(true),onCancel:()=>window.webkit.messageHandlers.confirmClose.postMessage(false)});else window.webkit.messageHandlers.confirmClose.postMessage(true);};
    setSaveState(native()?'Saved on this Mac':'Saved in this browser');
    window.openSettings=openSettings;
    document.addEventListener('keydown',event=>{
      if(confirmation)return;
      const modal=document.querySelector('#root .modal');
      if(event.key==='Escape'&&modal){event.preventDefault();event.stopImmediatePropagation();cancelTopModal();return;}
      if(event.key==='Tab'&&modal){const nodes=focusable(modal),first=nodes[0],last=nodes[nodes.length-1];if(!first){event.preventDefault();return;}if(event.shiftKey&&(document.activeElement===first||!nodes.includes(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!nodes.includes(document.activeElement))){event.preventDefault();first.focus();}return;}
      if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){const row=event.target.closest?.('[data-nav-page]');if(row&&row.dataset.navPage!=='Home'){event.preventDefault();moveNavigation(row.dataset.navPage,event.key==='ArrowUp'?-1:1);return;}}
      if((event.metaKey||event.ctrlKey)&&['f','o','s',','].includes(event.key.toLowerCase())){
        const key=event.key.toLowerCase();if(key==='f'&&!modal){event.preventDefault();document.querySelector('#global-search')?.focus();}
        if(key==='o'){event.preventDefault();chooseImport();}if(key==='s'&&modal){event.preventDefault();modal.querySelector('form')?.requestSubmit();}if(key===','){event.preventDefault();openSettings();}
      }
      if((event.key==='Enter'||event.key===' ')&&event.target.matches?.('.recent-row[onclick],tr.click-row[onclick]')){event.preventDefault();event.target.click();}
    },true);
    document.addEventListener('input',event=>{event.target.setCustomValidity?.('');const form=event.target.closest?.('form');if(form&&['dateStarted','dateFinished','pagesRead','pageCount'].includes(event.target.name)){form.elements.namedItem('dateFinished')?.setCustomValidity('');form.elements.namedItem('pagesRead')?.setCustomValidity('');}});
    document.addEventListener('invalid',event=>{const field=event.target;if(field.closest('#book-form,#finish-form')){field.closest('details')?.setAttribute('open','');notify(field.validationMessage||'Check the highlighted field.','error');}},true);
    window.addEventListener('beforeunload',event=>{if(isDirty()){event.preventDefault();event.returnValue='';}});
  }
  return {decorateParchment,layoutGenreLabels,genreQuadrant,isBusy:()=>busy,flag,notify,undo,dismissNotification,setSaveState,beforeRender,afterRender,init,isDirty,guardDiscard,confirmAction,setBusy,requestImportAction,setImportIntent,recoverLibrary,receiveRecoverySnapshot,cancelTopModal,openSettings,settingsModal,mobileNavigation,moveNavigation,emptyState,clearFilters,resetPicker,clearScore,filterSummary,editorSections,validateBookForm};
})();
