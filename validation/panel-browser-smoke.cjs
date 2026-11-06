// Run against a local Chrome debugging endpoint. Uses synthetic local audio;
// no network transcription or real user media is used.
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  let tabs;for(let i=0;i<30;i++){try{tabs=await fetch('http://127.0.0.1:9223/json').then(r=>r.json());break;}catch(error){if(i===29)throw error;await new Promise(r=>setTimeout(r,100));}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let next=0;const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')console.error('Browser error:',JSON.stringify(m.params));if(pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  try{
    await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride',{width:460,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:pathToFileURL(path.resolve('index.html')).href});
    for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,100));if(await evaluate("!!document.getElementById('choose-audio').onclick"))break;}
    const controls=await evaluate(`(()=>{
      const advanced=document.querySelector('.advanced'),body=advanced.querySelector('.disclosure-body'),toggle=advanced.querySelector('.disclosure-toggle');
      if(!body.hidden)throw Error('Advanced settings should begin collapsed');toggle.onclick();if(body.hidden)throw Error('Advanced settings did not expand');toggle.onclick();
      const select=document.getElementById('caption-length'),trigger=document.getElementById('caption-length-control');
      trigger.onclick();const menu=trigger.parentNode.querySelector('.select-menu');if(menu.hidden)throw Error('Caption length menu did not open');menu.children[0].onclick();if(select.value!=='word'||!menu.hidden)throw Error('Caption length selection failed');
      select.value='short';PanelControls.refresh();return true;
    })()`);
    console.log('Disclosure and custom selection:',controls);
    async function shot(name){const s=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,name),Buffer.from(s.data,'base64'));}
    await shot('panel-generate.png');
    console.log('Generate:',await evaluate("({width:innerWidth,scroll:document.querySelector('.app').scrollWidth,client:document.querySelector('.app').clientWidth})"));
    await evaluate(`(async()=>{
      const rate=16000,buffer=new ArrayBuffer(44+rate*2*3),view=new DataView(buffer),bytes=new Uint8Array(buffer);
      for(const [offset,text]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);
      view.setUint32(4,buffer.byteLength-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,buffer.byteLength-44,true);
      for(let i=0;i<rate*3;i++)view.setInt16(44+i*2,Math.sin(i*440*Math.PI*2/rate)*2000,true);
      const text='សូមស្វាគមន៍ Khmer Captions';
      LocalCaptionHost.chooseAudio=async()=>({name:'Review sample.wav',path:'synthetic.wav',data:buffer});
      LocalCaptionHost.transcribeAudio=async()=>({fullText:text,model:'preview'});
      LocalCaptionHost.alignAudio=async()=>({schemaVersion:1,audioSha256:LocalCaptionCore.sha256(buffer),fullText:text,engine:'kfa-local',directAlignment:true,words:[{text,startMs:100,endMs:2700}]});
      await document.getElementById('choose-audio').onclick();await document.getElementById('generate').onclick();
      return true;
    })()`);
    await new Promise(r=>setTimeout(r,500));
    await evaluate("document.getElementById('play-caption').onclick()");
    for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,100));if(await evaluate("document.getElementById('review-audio').currentTime>.25"))break;}
    const playing=await evaluate("({time:document.getElementById('review-audio').currentTime,text:document.getElementById('subtitle-text').textContent,paused:document.getElementById('review-audio').paused})");
    console.log('Playback:',playing);if(playing.time<.2||playing.paused||!playing.text.includes('Khmer Captions'))throw Error('Audio/caption sync failed');
    await shot('panel-review.png');
    await evaluate("document.getElementById('audio-toggle').onclick()");
    const result=await evaluate("({rows:document.querySelectorAll('.caption-row').length,editor:document.getElementById('selected-editor').textContent,playable:!document.getElementById('audio-toggle').disabled,reviewVisible:!document.querySelector('.review').hidden,width:document.querySelector('.app').scrollWidth,client:document.querySelector('.app').clientWidth})");
    console.log('Review:',result);if(!result.rows||!result.reviewVisible||!result.playable)throw Error('Review integration failed');
    await call('Emulation.setDeviceMetricsOverride',{width:340,height:800,deviceScaleFactor:1,mobile:false});
    await shot('panel-review-narrow.png');
    const narrow=await evaluate("({scroll:document.querySelector('.app').scrollWidth,client:document.querySelector('.app').clientWidth})");
    console.log('Narrow:',narrow);if(narrow.scroll>narrow.client)throw Error('Panel overflows at minimum width');
    await evaluate("document.getElementById('selected-editor').scrollIntoView({block:'start'})");await shot('panel-editor-narrow.png');
    const exported=await evaluate(`(async()=>{let saved='';LocalCaptionHost.saveText=async(name,text)=>{saved=text;return true;};document.getElementById('approve-all').onclick();await document.getElementById('export').onclick();return saved;})()`);
    if(!exported.includes('00:00:00,100 --> 00:00:02,700'))throw Error('Reviewed SRT export failed');
    console.log('Reviewed SRT export passed.');
    await evaluate("document.getElementById('view-generate').onclick()");
    await call('Emulation.setDeviceMetricsOverride',{width:960,height:900,deviceScaleFactor:1,mobile:false});
    await new Promise(r=>setTimeout(r,100));
    const button=await evaluate("(()=>{const el=document.getElementById('generate'),img=el.querySelector('.button-art');return {width:el.getBoundingClientRect().width,imageWidth:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height};})()");
    if(button.width!==320||button.imageWidth!==320||button.height!==56)throw Error('Artwork and hit target dimensions do not match');
    console.log('Exact image sizing:',button);
    for(const view of ['review','export','generate']){
      await evaluate("document.querySelector('.app').scrollTop=0");
      const point=await evaluate("(()=>{const r=document.getElementById('view-"+view+"').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      if(!await evaluate("document.getElementById('view-"+view+"').getAttribute('aria-pressed')==='true'"))throw Error('Navigation click failed: '+view);
      const visible=await evaluate("Array.from(document.querySelectorAll('[data-page]')).filter(el=>!el.hidden&&getComputedStyle(el).display!=='none').map(el=>el.getAttribute('data-page'))");
      if(visible.length!==1||visible[0]!==view)throw Error('Navigation must expose exactly its own page: '+JSON.stringify(visible));
    }
    console.log('All three navigation controls respond to mouse clicks.');

  }finally{await evaluate('disposeCaptionWorkspace()').catch(()=>{});ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
