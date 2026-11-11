const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create,captionAt,format}=require('../caption-playback.js');
const rows=[{id:1,text:'First caption',start:100,end:900},{id:2,text:'Second caption',start:1000,end:1800}];
class Element{
  constructor(){this.handlers={};this.children=[];this.style={};this.value='';this.paused=true;this.currentTime=0;this.src='';}
  addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);}
  removeEventListener(name,fn){this.handlers[name]=this.handlers[name].filter(f=>f!==fn);}
  emit(name){for(const fn of this.handlers[name]||[])fn();}
  play(){this.paused=false;this.emit('play');return Promise.resolve();}
  pause(){this.paused=true;this.emit('pause');}
  load(){}
  removeAttribute(name){this[name]='';}
  appendChild(el){this.children.push(el);}
}
function fixture(readyEvent='loadeddata'){
  const elements={};const get=id=>elements[id]??=new Element();
  const frames=[],notices=[];
  const player=create({document:{getElementById:get,createElement:()=>new Element()},notice:m=>notices.push(m),onFrame:c=>frames.push(c)});
  const audio=get('review-audio');
  // Minimal PCM file for waveform; production WAV validation happens before load.
  const data=new ArrayBuffer(48),v=new DataView(data),b=new Uint8Array(data);
  b.set([100,97,116,97],36);v.setUint32(40,4,true);v.setInt16(44,1000,true);
  player.load({name:'Snapshot.wav',playbackUrl:'plugin-temp:/snapshot.wav',data},2000);
  player.update(rows,1,false);audio.emit(readyEvent);
  return {player,audio,get,frames,notices};
}
test('caption matching uses source-relative time, handles gaps and exclusive end boundaries',()=>{
  assert.equal(captionAt(rows,99),null);assert.equal(captionAt(rows,100).id,1);
  assert.equal(captionAt(rows,900),null);assert.equal(captionAt(rows,1000).id,2);
  assert.equal(captionAt([{id:3,start:null,end:null}],0),null);
  assert.equal(format(62345),'01:02.345');
});
test('loaded snapshot drives subtitle, seek position and caption following',()=>{
  const f=fixture();try{
    assert.equal(f.get('audio-toggle').disabled,false);
    f.audio.currentTime=1.2;f.audio.emit('timeupdate');
    assert.equal(f.get('subtitle-text').textContent,'Second caption');
    assert.equal(f.get('audio-seek').value,'1200');assert.equal(f.frames.at(-1).id,2);
    f.audio.currentTime=.95;f.audio.emit('timeupdate');assert.equal(f.get('subtitle-text').textContent,'No caption at this position.');
    f.player.seek(10);assert.equal(f.audio.currentTime,2);
  }finally{f.player.dispose();}
});
test('dragging waveform or recording slider seeks and updates the preview',()=>{
  const f=fixture();try{
    const event=clientX=>({clientX,button:0,preventDefault(){}});
    for(const id of ['waveform','audio-seek']){
      const surface=f.get(id);surface.getBoundingClientRect=()=>({left:100,width:200});
      surface.handlers.pointerdown[0](event(150));assert.equal(f.audio.currentTime,.5);
      surface.handlers.pointermove[0](event(220));assert.equal(f.audio.currentTime,1.2);
      assert.equal(f.get('subtitle-text').textContent,'Second caption');
      surface.handlers.pointerup[0](event(400));assert.equal(f.audio.currentTime,2);
      surface.handlers.pointermove[0](event(150));assert.equal(f.audio.currentTime,2);
    }
    f.get('audio-seek').value='500';f.get('audio-seek').emit('change');assert.equal(f.audio.currentTime,.5);
    f.player.update(rows,1,true);
    f.get('waveform').handlers.pointerdown[0](event(220));assert.equal(f.audio.currentTime,.5);
  }finally{f.player.dispose();}
});

