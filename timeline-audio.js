'use strict';
(function(root) {
  let uxp=null,ppro=null;
  try { uxp=require('uxp');ppro=require('premierepro'); } catch (_) {}
  const fs=uxp&&uxp.storage.localFileSystem,core=root.LocalCaptionCore;
  const pause=()=>new Promise(resolve=>setTimeout(resolve,500));
  function nativeJoin(folder,name){
    const windows=/^[a-z]:[\\/]|^\\\\/i.test(folder);
    return (windows?folder.replace(/\//g,'\\'):folder).replace(/[\\/]+$/,'')+(windows?'\\':'/')+name;
  }
  async function remove(entry){if(entry){try{await entry.delete();}catch(_){}}}
  async function preset(sequence,token){
    token.check();
    const plugin=await fs.getPluginFolder();
    const entry=await plugin.getEntry('presets/timeline-audio.epr');
    const extension=await ppro.EncoderManager.getExportFileExtension(sequence,entry.nativePath);
    token.check();
    if(String(extension).replace(/^\./,'').toLowerCase()!=='wav')throw new Error('The bundled timeline audio preset is invalid. Reload or restore the plugin.');
    return entry;
  }
  // A successful export request alone does not prove that its WAV is complete.
  function inspectRender(buffer){
    const bytes=new Uint8Array(buffer),view=new DataView(buffer);
    const tag=at=>String.fromCharCode(...bytes.subarray(at,at+4));
    if(bytes.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE'||view.getUint32(4,true)+8!==bytes.length)throw new Error('Timeline WAV is incomplete.');
    let format,data;
    for(let at=12;at+8<=bytes.length;){
      const size=view.getUint32(at+4,true),start=at+8;
      if(start+size>bytes.length)throw new Error('Timeline WAV has an incomplete chunk.');
      if(tag(at)==='fmt '&&size>=16)format={encoding:view.getUint16(start,true),channels:view.getUint16(start+2,true),rate:view.getUint32(start+4,true),byteRate:view.getUint32(start+8,true),block:view.getUint16(start+12,true),bits:view.getUint16(start+14,true)};
      if(tag(at)==='data')data=size;
      at=start+size+(size%2);
    }
    if(!format||!data||format.encoding!==1||format.bits!==16||format.channels<1||format.channels>8||format.rate<8000||format.rate>192000||format.block!==format.channels*2||format.byteRate!==format.rate*format.block||data%format.block)throw new Error('Use the Waveform Audio 48kHz 16-bit export preset.');
    return {durationMs:data/format.byteRate*1000};
  }
  async function range(sequence){
    const start=await sequence.getInPoint(),end=await sequence.getOutPoint();
    return {start,end,durationMs:(end.seconds-start.seconds)*1000};
  }
  async function assertUnchanged(sequence,expected){
    const project=await ppro.Project.getActiveProject();
    const current=project&&await project.getActiveSequence();
    const actual=await range(sequence);
    if(!current||String(current.guid)!==String(sequence.guid)||actual.start.ticks!==expected.start.ticks||actual.end.ticks!==expected.end.ticks)throw new Error('The active sequence or In/Out range changed. Use timeline audio again.');
  }
  async function chooseTimelineAudio(token=core.cancellation(),stage=()=>{}){
    if(!fs||!ppro)throw new Error('Use timeline audio inside Premiere Pro.');
    const project=await ppro.Project.getActiveProject();
    const sequence=project&&await project.getActiveSequence();
    if(!sequence)throw new Error('Open a sequence and mark its In/Out range first.');
    const selected=await range(sequence);token.check();
    if(!Number.isFinite(selected.durationMs)||selected.durationMs<100||selected.durationMs>120000)throw new Error('Mark a timeline In/Out range between 0.1 and 120 seconds.');
    const offsetMs=Math.round(selected.start.seconds*1000);
    if(!Number.isFinite(offsetMs)||offsetMs<0||offsetMs>86400000)throw new Error('Timeline range must start between 0 and 86,400 seconds.');
    const frameMs=Number(await sequence.getTimebase())/254016000000*1000;
    if(!Number.isFinite(frameMs)||frameMs<=0)throw new Error('Cannot read the sequence frame rate.');
    const timeline={sequenceName:sequence.name,sequenceId:String(sequence.guid),inTicks:selected.start.ticks,outTicks:selected.end.ticks,zeroPointTicks:(await sequence.getZeroPoint()).ticks,offsetMs};
    const exportPreset=await preset(sequence,token);token.check();
    await assertUnchanged(sequence,selected);token.check();
    const encoder=ppro.EncoderManager.getManager();
    const temporary=await fs.getTemporaryFolder();
    const folder=await temporary.createFolder('khmer-timeline-'+Date.now()+'-'+Math.random().toString(16).slice(2));
    const outputPath=nativeJoin(folder.nativePath,'timeline.wav');
    let wav=null,addon=null,nativeRunning=false,renderMayBeRunning=false;
    async function cleanup(){
      await remove(wav);
      try {await remove(await folder.getEntry('timeline.wav'));}catch(_){}
      await remove(folder);
    }
    try {
      stage(`Rendering ${timeline.sequenceName}: ${(selected.durationMs/1000).toFixed(3)} seconds. Cancellation waits for Premiere to finish.`);
      renderMayBeRunning=true;
      const accepted=await encoder.exportSequence(sequence,ppro.Constants.ExportType.IMMEDIATELY,outputPath,exportPreset.nativePath,false);
      if(accepted!==true){renderMayBeRunning=false;throw new Error('Premiere did not complete the timeline export request.');}
      // Immediate exports normally finish before returning. Observe the actual file too.
      let rendered=null,lastError;
      const deadline=Date.now()+45000;
      while(Date.now()<deadline){
        try {
          const entry=await folder.getEntry('timeline.wav');
          if((await entry.getMetadata()).size>128*1024*1024)throw new Error('Timeline export exceeds 128 MB. Use the 48kHz 16-bit WAV preset.');
          rendered=inspectRender(await entry.read({format:uxp.storage.formats.binary}));break;
        } catch(error){lastError=error;}
        // Do not delete files or release the job while Premiere might still be writing.
        await pause();
      }
      if(!rendered)throw new Error('No complete timeline WAV was produced. '+core.errorMessage(lastError));
      renderMayBeRunning=false;token.check();
      if(Math.abs(rendered.durationMs-selected.durationMs)>frameMs+1)throw new Error('Premiere exported a different duration than the marked range. Mark In/Out explicitly and try again.');
      await assertUnchanged(sequence,selected);token.check();
      stage('Preparing timeline audio locally...');
      wav=await folder.createFile('audio.wav',{overwrite:false});
      addon=await root.LocalCaptionHost.engine();token.check();
      await addon.start(wav.nativePath,outputPath,'prepare');nativeRunning=true;
      const unsubscribe=token.subscribe(()=>addon.cancel());
      try {
        for(;;){
          const status=await addon.poll();
          if(!status.running){
            nativeRunning=false;token.check();
            if(status.state!=='complete')throw new Error(status.message||'Timeline audio preparation failed.');
            break;
          }
          await pause();
        }
      } finally {unsubscribe();}
      const data=await wav.read({format:uxp.storage.formats.binary});token.check();
      const info=core.wavInfo(data);
      if(Math.abs(info.durationMs-rendered.durationMs)>10)throw new Error('Local audio preparation changed the duration. Timeline audio was not loaded.');
      await remove(await folder.getEntry('timeline.wav'));
      return {name:timeline.sequenceName+' · timeline In/Out',data,path:wav.nativePath,playbackUrl:typeof fs.getFsUrl==='function'?fs.getFsUrl(wav):null,kind:'timeline',timeline,dispose:cleanup};
    } catch(error){
      if(nativeRunning){try{addon.cancel();}catch(_){}}
      // Retain uncertain output in UXP's temporary storage rather than deleting beneath a writer.
      if(!nativeRunning&&!renderMayBeRunning)await cleanup();
      throw error;
    }
  }
  root.TimelineAudioHost={available:!!(fs&&ppro),chooseTimelineAudio};
})(globalThis);
