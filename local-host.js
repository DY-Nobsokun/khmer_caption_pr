'use strict';
(function(root) {
  let uxp=null;
  try { if (typeof require === 'function') uxp=require('uxp'); } catch (_) {}
  const fs=uxp && uxp.storage.localFileSystem;
  let addon=null;
  async function operation(label, fn) {
    try { return await fn(); }
    catch(error) {
      if(error && error.name==='AbortError') throw error;
      throw new Error(`${label}: ${root.LocalCaptionCore.errorMessage(error)}`);
    }
  }
  async function engine() {
    if (!uxp) throw new Error('Load panel/manifest.json in Premiere to run local transcription.');
    if (!addon) {
      const loaded=await operation('Load native audio engine',async()=>{
        try { return await require('sthang_caption_service.uxpaddon'); }
        catch(error) {
          if (/module not found/i.test(root.LocalCaptionCore.errorMessage(error))) {
            throw new Error('Native engine is not registered. In UXP Developer Tool, unload and remove this plugin, then add NativeCaptionPrototype/panel/manifest.json again and load it. Reload alone may retain the previous native addon registration.');
          }
          throw error;
        }
      });
      if (!loaded || !['start','poll','cancel'].every(key=>typeof loaded[key]==='function')) throw new Error('Reload the current native caption addon.');
      addon=loaded;
    }
    return addon;
  }
  const keyName='gemini-transcribe-api-key-v1';
  function secureStorage(){if(!uxp||!uxp.storage.secureStorage)throw new Error('Secure key storage is available inside Premiere.');return uxp.storage.secureStorage;}
  async function saveKey(value){if(!root.GeminiTranscribeCore.validKey(value))throw new Error('Enter a valid Gemini API key.');await secureStorage().setItem(keyName,value.trim());}
  async function loadKey(){if(!uxp||!uxp.storage.secureStorage)return '';let value;try{value=await uxp.storage.secureStorage.getItem(keyName);}catch(_){return '';}if(!value)return '';return typeof value==='string'?value:String.fromCharCode(...new Uint8Array(value));}
  async function forgetKey(){await secureStorage().removeItem(keyName);}
  function transport(request,token,stage){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();let unsubscribe=()=>{},finished=false;
      const finish=(error,result)=>{if(finished)return;finished=true;unsubscribe();error?reject(error):resolve(result);};
      try {
        xhr.open('POST',request.url);xhr.timeout=request.timeoutMs;
        for(const [name,value]of Object.entries(request.headers))xhr.setRequestHeader(name,value);
        if(xhr.upload)xhr.upload.onprogress=event=>{if(event.lengthComputable)stage(`Sending audio to Google: ${Math.round(event.loaded/event.total*100)}%`);};
        xhr.onload=()=>{
          if(xhr.status<200||xhr.status>=300){const messages={400:'Google rejected the transcription request.',401:'Gemini authentication failed. Check your API key.',403:'This API key cannot access Gemini 3.5 Transcribe.',404:'Gemini 3.5 Transcribe is unavailable to this API key.',429:'Gemini quota or rate limit reached. Check your Google API quota before retrying.'};finish(new Error(messages[xhr.status]||`Gemini service error (HTTP ${xhr.status}).`));return;}
          try{finish(null,JSON.parse(xhr.responseText));}catch(_){finish(new Error('Gemini returned an unreadable response.'));}
        };
        xhr.onerror=()=>finish(new Error('Cannot reach Gemini. Check your connection and reload the plugin with its network permission.'));
        xhr.ontimeout=()=>finish(new Error('Gemini transcription timed out. A request received by Google may still be processed or billed.'));
        xhr.onabort=()=>{const error=new Error('Cancelled');error.name='AbortError';finish(error);};
        unsubscribe=token.subscribe(()=>{xhr.abort();const error=new Error('Cancelled');error.name='AbortError';finish(error);});
        token.check();xhr.send(JSON.stringify(request.body));
      }catch(error){finish(error);}
    });
  }
  async function transcribeAudio(audio,token,stage,key){return root.GeminiTranscribeCore.transcribe({audio,token,stage,apiKey:key.trim()||await loadKey(),transport});}
  function browserFile(types) {
    return new Promise((resolve,reject)=>{
      const input=document.createElement('input'); input.type='file'; input.accept=types.map(x=>'.'+x).join(',');
      input.oncancel=()=>{input.remove();resolve(null);};
      input.onchange=async()=>{try { const f=input.files[0]; if(!f) return resolve(null); if(f.size>(types.includes('wav')?4000000:2*1024*1024)) throw new Error(types.includes('wav')?'Choose a WAV up to 120 seconds.':'Choose a JSON file under 2 MB.'); resolve({name:f.name,data:await f.arrayBuffer(),text:()=>f.text()}); } catch(e){reject(e);} finally{input.remove();}};
      input.hidden=true; document.body.appendChild(input); input.click();
    });
  }
  async function chooseAudio(token=root.LocalCaptionCore.cancellation(), stage=()=>{}) {
    if (!fs) {
      const file=await browserFile(['wav','mp4']);
      if(file && /\.mp4$/i.test(file.name)) throw new Error('MP4 audio extraction is available inside Premiere.');
      return file;
    }
    const file=await operation('Open recording picker',()=>fs.getFileForOpening({types:['wav','mp4'],allowMultiple:false}));
    if (!file) return null;
    token.check();
    const mp4=/\.mp4$/i.test(file.name);
    const limit=mp4 ? 300*1024*1024 : 4000000;
    if ((await operation('Read recording metadata',()=>file.getMetadata())).size>limit) throw new Error(mp4 ? 'Choose an MP4 up to 300 MB and 120 seconds.' : 'Choose mono 16 kHz WAV audio up to 120 seconds.');
    stage(`Selected: ${file.name}. ${mp4?'Preparing video audio locally...':'Reading audio...'}`);
    const data=await operation('Read selected recording',()=>file.read({format:uxp.storage.formats.binary}));token.check();
    if (!mp4) root.LocalCaptionCore.wavInfo(data);
    const temporary=await operation('Open temporary audio folder',()=>fs.getTemporaryFolder());
    const name='khmer-local-'+Date.now()+'-'+Math.random().toString(16).slice(2);
    let snapshot=null, wav=null, addon=null, conversionRunning=false;
    const remove=async entry=>{if(entry){try{await entry.delete();}catch(_){}}};
    try {
      snapshot=await operation('Create recording snapshot',()=>temporary.createFile(name+(mp4?'.mp4':'.wav'),{overwrite:false}));
      await operation('Write recording snapshot',()=>snapshot.write(data,{format:uxp.storage.formats.binary}));token.check();
      if(!mp4) return {name:file.name,data,path:snapshot.nativePath,dispose:()=>snapshot.delete()};
      wav=await operation('Create extracted audio file',()=>temporary.createFile(name+'-audio.wav',{overwrite:false}));
      addon=await engine();token.check();
      await operation('Start MP4 audio extraction',()=>addon.start(wav.nativePath,snapshot.nativePath,'prepare'));conversionRunning=true;
      const unsubscribe=token.subscribe(()=>addon.cancel());
      try {
        for(;;){
          const result=await operation('Read extraction status',()=>addon.poll());stage(`${file.name}: ${result.message||'Extracting audio locally...'}`);
          if(!result.running){
            conversionRunning=false;token.check();
            if(result.state!=='complete') throw new Error(result.message||'MP4 audio extraction failed. Reload the updated plugin if needed.');
            break;
          }
          await new Promise(resolve=>setTimeout(resolve,500));
        }
      } finally { unsubscribe(); }
      const audio=await operation('Read extracted WAV audio',()=>wav.read({format:uxp.storage.formats.binary}));token.check();
      root.LocalCaptionCore.wavInfo(audio);
      await remove(snapshot);snapshot=null;
      return {name:file.name,data:audio,path:wav.nativePath,dispose:()=>wav.delete(),extracted:true};
    } catch(e) {
      // Never remove files while a native decoder may still be reading them.
      if(conversionRunning){try{addon.cancel();}catch(_){}}else{await remove(wav);await remove(snapshot);}
      throw e;
    }
  }
  async function alignAudio(wavPath, text, token, stage) {
    const config=root.captionKfaPaths;
    if(!config) throw new Error('Installed KFA configuration is missing. Restore the local plugin configuration.');
    const addon=await engine();token.check();
    if(typeof addon.align!=='function') throw new Error('Reload the KFA-enabled native caption plugin.');
    const folder=await operation('Locate KFA adapter',()=>fs.getPluginFolder());
    const script=await operation('Read KFA adapter location',()=>folder.getEntry('kfa-runtime.py'));
    const temporary=await operation('Open KFA cache folder',()=>fs.getTemporaryFolder());token.check();
    const settings={...config,cacheDir:temporary.nativePath+'/kfa-numba-cache'};
    await operation('Start KFA word timing',()=>addon.align(wavPath,text,config.pythonHome,config.sitePackages,script.nativePath,JSON.stringify(settings)));
    const unsubscribe=token.subscribe(()=>addon.cancel());
    try {
      for(;;){
        const status=await operation('Read KFA timing status',()=>addon.poll());stage(status.message||'Generating word timing with KFA...');
        if(!status.running){token.check();if(status.state!=='complete')throw new Error(status.message||'KFA alignment failed');
          try{return JSON.parse(status.alignmentJson);}catch(_){throw new Error('KFA returned unreadable alignment data');}
        }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    } catch(error) {try{addon.cancel();}catch(_){}throw error;} finally {unsubscribe();}
  }
  async function openJson() {
    if (!fs) { const file=await browserFile(['json']); return file ? JSON.parse(await file.text()) : null; }
    const file=await fs.getFileForOpening({types:['json'],allowMultiple:false});
    if(!file) return null;
    if((await file.getMetadata()).size>2*1024*1024) throw new Error('Choose JSON under 2 MB.');
    return JSON.parse(await file.read());
  }
  async function saveText(name,text) {
    if(fs) { const f=await fs.getFileForSaving(name,{types:[name.split('.').pop()]}); if(!f)return false; await f.write(text); return true; }
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  }
  root.LocalCaptionHost={inPremiere:!!uxp,engine,chooseAudio,alignAudio,transcribeAudio,saveKey,loadKey,forgetKey,openJson,saveText};
  if(uxp) uxp.entrypoints.setup({panels:{captionWorkspace:{show(){},destroy(){if(root.disposeCaptionWorkspace)root.disposeCaptionWorkspace();}}}});
})(globalThis);
