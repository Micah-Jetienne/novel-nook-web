/* Mobile adapters retain the original named inputs and their existing save handlers. */
window.NookMobile = {
  keyboards(root) {
    root.querySelectorAll('input').forEach(input => {
      if (input.type==='number' || ['pageCount','pagesRead','year'].includes(input.name)) {
        input.inputMode=input.step && input.step!=='1' ? 'decimal' : 'numeric';
      }
      if (input.type==='url' || input.name==='coverURL') {
        input.inputMode='url';input.autocapitalize='none';input.setAttribute('autocorrect','off');
      }
      if (input.name==='isbn') {input.inputMode='text';input.autocapitalize='characters';input.setAttribute('autocorrect','off');}
    });
  },
  enhance(root) {
    if (!matchMedia('(max-width:760px)').matches) return;
    root.querySelectorAll('#book-form input[list]').forEach(input => {
      if (input.dataset.mobilePicker) return;
      const list=document.getElementById(input.getAttribute('list'));
      if (!list?.options.length) return;
      input.dataset.mobilePicker='true';
      const label=input.closest('.field')?.querySelector('label');
      const name=label?.textContent.trim() || input.name;
      const select=document.createElement('select');
      select.id=(input.id || input.name)+'-mobile-picker';
      select.setAttribute('aria-label',name);
      select.className='mobile-native-picker';
      select.add(new Option('Choose '+name.toLowerCase(),''));
      const values=[...new Set([...list.options].map(o=>o.value))];
      values.forEach(value=>select.add(new Option(value,value)));
      // A sentinel outside the data domain permits every literal user-entered value.
      let custom='__nook_custom__';while(values.includes(custom))custom+='_';
      select.add(new Option('Type another value…',custom));
      select.value=values.includes(input.value)||!input.value?input.value:custom;
      input.hidden=select.value!==custom;
      input.setAttribute('aria-label','Custom '+name.toLowerCase());
      input.classList.add('mobile-custom-value');
      if(label)label.htmlFor=select.id;
      select.addEventListener('change',()=>{
        const isCustom=select.value===custom;
        input.hidden=!isCustom;
        if(isCustom){input.focus();return;}
        input.value=select.value;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
      });
      input.before(select);
    });
  }
};