test('custom seek bar supports mouse drag, wheel and keyboard verification',()=>{
  const f=fixture();try{
    const bar=f.get('audio-seek');bar.getBoundingClientRect=()=>({left:100,right:300});
    const event={clientX:150,button:0,preventDefault(){}};
    bar.handlers.mousedown[0](event);
    bar.handlers.mousemove[0]({...event,clientX:220});
    assert.equal(f.audio.currentTime,1.2);
    assert.equal(f.get('audio-seek-thumb').style.left,'60%');
    bar.handlers.mouseup[0]({...event,clientX:220});
    bar.handlers.wheel[0]({...event,deltaY:-100});
    assert.ok(Math.abs(f.audio.currentTime-.2)<.0001);
    bar.handlers.keydown[0]({...event,key:'ArrowRight'});
    assert.equal(f.get('subtitle-text').textContent,'Second caption');
    bar.handlers.keydown[0]({...event,key:'Home'});assert.equal(f.audio.currentTime,0);
    bar.handlers.wheel[0]({...event,deltaY:100,shiftKey:true});assert.equal(f.audio.currentTime,.1);
  }finally{f.player.dispose();}
});

test('play selected caption stops at end; loop returns to selected start',async()=>{
  const f=fixture();try{
    f.get('play-caption').onclick();assert.equal(f.audio.currentTime,.1);
    f.audio.currentTime=.94;f.audio.emit('timeupdate');assert.equal(f.audio.paused,true);assert.equal(f.audio.currentTime,.9);
    f.get('audio-loop').checked=true;f.get('play-caption').onclick();
    f.audio.currentTime=.94;f.audio.emit('timeupdate');assert.equal(f.audio.paused,false);assert.equal(f.audio.currentTime,.1);
    f.player.update(rows,1,true);assert.equal(f.audio.paused,true);assert.equal(f.get('audio-toggle').disabled,true);
  }finally{f.player.dispose();}
});
test('runtime media errors disable playback without losing captions; reset clears media source',()=>{
  const f=fixture();try{
    f.audio.emit('error');assert.equal(f.get('audio-toggle').disabled,true);assert.match(f.get('playback-help').textContent,/editing and SRT export remain/);
    f.player.update(rows,1,false);assert.equal(f.get('audio-toggle').disabled,true);
    f.player.reset();assert.equal(f.audio.src,'');assert.equal(f.get('playback-state').textContent,'Choose audio first');
  }finally{f.player.dispose();}
});

test('audio-only metadata makes Play ready and explicitly enables sound',()=>{
  const f=fixture('loadedmetadata');try{
    assert.equal(f.get('audio-toggle').disabled,false);assert.equal(f.audio.preload,'auto');
    assert.equal(f.audio.muted,false);assert.equal(f.audio.volume,1);
    assert.equal(f.get('audio-clock').textContent,'00:00.000 / 00:02.000');
  }finally{f.player.dispose();}
});

test('optional artwork failures do not stop loading or synchronized captions',()=>{
  const previous=globalThis.PanelControls;
  globalThis.PanelControls={refresh(){throw new Error('Host styling failed');}};
  const warn=console.warn;console.warn=()=>{};
  let f;try{
    f=fixture();f.get('audio-toggle').onclick();f.audio.currentTime=1.2;f.audio.emit('timeupdate');
    assert.equal(f.audio.paused,false);assert.equal(f.get('subtitle-text').textContent,'Second caption');
  }finally{if(f)f.player.dispose();console.warn=warn;if(previous===undefined)delete globalThis.PanelControls;else globalThis.PanelControls=previous;}
});

test('loop restarts at selected caption when the media ends and Play restarts a finished recording',()=>{
  const f=fixture();try{
    f.get('audio-loop').checked=true;f.audio.currentTime=2;f.audio.paused=true;f.audio.emit('ended');
    assert.equal(f.audio.currentTime,.1);assert.equal(f.audio.paused,false);
    f.get('audio-loop').checked=false;f.audio.currentTime=2;f.audio.paused=true;f.get('audio-toggle').onclick();
    assert.equal(f.audio.currentTime,0);assert.equal(f.audio.paused,false);
  }finally{f.player.dispose();}
});

test('previous and next caption navigation handle silence after the final caption',()=>{
  const f=fixture();try{
    f.audio.currentTime=1.95;f.get('audio-prev').onclick();assert.equal(f.audio.currentTime,1);
    f.audio.currentTime=1.95;f.get('audio-next').onclick();assert.equal(f.audio.currentTime,1);
  }finally{f.player.dispose();}
});
