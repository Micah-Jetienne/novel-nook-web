/* Human-triggered Open Library lookup. Never writes the library or rerenders the book form. */
(function(root){
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=value=>typeof value==='string'?value.trim():'';
  const array=value=>Array.isArray(value)?value:[];
  const names=value=>(Array.isArray(value)?value:[]).map(v=>text(typeof v==='string'?v:v?.name)).filter(Boolean).join(', ');
  const fields={title:'Book title',author:'Author',publisher:'Publisher',year:'Publication year',isbn:'ISBN',pageCount:'Page count',coverURL:'Cover'};
  const cleanISBN=value=>String(value||'').replace(/[\s-]/g,'').toUpperCase();
  function validISBN(value){const v=cleanISBN(value);if(/^\d{9}[\dX]$/.test(v))return [...v].reduce((n,c,i)=>n+(c==='X'?10:Number(c))*(10-i),0)%11===0;if(/^\d{13}$/.test(v))return [...v].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10===0;return false;}
  function safeCover(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='covers.openlibrary.org'?u.href:''}catch{return ''}}
  function edition(raw,author=''){
    raw=raw&&typeof raw==='object'?raw:{};
    const isbn=array(raw.isbn_13).find(validISBN)||array(raw.isbn_10).find(validISBN)||array(raw.identifiers?.isbn_13).find(validISBN)||array(raw.identifiers?.isbn_10).find(validISBN)||'';
    const key=/^\/books\/OL\d+M$/.test(raw.key||'')?raw.key:'';
    const coverID=array(raw.covers).find(v=>Number.isInteger(v)&&v>0);
    const cover=coverID?`https://covers.openlibrary.org/b/id/${coverID}-L.jpg?default=false`:safeCover(raw.cover?.large||raw.cover?.medium||'');
    const year=text(raw.publish_date).match(/\b(?:1[5-9]\d{2}|20[0-3]\d|2040)\b/)?.[0]||'';
    const page=Number(raw.number_of_pages);
    const language=array(raw.languages).map(v=>text(v.key).split('/').pop()).filter(Boolean).map(code=>({eng:'English',fre:'French',fra:'French',ger:'German',deu:'German',spa:'Spanish',ita:'Italian',jpn:'Japanese',chi:'Chinese',zho:'Chinese',por:'Portuguese',rus:'Russian',dut:'Dutch',nld:'Dutch'}[code]||code)).join(', ');
    return {title:text(raw.title),author:names(raw.authors)||author||text(raw.by_statement),publisher:names(raw.publishers),year,isbn:cleanISBN(isbn),pageCount:Number.isInteger(page)&&page>0?String(page):'',coverURL:cover,
      key,format:text(raw.physical_format),language,date:text(raw.publish_date),editionName:text(raw.edition_name)};
  }
  let form=null,host=null,state={},sequence=0,pending=null;
  function section(){return root.__NOVEL_TRACKER_NATIVE__?'<section id="book-lookup" class="book-lookup" aria-label="Open Library book lookup"></section>':'';}
  function current(key){const input=form?.elements.namedItem(key);return typeof input?.value==='string'?input.value.trim():''}
  function render(){if(!host?.isConnected)return;
    const heading='<div class="lookup-heading"><div><h3>Look up a book</h3><p>Search Open Library, choose your edition, then review the details.</p></div><span class="lookup-source">Open Library</span></div>';
    const search=`<div class="lookup-search"><label for="lookup-query">Title, author or ISBN</label><div><input id="lookup-query" type="search" maxlength="200" autocomplete="off" value="${esc(state.query||'')}" placeholder="e.g. Empire of Silence or an ISBN"><button type="button" class="secondary" data-lookup="search">${state.busy?'Search again':'Search books'}</button></div></div>`;
    const status=`<p class="lookup-status" role="${state.error?'alert':'status'}" aria-live="polite">${esc(state.error||state.status||'Online lookup is optional. You can always enter the book manually.')}</p>`;
    let content='';
    if(state.preview){const book=state.preview;
      content=`<div class="lookup-preview"><h4>Review this edition</h4><p class="lookup-edition-context">${esc([book.editionName,book.format,book.language,book.date].filter(Boolean).join(' · ')||'Some edition details are not recorded in this catalogue entry.')}</p>${book.coverURL?`<img class="lookup-preview-cover" src="${esc(book.coverURL)}" alt="Cover for the selected edition" onerror="this.hidden=true">`:''}<p>Choose the fields to use. Existing information is unchecked by default.</p><div class="lookup-fields">${Object.entries(fields).filter(([key])=>book[key]).map(([key,label])=>{const old=current(key),hasCover=key==='coverURL'&&current('coverImageData');return `<label class="lookup-field"><input type="checkbox" data-import-field="${key}" ${!old&&!hasCover?'checked':''}><span><strong>${label}</strong><span>${key==='coverURL'?'Use the selected edition’s cover':esc(book[key])}</span>${old||hasCover?`<small>Current: ${hasCover?'your uploaded cover':esc(key==='coverURL'?'your current cover':old)}</small>`:''}</span></label>`}).join('')}</div><p class="panel-note">Series, volume/edition, chapters, ratings and reading history stay as you entered them. Format and language are kept as catalogue metadata.</p><div class="lookup-actions"><button type="button" class="primary" data-lookup="apply">Use selected details</button><button type="button" class="quiet" data-lookup="back">Back to results</button></div></div>`;
    }else if(state.editions){content=`<h4>Choose the edition you own</h4><p class="panel-note">${esc(state.work?.title||'ISBN match')} · Compare publisher, date, format, language and ISBN. Missing values are left blank.</p><div class="lookup-results">${state.editions.map((b,i)=>`<button type="button" class="lookup-result" data-lookup="preview" data-index="${i}">${b.coverURL?`<img src="${esc(b.coverURL)}" loading="lazy" alt="" onerror="this.hidden=true">`:'<span class="lookup-cover-placeholder" aria-hidden="true"></span>'}<span><strong>${esc(b.title||'Untitled edition')}</strong><small>${esc([b.publisher,b.date,b.format,b.language].filter(Boolean).join(' · ')||'Edition details not recorded')}</small><small>${esc([b.isbn?'ISBN '+b.isbn:'ISBN not recorded',b.pageCount?b.pageCount+' pages':'Page count not recorded'].join(' · '))}</small><span class="lookup-select">Review edition</span></span></button>`).join('')}</div><div class="lookup-actions">${state.work?'<button type="button" class="quiet" data-lookup="works">Back to books</button>':''}${state.offset>0?'<button type="button" class="secondary" data-lookup="previous">Previous editions</button>':''}${state.hasMore?'<button type="button" class="secondary" data-lookup="next">More editions</button>':''}</div>`;
    }else if(state.works){content=`<div class="lookup-results">${state.works.map((w,i)=>`<button type="button" class="lookup-result" data-lookup="editions" data-index="${i}">${Number.isInteger(w.cover_i)&&w.cover_i>0?`<img src="https://covers.openlibrary.org/b/id/${w.cover_i}-M.jpg?default=false" loading="lazy" alt="" onerror="this.hidden=true">`:'<span class="lookup-cover-placeholder" aria-hidden="true"></span>'}<span><strong>${esc(w.title)}</strong><small>${esc(names(w.author_name)||'Author not recorded')}</small><small>${esc(w.edition_count||'Multiple')} editions${w.first_publish_year?' · First published '+esc(w.first_publish_year):''}</small><span class="lookup-select">Choose an edition</span></span></button>`).join('')}</div>`;}
    host.innerHTML=heading+search+status+content;host.setAttribute('aria-busy',String(!!state.busy));host.querySelectorAll('[data-lookup]').forEach(button=>{button.disabled=!!state.busy&&button.dataset.lookup!=='search'});
  }
  function request(action,args={}){const bridge=root.webkit?.messageHandlers?.lookupBook;if(!bridge){state.error='Book lookup is not available in this build. You can enter details manually.';state.busy=false;render();return}
    const id='lookup-'+(++sequence);pending={id,action,args};state.busy=true;state.error='';state.status=action==='editions'?'Loading editions…':'Searching Open Library…';render();bridge.postMessage({id,action,...args});
  }
  function search(){state.query=host.querySelector('#lookup-query').value.trim();if(state.query.length<2){state.error='Enter a title, author or ISBN.';render();return}
    state.preview=null;state.editions=null;state.work=null;state.works=null;state.offset=0;
    const isbn=cleanISBN(state.query),looksISBN=/^(?:\d{9}[\dX]|\d{13})$/.test(isbn);
    if(looksISBN&&!validISBN(isbn)){state.error='That ISBN does not pass its check digit. Check the number, or search by title.';render();return}
    request(looksISBN?'isbn':'search',{query:looksISBN?isbn:state.query});
  }
  function receive(reply){if(!pending||reply?.id!==pending.id||!host?.isConnected)return;const job=pending;pending=null;state.busy=false;
    if(reply.error){state.error=reply.error;state.status='';render();return}
    const data=reply.data||{};
    if(job.action==='search'){state.works=array(data.docs).filter(w=>w&&/^\/works\/OL\d+W$/.test(w.key||''));state.status=state.works.length?'Choose a book to browse its editions.':'No books found. Try a shorter title, the author’s name, or an ISBN.';}
    else if(job.action==='isbn'){const raw=data['ISBN:'+job.args.query];state.editions=raw?[edition(raw)]:[];state.hasMore=false;state.status=raw?'One edition matched this ISBN. Review it before importing.':'No edition found for that ISBN. Try searching by title.';}
    else{state.editions=array(data.entries).map(raw=>edition(raw,names(state.work?.author_name)));state.offset=job.args.offset||0;state.hasMore=state.editions.length===12&&state.offset+12<Number(data.size||0);state.status=state.editions.length?'Choose the matching edition.':'No editions found on this page.';}
    render();
  }
  function apply(){const book=state.preview;if(!book)return;const selected=[...host.querySelectorAll('[data-import-field]:checked')].map(el=>el.dataset.importField);if(!selected.length){state.error='Choose at least one field to use.';render();return}
    function set(key,value){let field=form.elements.namedItem(key);if(!field){field=document.createElement('input');field.type='hidden';field.name=key;form.appendChild(field)}field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}
    selected.forEach(key=>{if(Object.hasOwn(fields,key)&&book[key])set(key,book[key]);});
    if(selected.includes('coverURL'))set('coverImageData','');
    // Source metadata does not replace any of the user's series or reading fields.
    if(book.key)set('openLibraryEdition',book.key);else if(book.isbn)set('openLibraryEdition','ISBN:'+book.isbn);
    set('editionFormat',book.format);set('editionLanguage',book.language);set('editionPublicationDate',book.date);
    root.updateWeightedScore?.(form);root.refreshCoverPreview?.();
    state.preview=null;state.editions=null;state.works=null;state.work=null;state.status='Selected details added to your draft. Review the form, then Save book.';state.error='';render();
    form.elements.namedItem('title')?.focus();
  }
  function mount(){const next=document.querySelector('#book-form'),panel=next?.querySelector('#book-lookup');if(!panel)return;if(next===form&&panel===host)return;
    sequence++;pending=null;form=next;host=panel;state={query:current('title'),offset:0};
    host.addEventListener('input',event=>{if(event.target.id==='lookup-query')state.query=event.target.value});
    host.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='lookup-query'){event.preventDefault();search()}});
    host.addEventListener('click',event=>{const button=event.target.closest('[data-lookup]');if(!button)return;const action=button.dataset.lookup,index=Number(button.dataset.index);
      if(action==='search')search();if(action==='apply')apply();if(action==='back'){state.preview=null;render()}
      if(action==='editions'){const work=state.works?.[index];if(work){state.work=work;state.editions=null;state.offset=0;request('editions',{work:work.key,offset:0})}}
      if(action==='preview'){state.preview=state.editions?.[index]||null;render()}
      if(action==='works'){state.editions=null;state.work=null;render()}
      if(action==='next'||action==='previous')request('editions',{work:state.work.key,offset:Math.max(0,state.offset+(action==='next'?12:-12))});
    });render();
  }
  root.receiveBookLookup=receive;
  root.NookBookLookup={section,mount,receive,edition,validISBN,safeCover};
})(typeof window!=='undefined'?window:globalThis);
