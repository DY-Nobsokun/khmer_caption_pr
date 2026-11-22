'use strict';
(function(root) {
  let uxp=null,ppro=null;
  try { uxp=require('uxp');ppro=require('premierepro'); } catch (_) {}
  const fs=uxp&&uxp.storage.localFileSystem,core=root.LocalCaptionCore;
  const ticksPerSecond=254016000000;
  // Stored ZIP and gzip blocks keep template generation independent of Node,
  // external executables, compression streams, and the Premiere 27 text API.
  function utf8(value){
    const out=[];
    for(const char of value){const n=char.codePointAt(0);
      if(n<128)out.push(n);else if(n<2048)out.push(192|(n>>6),128|(n&63));
      else if(n<65536)out.push(224|(n>>12),128|((n>>6)&63),128|(n&63));
      else out.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));
    }
    return Uint8Array.from(out);
  }
  const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes){let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
  function join(parts){const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;}
  function gzip(bytes){
    const parts=[Uint8Array.from([31,139,8,0,0,0,0,0,0,255])];
    for(let at=0;at<bytes.length;at+=65535){
      const block=bytes.subarray(at,at+65535),header=new Uint8Array(5),view=new DataView(header.buffer);
      header[0]=at+block.length===bytes.length?1:0;view.setUint16(1,block.length,true);view.setUint16(3,(~block.length)&65535,true);parts.push(header,block);
    }
    const end=new Uint8Array(8),view=new DataView(end.buffer);view.setUint32(0,crc32(bytes),true);view.setUint32(4,bytes.length,true);parts.push(end);return join(parts);
  }
  function zip(files){
    const local=[],central=[];let offset=0;
    for(const [name,data]of files){
      const filename=utf8(name),checksum=crc32(data),header=new Uint8Array(30),v=new DataView(header.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);
      v.setUint32(14,checksum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,filename.length,true);
      local.push(header,filename,data);
      const record=new Uint8Array(46),r=new DataView(record.buffer);
      r.setUint32(0,0x02014b50,true);r.setUint16(4,20,true);r.setUint16(6,20,true);r.setUint16(8,0x800,true);r.setUint16(14,33,true);
      r.setUint32(16,checksum,true);r.setUint32(20,data.length,true);r.setUint32(24,data.length,true);r.setUint16(28,filename.length,true);r.setUint32(42,offset,true);
      central.push(record,filename);offset+=header.length+filename.length+data.length;
    }
    const directory=join(central),end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,directory.length,true);v.setUint32(16,offset,true);
    return join([...local,directory,end]);
  }
  function base64(bytes){
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';
    for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);
      out+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');
    }return out;
  }
  const uuid=()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return (c==='x'?n:(n&3)|8).toString(16);});
  function makeTemplate(template,text,durationTicks){
    if(!template||template.schemaVersion!==1||!template.project.includes('{{TEXT_VALUE}}')||!template.project.includes('{{DURATION_TICKS}}'))throw new Error('The text layer template is invalid. Reload or restore the plugin.');
    text=text.replace(/\r\n|\n/g,'\r');
    const definition=JSON.parse(JSON.stringify(template.definition)),value=JSON.parse(JSON.stringify(template.textValue));
    definition.capsuleID=uuid();definition.capsuleName='Khmer Caption';
    for(const control of definition.clientControls)if(control.type===6)control.value={strDB:[{localeString:'en_US',str:text}]};
    let divisor=durationTicks,remainder=ticksPerSecond;
    while(remainder){const next=divisor%remainder;divisor=remainder;remainder=next;}
    for(const info of Object.values(definition.sourceInfoLocalized))info.duration={scale:ticksPerSecond/divisor,value:durationTicks/divisor};
    value.mTextParam.mStyleSheet.mText=text;
    const json=JSON.stringify(value),bytes=new Uint8Array(8+json.length*2),view=new DataView(bytes.buffer);
    view.setUint32(0,json.length*2,true);
    for(let i=0;i<json.length;i++)view.setUint16(8+i*2,json.charCodeAt(i),true);
    let project=template.project.replace('{{TEXT_VALUE}}',base64(bytes)).split('{{DURATION_TICKS}}').join(String(durationTicks));
    // Native object identities must be consistent inside this project and
    // independent between captions to prevent shared text or cached graphics.
    const identities=new Map();
    project=project.replace(/(ObjectUID|ObjectURef)="([a-f0-9-]{36})"/gi,(match,attribute,id)=>{
      if(!identities.has(id))identities.set(id,uuid());return attribute+'="'+identities.get(id)+'"';
    });
    for(const info of Object.values(definition.sourceInfoLocalized))info.id=identities.get(info.id)||info.id;
    project=project.split(template.definition.capsuleID).join(definition.capsuleID);
    const graphic=zip([['caption.prproj',gzip(utf8(project))]]);
    return zip([['definition.json',utf8(JSON.stringify(definition))],['project.prgraphic',graphic]]).buffer;
  }
  function plan(captions,durationMs,offsetMs,timebase){
    core.validateCaptions(captions,durationMs);
    if(!Number.isInteger(offsetMs)||offsetMs<0||offsetMs>86400000)throw new Error('Enter a valid sequence start offset.');
    const frameTicks=Number(timebase);
    if(!Number.isFinite(frameTicks)||frameTicks<=0)throw new Error('Cannot read the active sequence frame rate.');
    return captions.map((caption,i)=>{
      const start=Math.round((caption.start+offsetMs)*ticksPerSecond/1000/frameTicks)*frameTicks;
      const end=Math.round((caption.end+offsetMs)*ticksPerSecond/1000/frameTicks)*frameTicks;
      if(end<=start)throw new Error('Caption '+(i+1)+' is shorter than one sequence frame. Adjust its timing before generating text layers.');
      return {text:caption.text.trim(),start,end};
    });
  }
  async function createTextTrack(project,sequence,editor,folder,token){
    // insertMogrtFromPath requires an existing track. Only the project-item
    // insertion API creates one. A video-only still reserves the new track;
    // remove that still and its own project item before importing any text.
    const plugin=await fs.getPluginFolder(),image=await plugin.getEntry('assets/timeline.png');
    const seed=await folder.createFile('__khmer-track-'+uuid()+'.png',{overwrite:false});
    let item=null;
    try{
      await seed.write(await image.read({format:uxp.storage.formats.binary}),{format:uxp.storage.formats.binary});
      token.check();
      const rootItem=await project.getRootItem();
      if(!await project.importFiles([seed.nativePath],true,ppro.ProjectItem.cast(rootItem),false))throw new Error('Premiere could not prepare the new text track.');
      item=(await rootItem.getItems()).find(entry=>entry.name===seed.name);
      if(!item)throw new Error('Premiere did not return the temporary track item.');
      token.check();
      const index=await sequence.getVideoTrackCount();let success=false;
      project.lockedAccess(()=>{
        success=project.executeTransaction(action=>{
          action.addAction(editor.createInsertProjectItemAction(item,ppro.TickTime.TIME_ZERO,index,0,true));
        },'Create caption text track');
      });
      if(!success)throw new Error('Premiere could not create the new text track.');
      const track=await sequence.getVideoTrack(index),clips=track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
      const placeholders=[];
      for(const clip of clips){const source=await clip.getProjectItem();if(source&&source.getId()===item.getId())placeholders.push(clip);}
      if(placeholders.length!==1)throw new Error('Premiere did not return the new text track placeholder.');
      project.lockedAccess(()=>{ppro.TrackItemSelection.createEmptySelection(selection=>{
        selection.addItem(placeholders[0],false);
        success=project.executeTransaction(action=>{
          action.addAction(editor.createRemoveItemsAction(selection,false,ppro.Constants.MediaType.VIDEO,false));
          action.addAction(rootItem.createRemoveItemAction(item));
        },'Clear caption text track placeholder');
      });});
      if(!success)throw new Error('Premiere could not clear the text track placeholder.');
      item=null;
      if(track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false).length)throw new Error('The new text track is no longer empty.');
      return index;
    }finally{
      if(item){
        try{
          const rootItem=await project.getRootItem();
          project.lockedAccess(()=>{project.executeTransaction(action=>action.addAction(rootItem.createRemoveItemAction(item)),'Remove caption track placeholder');});
        }catch(_){}
      }
      // Premiere may retain a short-lived read lock on the imported PNG.
      try{await seed.delete();}catch(_){}
    }
  }
  async function generate(captions,durationMs,offsetMs,token=core.cancellation(),stage=()=>{}){
    if(!fs||!ppro)throw new Error('Generate text layers is available inside Premiere.');
    let created=0,folder=null,trackIndex=null,phase='Read active sequence';
    try{
      token.check();
      const project=await ppro.Project.getActiveProject(),sequence=project&&await project.getActiveSequence();
      if(!sequence)throw new Error('Open the sequence that should receive the text layers.');
      const rows=plan(captions,durationMs,offsetMs,await sequence.getTimebase());
      phase='Load text template';
      const plugin=await fs.getPluginFolder(),entry=await plugin.getEntry('presets/text-layer-template.json');
      const template=JSON.parse(await entry.read());
      const editor=ppro.SequenceEditor.getEditor(sequence);
      folder=await (await fs.getDataFolder()).createFolder('text-layers-'+uuid());
      phase='Create text track';stage('Preparing a new text track…');
      trackIndex=await createTextTrack(project,sequence,editor,folder,token);
      for(let i=0;i<rows.length;i++){
        token.check();stage('Creating text layer '+(i+1)+' of '+rows.length+'…');token.check();
        phase='Prepare caption '+(i+1);
        const row=rows[i],file=await folder.createFile('caption-'+String(i+1).padStart(4,'0')+'.mogrt',{overwrite:false});
        await file.write(makeTemplate(template,row.text,row.end-row.start),{format:uxp.storage.formats.binary});
        const currentProject=await ppro.Project.getActiveProject(),currentSequence=currentProject&&await currentProject.getActiveSequence();
        if(!currentProject||String(currentProject.guid)!==String(project.guid)||!currentSequence||String(currentSequence.guid)!==String(sequence.guid))throw new Error('The active sequence changed.');
        token.check();
        phase='Insert caption '+(i+1)+' on V'+(trackIndex+1);
        let items;
        project.lockedAccess(()=>{items=editor.insertMogrtFromPath(file.nativePath,ppro.TickTime.createWithTicks(String(row.start)),trackIndex,0);});
        if(!items||!items.length)throw new Error('Premiere could not insert the text graphic on a new video track.');
        created+=items.length;
        if(items.length!==1)throw new Error('The text template returned an unexpected number of clips.');
        phase='Set caption '+(i+1)+' timing';
        const clip=items[0];let success=false;
        project.lockedAccess(()=>{
          success=project.executeTransaction(action=>{
            action.addAction(clip.createSetEndAction(ppro.TickTime.createWithTicks(String(row.end))));
            action.addAction(clip.createSetNameAction('Caption '+(i+1)+': '+row.text.slice(0,60)));
          },'Set caption text layer timing');
        });
        if(!success)throw new Error('Premiere could not set the text layer timing.');
        const actualStart=await clip.getStartTime(),actualEnd=await clip.getEndTime();
        if(String(actualStart.ticks)!==String(row.start)||String(actualEnd.ticks)!==String(row.end))throw new Error('Premiere did not apply the requested caption timing.');
      }
      return {count:created,track:trackIndex+1};
    }catch(error){
      // Imported templates stay in plugin data so project media remains usable.
      // Never automatically undo edits made by the host or the user.
      if(folder&&!created){try{await folder.delete();}catch(_){}}
      const reason=error&&error.name==='AbortError'?'Generation cancelled.':phase+': '+core.errorMessage(error);
      throw new Error(reason+(created?' '+created+' text clip(s) were inserted on V'+(trackIndex+1)+'. Review that track before retrying.':' No text layers were inserted.'));
    }
  }
  const api={available:!!(fs&&ppro&&ppro.SequenceEditor),generate,makeTemplate,plan};
  root.TimelineTextHost=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
