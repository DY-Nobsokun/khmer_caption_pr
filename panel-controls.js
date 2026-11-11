'use strict';
(function(root,panelDocument){
  // Native UXP buttons can paint a host-controlled surface over custom CSS.
  // Use ordinary elements with explicit button semantics and keyboard behavior.
  const wiredChildren=new WeakSet();
  function wireChildren(el){
    if(!el.querySelectorAll)return;
    el.querySelectorAll('*').forEach(child=>{
      if(wiredChildren.has(child))return;
      wiredChildren.add(child);
      // UXP may target artwork or labels without bubbling to the control.
      child.addEventListener('click',event=>{
        event.preventDefault();event.stopImmediatePropagation();
        if(!el.disabled&&typeof el.onclick==='function')el.onclick(event);
      });
    });
  }
  function enhance(el){
    el.setAttribute('role','button');
    // UXP custom elements do not consistently dispatch assigned onclick
    // properties. Keep the action in JS and dispatch it from an event listener.
    let action=typeof el.onclick==='function'?el.onclick:null;
    el.onclick=null;
    Object.defineProperty(el,'onclick',{configurable:true,get(){return action;},set(value){action=typeof value==='function'?value:null;}});
    let disabled=el.getAttribute('aria-disabled')==='true';
    Object.defineProperty(el,'disabled',{configurable:true,get(){return disabled;},set(value){
      disabled=!!value;el.setAttribute('aria-disabled',String(disabled));el.tabIndex=disabled?-1:0;
    }});
    el.disabled=disabled;
    el.addEventListener('click',event=>{
      if(el.disabled){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    el.addEventListener('click',event=>{
      if(!el.disabled&&action)return action.call(el,event);
    });
    el.addEventListener('keydown',event=>{
      if(event.key!=='Enter'&&event.key!==' '&&event.key!=='Spacebar')return;
      event.preventDefault();
      if(!el.disabled&&!event.repeat&&typeof el.onclick==='function')el.onclick(event);
    });
    wireChildren(el);
    return el;
  }
  function createButton(document){return enhance(document.createElement('div'));}
  const selects=[];
  function paint(el){
    if(!panelDocument)return;
    let color=null;
    if(el.classList.contains('caption-nav'))color='neutral';
    if(el.classList.contains('caption-delete'))color='coral';
    if(el.classList.contains('save-changes'))color='green';
    if(['generate'].includes(el.id)||el.classList.contains('retime'))color='orange';
    if(['choose-audio','export','audio-toggle'].includes(el.id))color='blue';
    if(['choose-timeline','approve-all'].includes(el.id)||el.classList.contains('approve'))color='green';
    if(el.id==='cancel')color='coral';
    if(String(el.id||'').startsWith('view-'))color=el.getAttribute('aria-pressed')==='true'?'orange':el.getAttribute('data-complete')==='true'?'green':'neutral';
    if(!color)return;
    el.setAttribute('data-surface',color);
    const viewport=panelDocument.body.clientWidth||460;
    let width=150,height=42;
    if(String(el.id||'').startsWith('view-')){width=viewport<380?96:viewport<440?112:viewport<600?130:150;height=48;}
    else if(['generate','export'].includes(el.id)){width=viewport<380?260:320;height=56;}
    else if(['choose-audio','choose-timeline'].includes(el.id)){width=viewport<380?110:viewport<500?155:190;height=48;}
    else if(el.id==='approve-all'){width=120;height=40;}
    else if(el.classList.contains('approve')){width=200;height=42;}
    else if(el.id==='audio-toggle'){width=viewport<380?95:135;height=42;}
    let art=el.querySelector('.button-art');
    if(!art){
      const content=panelDocument.createElement('span');content.className='button-content';
      while(el.firstChild)content.appendChild(el.firstChild);
      art=panelDocument.createElement('img');art.className='button-art';art.alt='';art.setAttribute('aria-hidden','true');
      el.appendChild(art);el.appendChild(content);
    }
    art.src='assets/button-'+color+'-'+width+'x'+height+'.png';
    for(const target of [el,art]){target.style.width=width+'px';target.style.height=height+'px';target.style.minWidth=width+'px';target.style.maxWidth=width+'px';target.style.minHeight=height+'px';target.style.maxHeight=height+'px';}
    el.style.flex='0 0 '+width+'px';
    wireChildren(el);

  }
  function customSelect(select,document){
    const shell=document.createElement('div');shell.className='select-shell';
    const trigger=createButton(document);trigger.className='ui-button select-trigger';trigger.id=select.id+'-control';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const menu=document.createElement('div');menu.className='select-menu';menu.setAttribute('role','listbox');menu.hidden=true;
    const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
    trigger.onclick=()=>{if(select.disabled)return;menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));};
    for(const option of Array.from(select.children)){
      const item=createButton(document);item.className='ui-button select-option';item.textContent=option.textContent;item.setAttribute('role','option');
      item.onclick=()=>{if(select.disabled)return;select.value=option.value;close();refresh();if(typeof select.onchange==='function')select.onchange();trigger.focus();};menu.appendChild(item);
    }
    shell.addEventListener('keydown',event=>{if(event.key==='Escape'){close();trigger.focus();}});
    select.parentNode.insertBefore(shell,select);shell.appendChild(trigger);shell.appendChild(menu);select.hidden=true;
    document.querySelectorAll('label[for="'+select.id+'"]').forEach(label=>label.setAttribute('for',trigger.id));
    selects.push({select,trigger,menu});
  }
  function refresh(){for(const {select,trigger,menu}of selects){const option=Array.from(select.children).find(o=>o.value===select.value);trigger.textContent=(option?option.textContent:select.value)+'  ▾';trigger.disabled=select.disabled;if(select.disabled){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}}if(panelDocument)panelDocument.querySelectorAll('.ui-button').forEach(paint);}
  function disclosure(el){
    const toggle=el.querySelector('.disclosure-toggle'),body=el.querySelector('.disclosure-body'),arrow=el.querySelector('.disclosure-arrow');
    let open=el.getAttribute('data-disclosure')==='true';
    Object.defineProperty(el,'open',{configurable:true,get(){return open;},set(value){open=!!value;body.hidden=!open;toggle.setAttribute('aria-expanded',String(open));arrow.textContent=open?'−':'+';}});
    toggle.onclick=()=>{el.open=!el.open;};el.open=open;
  }
  const api={enhance,createButton,refresh,paint};root.PanelControls=api;
  if(typeof module!=='undefined')module.exports=api;
  if(panelDocument){panelDocument.querySelectorAll('.ui-button').forEach(enhance);panelDocument.querySelectorAll('[data-disclosure]').forEach(disclosure);panelDocument.querySelectorAll('select').forEach(select=>customSelect(select,panelDocument));refresh();if(root.addEventListener)root.addEventListener('resize',refresh);}
})(globalThis,typeof document==='undefined'?null:document);
