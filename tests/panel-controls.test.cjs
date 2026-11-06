const {test}=require('node:test');
const assert=require('node:assert/strict');
const {enhance}=require('../panel-controls.js');

test('painting unnamed UXP controls accepts a null ID without breaking player initialization',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),root={};
  vm.runInNewContext(fs.readFileSync(require.resolve('../panel-controls.js'),'utf8'),{globalThis:root,document:{querySelectorAll(){return [];}}});
  assert.doesNotThrow(()=>root.PanelControls.paint({id:null,classList:{contains(){return false;}}}));
});

test('artwork and label clicks reach the current action without bubbling or double activation',()=>{
  for(const id of ['choose-audio','choose-timeline']){
    const children=Array.from({length:4},()=>({events:{},addEventListener(name,fn){this.events[name]=fn;}}));
    const attrs={},el={id,setAttribute(k,v){attrs[k]=v;},getAttribute(k){return attrs[k];},addEventListener(){},querySelectorAll(){return children;}};
    enhance(el);let calls=0;el.onclick=()=>{calls++;};
    for(const child of children){let stopped=false;child.events.click({preventDefault(){},stopImmediatePropagation(){stopped=true;}});assert.equal(stopped,true);}
    assert.equal(calls,4);
    el.disabled=true;children[0].events.click({preventDefault(){},stopImmediatePropagation(){}});assert.equal(calls,4);
    el.disabled=false;el.onclick=()=>{calls+=10;};children[0].events.click({preventDefault(){},stopImmediatePropagation(){}});assert.equal(calls,14);
  }
});
test('control initialization uses the supplied document even when globalThis has no document property',()=>{
  const vm=require('node:vm'),fs=require('node:fs');let queries=0;
  const root={},document={querySelectorAll(){queries++;return [];}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../panel-controls.js'),'utf8'),{globalThis:root,document});
  assert.equal(typeof root.PanelControls.paint,'function');assert.ok(queries>=4);
});
test('custom buttons support keyboard activation, disabled semantics and focus',()=>{
  const attrs={},events={};let clicks=0,prevented=0;
  const el={setAttribute(k,v){attrs[k]=v;},getAttribute(k){return attrs[k];},addEventListener(k,fn){(events[k]??=[]).push(fn);}};
  const emit=(name,event)=>{let stopped=false;for(const fn of events[name]||[]){fn({...event,stopImmediatePropagation(){stopped=true;if(event.stopImmediatePropagation)event.stopImmediatePropagation();}});if(stopped)break;}};
  enhance(el);el.onclick=()=>clicks++;
  assert.equal(attrs.role,'button');assert.equal(el.tabIndex,0);
  for(const key of ['Enter',' '])emit('keydown',{key,preventDefault(){prevented++;}});
  assert.equal(clicks,2);assert.equal(prevented,2);
  emit('keydown',{key:'Enter',repeat:true,preventDefault(){}});assert.equal(clicks,2);
  el.disabled=true;assert.equal(attrs['aria-disabled'],'true');assert.equal(el.tabIndex,-1);
  emit('keydown',{key:'Enter',preventDefault(){}});assert.equal(clicks,2);
  let stopped=false;emit('click',{preventDefault(){},stopImmediatePropagation(){stopped=true;}});assert.equal(stopped,true);
  el.disabled=false;assert.equal(el.tabIndex,0);assert.equal(attrs['aria-disabled'],'false');
  // Simulate UXP dispatching only registered listeners, ignoring onclick.
  emit('click',{});assert.equal(clicks,3);
  el.onclick=()=>{clicks+=10;};emit('click',{});assert.equal(clicks,13);
});
