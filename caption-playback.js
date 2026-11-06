'use strict';
(function(root){
  const format=ms=>{ms=Math.max(0,Math.round(ms||0));return String(Math.floor(ms/60000)).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');};
  const captionAt=(rows,ms)=>rows.find(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start<=ms&&ms<c.end)||null;
  function create({document,notice,onFrame}){
    const $=id=>document.getElementById(id),audio=$('review-audio');
    let rows=[],selected=null,duration=0,ready=false,locked=false,url=null,segment=null,disposed=false,timer=null,hasSource=false;
    const listeners=[];
    function listen(name,fn){audio.addEventListener(name,fn);listeners.push([name,fn]);}
    function stopTimer(){if(timer!==null){root.clearInterval(timer);timer=null;}}
    function artwork(){try{if(root.PanelControls)root.PanelControls.refresh();}catch(error){console.warn('Playback artwork:',error);}}
    function playLabel(text){$('audio-toggle').textContent=text;artwork();}
    function pause(){stopTimer();try{if(typeof audio.pause==='function')audio.pause();}catch(_){}playLabel('Play');}
    function controls(){
      for(const id of ['audio-toggle','audio-seek','audio-prev','audio-next','audio-speed','audio-loop','audio-follow'])$(id).disabled=!ready||locked;
      const c=rows.find(c=>c.id===selected);
      $('play-caption').disabled=!ready||locked||!c||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.end<=c.start;
      artwork();
    }
    function failed(error){pause();ready=false;controls();$('playback-state').textContent='Playback unavailable';const detail=error&&error.message||audio.error&&audio.error.message||'';$('playback-help').textContent='This Premiere runtime could not play the local WAV. Caption editing and SRT export remain available.'+(detail?' '+detail:'');}
    function seek(seconds){if(!ready||locked)return;segment=null;try{audio.currentTime=Math.max(0,Math.min(duration/1000,seconds));frame();}catch(_){failed();}}
    async function play(){if(!ready||locked)return;try{if(Number(audio.currentTime)>=duration/1000)audio.currentTime=0;await audio.play();}catch(error){failed(error);}}
    function frame(){
      if(disposed)return;
      let ms=Number(audio.currentTime)*1000||0;
      const chosen=rows.find(c=>c.id===selected);
      const loop=$('audio-loop').checked&&chosen&&Number.isFinite(chosen.start)&&Number.isFinite(chosen.end)&&chosen.end>chosen.start?chosen:null;
      const range=loop||segment;
      if(range&&!audio.paused&&(ms>=range.end||ms<range.start)){
        if(loop){audio.currentTime=range.start/1000;ms=range.start;}
        else{pause();audio.currentTime=range.end/1000;ms=range.end;segment=null;}
      }
      const c=captionAt(rows,ms);
      $('subtitle-text').textContent=c?c.text:rows.length?'No caption at this position.':'Captions will appear after transcription.';
      $('playing-caption').textContent=c?'Caption '+c.id+' of '+rows.length:'Caption preview';
      $('audio-clock').textContent=format(ms)+' / '+format(duration);
      $('audio-seek').value=String(Math.round(ms));
      if(onFrame)onFrame(c);
    }
    function reset(){
      hasSource=false;pause();ready=false;segment=null;duration=0;
      audio.removeAttribute('src');if(typeof audio.load==='function')audio.load();
      if(url&&root.URL&&root.URL.revokeObjectURL)root.URL.revokeObjectURL(url);url=null;
      $('waveform').textContent='';$('playback-state').textContent='Choose audio first';$('playback-source').textContent='Choose a recording to listen.';controls();frame();
    }
    function waveform(data){
      const bytes=new Uint8Array(data),view=new DataView(data);let start=0,size=0;
      for(let p=12;p+8<=bytes.length;){const n=view.getUint32(p+4,true);if(p+8+n>bytes.length)break;if(String.fromCharCode(...bytes.slice(p,p+4))==='data'){start=p+8;size=n;break;}p+=8+n+(n%2);}
      const target=$('waveform');target.textContent='';if(!size)return;
      const samples=Math.floor(size/2),count=64,peaks=[];
      for(let i=0;i<count;i++){let peak=0;for(let j=Math.floor(i*samples/count);j<Math.floor((i+1)*samples/count);j++)peak=Math.max(peak,Math.abs(view.getInt16(start+j*2,true)));peaks.push(peak);}
      const max=Math.max(1,...peaks);
      for(const peak of peaks){const bar=document.createElement('span');bar.style.height=Math.max(3,peak/max*42)+'px';target.appendChild(bar);}
    }
    function load(file,ms){
      try{
        reset();duration=ms;$('audio-seek').max=String(ms);$('playback-source').textContent=file.name;
        $('playback-state').textContent='Loading audio…';$('playback-help').textContent='Playback uses the captured audio snapshot.';
        if(typeof audio.play!=='function')throw new Error('Media API unavailable');
        waveform(file.data);
        let src=file.playbackUrl;
        if(!src&&root.Blob&&root.URL&&root.URL.createObjectURL){url=root.URL.createObjectURL(new root.Blob([file.data],{type:'audio/wav'}));src=url;}
        if(!src)throw new Error('No playable snapshot URL');
        audio.preload='auto';audio.muted=false;audio.volume=1;hasSource=true;
        audio.src=src;audio.load();frame();
      }catch(error){failed(error);}
    }
    if(typeof audio.addEventListener==='function'){
      const loaded=()=>{if(!hasSource)return;ready=true;$('playback-state').textContent='Ready';controls();frame();};
      listen('loadedmetadata',loaded);listen('loadeddata',loaded);
      listen('error',()=>{if(hasSource)failed();});listen('timeupdate',frame);listen('seeked',frame);
      listen('play',()=>{playLabel('Pause');$('playback-state').textContent='Playing';stopTimer();if(root.setInterval)timer=root.setInterval(frame,40);});
      listen('pause',()=>{stopTimer();playLabel('Play');if(ready)$('playback-state').textContent='Paused';});
      listen('ended',()=>{const c=rows.find(c=>c.id===selected);if($('audio-loop').checked&&c&&Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start){audio.currentTime=c.start/1000;frame();play();}else{segment=null;pause();frame();}});
    }
    $('audio-toggle').onclick=()=>{if(audio.paused){segment=null;play();}else pause();};
    $('audio-seek').oninput=()=>seek(Number($('audio-seek').value)/1000);
    $('audio-speed').onchange=()=>{try{audio.playbackRate=Number($('audio-speed').value);}catch(_){notice('This runtime does not support changing playback speed.');}};
    $('play-caption').onclick=()=>{const c=rows.find(c=>c.id===selected);if(!c||!Number.isFinite(c.start)||!Number.isFinite(c.end))return;seek(c.start/1000);segment={start:c.start,end:c.end};play();};
    $('audio-loop').onchange=()=>{segment=null;};
    for(const [id,delta]of [['audio-prev',-1],['audio-next',1]])$(id).onclick=()=>{const timed=rows.filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end));const ms=Number(audio.currentTime)*1000,current=captionAt(timed,ms),next=timed.findIndex(c=>c.start>ms);const index=current?timed.indexOf(current):delta>0?(next<0?timed.length-1:next):next<0?timed.length-1:next-1;const c=timed[Math.max(0,Math.min(timed.length-1,current?index+delta:index))];if(c)seek(c.start/1000);};
    controls();
    return {load,reset,pause,seek,update(next,id,busy){rows=next;selected=id;locked=busy;if(busy)pause();controls();frame();},dispose(){disposed=true;reset();for(const [name,fn]of listeners)audio.removeEventListener(name,fn);}};
  }
  const api={create,captionAt,format};root.CaptionPlayback=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
