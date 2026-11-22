// Uses a local headless Chrome endpoint, synthetic audio and a simulated host.
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  let tabs;for(let i=0;i<30;i++){try{tabs=await fetch('http://127.0.0.1:9223/json').then(r=>r.json());break;}catch(error){if(i===29)throw error;await new Promise(r=>setTimeout(r,100));}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let next=0;const pending=new Map();
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(Error(JSON.stringify(message.error))):resolve(message.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  try{
    await call('Page.navigate',{url:pathToFileURL(path.resolve(__dirname,'../index.html')).href});
    for(let i=0;i<40;i++){if(await evaluate('!!globalThis.captionWorkspaceReady'))break;await new Promise(r=>setTimeout(r,100));}
    await evaluate(`(async()=>{
      const $=id=>document.getElementById(id),buffer=new ArrayBuffer(44+32000),view=new DataView(buffer),bytes=new Uint8Array(buffer);
      for(const [at,text]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);
      view.setUint32(4,buffer.byteLength-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,32000,true);
      LocalCaptionHost.chooseAudio=async()=>({name:'Text layer check.wav',path:'synthetic.wav',data:buffer});
      LocalCaptionHost.transcribeAudio=async()=>({fullText:'សួស្តី ខ្មែរ',model:'fixture'});
      LocalCaptionHost.alignAudio=async()=>({schemaVersion:1,audioSha256:LocalCaptionCore.sha256(buffer),fullText:'សួស្តី ខ្មែរ',engine:'kfa-local',directAlignment:true,words:[{text:'សួស្តី',startMs:100,endMs:400},{text:'ខ្មែរ',startMs:500,endMs:900}]});
      TimelineTextHost.available=true;TimelineTextHost.generate=async(rows,duration,offset)=>{globalThis.textLayerCall={rows,duration,offset};return {count:rows.length,track:4};};
      $('caption-length').value='word';await $('choose-audio').onclick();await $('generate').onclick();
      if(!$('generate-text').disabled)throw Error('Unapproved captions enabled text generation');
      $('approve-all').onclick();$('offset').value='10';$('offset').oninput();$('view-export').onclick();
      if($('generate-text').disabled)throw Error('Approved captions did not enable text generation');
    })()`);
    for(const width of [460,340]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      await new Promise(r=>setTimeout(r,150));
      const layout=await evaluate(`(()=>{const el=document.getElementById('generate-text'),r=el.getBoundingClientRect();return {width:innerWidth,scroll:document.querySelector('.app').scrollWidth,client:document.querySelector('.app').clientWidth,button:r.width,art:el.querySelector('.button-art').getBoundingClientRect().width};})()`);
      if(layout.scroll>layout.client||layout.button!==layout.art)throw Error('Export layout failed: '+JSON.stringify(layout));
      console.log('Export layout:',JSON.stringify(layout));
      const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'panel-text-export-'+width+'.png'),Buffer.from(shot.data,'base64'));
    }
    await evaluate("document.getElementById('generate-text').focus()");
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    const result=await evaluate('({call:globalThis.textLayerCall,message:document.getElementById("text-layer-status").textContent})');
    if(!result.call||result.call.rows.length!==2||result.call.offset!==10000||!result.message.includes('Created 2'))throw Error('Text action failed: '+JSON.stringify(result));
    console.log('Keyboard generation:',result.message);
  }finally{await evaluate('disposeCaptionWorkspace()').catch(()=>{});ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
