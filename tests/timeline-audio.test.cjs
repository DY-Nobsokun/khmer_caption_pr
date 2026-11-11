const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../local-core.js');
const code=fs.readFileSync(path.join(__dirname,'../timeline-audio.js'),'utf8');
function wav(rate=16000,channels=1,seconds=1){
  const buffer=Buffer.alloc(44+rate*channels*2*seconds);
  buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(channels,22);
  buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*channels*2,28);
  buffer.writeUInt16LE(channels*2,32);buffer.writeUInt16LE(16,34);
  buffer.write('data',36);buffer.writeUInt32LE(buffer.length-44,40);
  return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
}
function fixture(options={}){
  const files=new Map(),deleted=[],calls=[];let pickerCount=0,polls=0;
  const makeFile=(name,data)=>({name,nativePath:'C:\\cache\\run\\'+name,
    async getMetadata(){return {size:data?data.byteLength:0};},async read(){return data;},
    async write(value){data=value;},async delete(){deleted.push(name);files.delete(name);}});
  const folder={nativePath:'C:\\cache\\run',async createFile(name){const entry=makeFile(name);files.set(name,entry);return entry;},
    async getEntry(name){if(!files.has(name))throw new Error('Missing file');return files.get(name);},
    async delete(){assert.equal(files.size,0,'remove files before their folder');deleted.push('folder');}};
  const preset={nativePath:'C:\\plugin\\presets\\timeline-audio.epr'};
  const storage={formats:{binary:'binary'},localFileSystem:{async getPluginFolder(){return {async getEntry(name){assert.equal(name,'presets/timeline-audio.epr');if(options.missingPreset)throw new Error('Missing bundled preset');return preset;}};},
    async getFileForOpening(){pickerCount++;throw new Error('Timeline audio must not open a file picker');},
    async getTemporaryFolder(){return {async createFolder(){return folder;}};}}};
  const time=seconds=>({seconds,ticks:String(Math.round(seconds*254016000000))});
  const sequence={name:'Nested edits',guid:'sequence-1',async getInPoint(){return time(options.start===undefined?10:options.start);},
    async getOutPoint(){return time(options.end===undefined?11:options.end);},
    async getTimebase(){return '8475667200';},async getZeroPoint(){return time(3600);}};
  const project={async getActiveSequence(){return options.noSequence?null:sequence;}};
  const encoder={async exportSequence(...args){calls.push(['export',...args]);if(options.exportError)throw new Error('Export failed');
    files.set('timeline.wav',makeFile('timeline.wav',options.raw||wav(48000,2,1)));
    if(options.cancelDuringExport)options.token.cancel();
    if(options.changeRange)sequence.getOutPoint=async()=>time(12);
    return true;}};
  const addon={async start(...args){calls.push(['prepare',...args]);await files.get('audio.wav').write(options.normalized||wav());},
    async poll(){polls++;if(options.cancelDuringPreparation&&polls===1){options.token.cancel();return {running:true};}
      return {running:false,state:options.nativeError?'error':'complete',message:'Decoder failed'};},cancel(){calls.push(['cancel']);}};
  const ppro={Project:{async getActiveProject(){return project;}},EncoderManager:{getManager:()=>encoder,
    async getExportFileExtension(){return options.extension||'wav';}},Constants:{ExportType:{IMMEDIATELY:1}}};
  const context={LocalCaptionCore:core,LocalCaptionHost:{async engine(){return addon;}},setTimeout:fn=>setImmediate(fn),
    require(name){if(name==='uxp')return {storage};if(name==='premierepro')return ppro;throw new Error('Unexpected module');}};
  vm.runInNewContext(code,context);
  return {api:context.TimelineAudioHost,calls,deleted,files,sequence,get pickerCount(){return pickerCount;}};
}
test('marked parent range exports with native separators and normalizes without changing sequence',async()=>{
  const f=fixture();const audio=await f.api.chooseTimelineAudio();
  const call=f.calls[0];assert.equal(call[0],'export');assert.equal(call[2],1);
  assert.equal(call[3],'C:\\cache\\run\\timeline.wav');assert.equal(call[5],false);
  assert.equal(call[4],'C:\\plugin\\presets\\timeline-audio.epr');
  assert.equal(f.calls[1][0],'prepare');assert.equal(core.wavInfo(audio.data).durationMs,1000);
  assert.equal(audio.timeline.offsetMs,10000);assert.equal(audio.timeline.zeroPointTicks,'914457600000000');
  assert.equal(audio.kind,'timeline');assert.deepEqual(f.deleted,['timeline.wav']);
  await audio.dispose();assert.deepEqual(f.deleted,['timeline.wav','audio.wav','folder']);
});
test('bundled preset is automatic on first and repeated use without opening a picker',async()=>{
  const f=fixture();await (await f.api.chooseTimelineAudio()).dispose();
  await (await f.api.chooseTimelineAudio()).dispose();assert.equal(f.pickerCount,0);
});
test('no active sequence and out-of-range durations fail before export',async()=>{
  for(const options of [{noSequence:true},{end:131},{start:-1,end:0},{end:10}]){
    const f=fixture(options);await assert.rejects(f.api.chooseTimelineAudio());assert.equal(f.calls.length,0);
  }
});
test('missing or invalid bundled presets fail without asking users to find a file',async()=>{
  const f=fixture({missingPreset:true});await assert.rejects(f.api.chooseTimelineAudio(),/Missing bundled preset/);assert.equal(f.calls.length,0);assert.equal(f.pickerCount,0);
  const invalid=fixture({extension:'mp4'});await assert.rejects(invalid.api.chooseTimelineAudio(),/preset is invalid/);assert.equal(invalid.calls.length,0);assert.equal(invalid.pickerCount,0);
});
test('a full-sequence result or a changed range never reaches the decoder',async()=>{
  for(const options of [{raw:wav(48000,2,2)},{changeRange:true}]){
    const f=fixture(options);await assert.rejects(f.api.chooseTimelineAudio(),/duration|range changed/);
    assert.equal(f.calls.length,1);assert.ok(f.deleted.includes('folder'));
  }
});
test('cancel during immediate render waits for settled output then discards it',async()=>{
  const token=core.cancellation(),f=fixture({token,cancelDuringExport:true});
  await assert.rejects(f.api.chooseTimelineAudio(token),e=>e.name==='AbortError');
  assert.equal(f.calls.length,1);assert.ok(f.deleted.includes('folder'));
});
test('cancel during decoding waits for worker termination before cleanup',async()=>{
  const token=core.cancellation(),f=fixture({token,cancelDuringPreparation:true});
  await assert.rejects(f.api.chooseTimelineAudio(token),e=>e.name==='AbortError');
  assert.ok(f.calls.some(call=>call[0]==='cancel'));assert.ok(f.deleted.includes('audio.wav'));assert.ok(f.deleted.includes('folder'));
});
test('native errors and duration changes reject the result and clean temporary audio',async()=>{
  for(const options of [{nativeError:true},{normalized:wav(16000,1,2)}]){
    const f=fixture(options);await assert.rejects(f.api.chooseTimelineAudio(),/Decoder failed|changed the duration/);
    assert.ok(f.deleted.includes('folder'));
  }
});

class Element {
  constructor(){this.children=[];this.value='';this.disabled=false;this.checked=false;this.handlers={};this.attributes={};this.style={};}
  get childElementCount(){return this.children.length;}
  set textContent(value){this._text=value;this.children=[];}get textContent(){return this._text;}
  appendChild(child){this.children.push(child);}setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name];}
  addEventListener(name,handler){(this.handlers[name]??=[]).push(handler);}
  emit(name){let stopped=false,result;const event={preventDefault(){},stopImmediatePropagation(){stopped=true;}};for(const handler of this.handlers[name]||[]){const value=handler(event);if(value!==undefined)result=value;if(stopped)break;}return result;}
  removeAttribute(name){delete this[name];}
}
function panel(){
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const e=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  for(const id of ['choose-audio','choose-timeline'])require('../panel-controls.js').enhance(e[id]);
  const audio=e['review-audio'];audio.paused=true;audio.currentTime=0;
  audio.play=()=>{audio.paused=false;audio.emit('play');return Promise.resolve();};
  audio.pause=()=>{audio.paused=true;audio.emit('pause');};
  audio.load=()=>{if(audio.src)audio.emit('loadedmetadata');};
  e.offset.value='0';e['caption-length'].value='short';
  let uploads=0,timelines=0,transcriptions=0,released=0;
  const host={async loadKey(){return '';},async chooseAudio(){uploads++;return {name:'upload.wav',path:'upload.wav',playbackUrl:'plugin-temp:/upload.wav',data:wav()};},
    async transcribeAudio(){transcriptions++;return {fullText:'hello',model:'gemini'};},
    async alignAudio(){throw new Error('Timing unavailable in this fixture');}};
  const timeline={available:true,async chooseTimelineAudio(){timelines++;return {name:'Nested edits',path:'timeline.wav',playbackUrl:'plugin-temp:/timeline.wav',data:wav(),kind:'timeline',timeline:{offsetMs:10000},async dispose(){released++;}};}};
  const doc=new Element();Object.assign(doc,{getElementById:id=>e[id],createElement:()=>new Element(),querySelectorAll:()=>Object.values(e)});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../workspace.js'),'utf8'),{
    LocalCaptionCore:core,LocalCaptionHost:host,TimelineAudioHost:timeline,CaptionPlayback:require('../caption-playback.js'),
    document:doc});
  return {e,host,timeline,doc,stats:()=>({uploads,timelines,transcriptions,released})};
}
test('timeline selection sets offset without transcribing; uploading still works and resets timeline offset',async()=>{
  const f=panel();await f.e['choose-timeline'].onclick();assert.equal(f.e.offset.value,'10');
  assert.equal(f.e.generate.disabled,false);assert.equal(f.stats().transcriptions,0);
  await f.e['choose-audio'].onclick();assert.equal(f.e.offset.value,'0');assert.equal(f.e['audio-name'].textContent,'upload.wav');
  assert.deepEqual(f.stats(),{uploads:1,timelines:1,transcriptions:0,released:1});
});

test('listener-only source clicks reach the upload picker and timeline preparation',async()=>{
  const f=panel();
  assert.match(f.e['media-status'].textContent,/Ready to choose/);
  await f.e['choose-audio'].emit('click');
  assert.equal(f.stats().uploads,1);assert.equal(f.e['audio-name'].textContent,'upload.wav');
  await f.e['choose-timeline'].emit('click');
  assert.equal(f.stats().timelines,1);assert.equal(f.e['audio-name'].textContent,'Nested edits');
  assert.equal(f.stats().transcriptions,0);
});

test('UXP null empty transcript does not block either source picker',async()=>{
  for(const id of ['choose-audio','choose-timeline']){
    const f=panel();f.e.transcript.value=null;f.e['api-key'].value=null;
    await f.e[id].emit('click');
    assert.equal(f.stats().uploads+f.stats().timelines,1);
    assert.equal(f.e.generate.disabled,false);assert.match(f.e['media-status'].textContent,/Ready:/);
  }
});

test('null offset remains invalid and empty inline wording is rejected',async()=>{
  const f=await timedPanel();f.e.offset.value=null;f.e.offset.oninput();assert.equal(f.e.export.disabled,true);
  const form=editRow(f);form.children[0].value=null;finishRow(form);
  assert.match(form.children[3].textContent,/wording/);assert.equal(f.e.transcript.value,'hello');
});

test('chosen recording plays and inline editing pauses playback',async()=>{
  const f=await timedPanel(),audio=f.e['review-audio'];
  f.e['audio-toggle'].onclick();assert.equal(audio.paused,false);
  const form=editRow(f);assert.equal(audio.paused,true);
  form.children[0].value='corrected wording';finishRow(form);
  assert.equal(f.e.transcript.value,'corrected wording');assert.equal(f.e.export.disabled,true);
});
test('inline wording edits preserve timing through approval and SRT export',async()=>{
  const f=await timedPanel();let form=editRow(f);
  form.children[1].children[0].value='0.125';form.children[2].children[0].value='0.875';finishRow(form);
  f.e['approve-all'].onclick();form=editRow(f);form.children[0].value='corrected wording';finishRow(form);
  assert.equal(f.e.export.disabled,true);
  let saved;f.host.saveText=async(name,value)=>{saved=value;return true;};
  f.e['selected-editor'].children[0].children[0].onclick();
  await f.e.export.onclick();assert.match(saved,/00:00:00,125 --> 00:00:00,875\ncorrected wording/);
});

test('workflow navigation exposes exactly one independent page at a time',()=>{
  const f=panel();
  for(const view of ['generate','review','export','generate']){
    f.e['view-'+view].onclick();
    for(const name of ['generate','review','export'])assert.equal(f.e[name+'-page'].hidden,name!==view);
  }
});

test('caption pages stay selected with playback follow enabled and reset list position',async()=>{
  const f=panel();await f.e['choose-audio'].onclick();
  f.e.transcript.value=Array.from({length:11},(_,i)=>'caption '+(i+1)).join('\n');
  f.e.rebuild.onclick();f.e['audio-follow'].checked=true;
  const form=editRow(f);form.children[1].children[0].value='0';form.children[2].children[0].value='0.9';finishRow(form);
  f.e['audio-toggle'].onclick();assert.equal(f.e['review-audio'].paused,false);
  f.e.captions.scrollTop=200;f.e['page-next'].onclick();
  assert.equal(f.e['review-audio'].paused,true);
  assert.equal(f.e['page-info'].textContent,'6-10 of 11 captions');
  assert.match(f.e.captions.children[0].textContent,/6/);
  assert.equal(f.e.captions.scrollTop,0);assert.equal(f.e.captions.children.length,5);
  f.e['review-audio'].emit('timeupdate');
  assert.equal(f.e['page-info'].textContent,'6-10 of 11 captions');
  f.e['page-next'].onclick();assert.equal(f.e['page-info'].textContent,'11-11 of 11 captions');
  assert.equal(f.e['page-next'].disabled,true);
  f.e['page-prev'].onclick();f.e['page-prev'].onclick();
  assert.equal(f.e['page-info'].textContent,'1-5 of 11 captions');
  assert.equal(f.e['page-prev'].disabled,true);
});

test('Delete key still removes rows with compact caption actions',async()=>{
  const f=await timedPanel();f.e['view-review'].onclick();
  f.doc.handlers.keydown[0]({key:'Delete',target:{tagName:'DIV'},preventDefault(){},stopPropagation(){}});
  assert.equal(f.e.transcript.value,'');assert.equal(f.e['selected-editor'].childElementCount,0);
});

test('document Delete shortcut removes the clicked selection after its row is rendered again',()=>{
  const f=panel();f.e['view-review'].onclick();
  f.e.transcript.value='first\nsecond\nthird';f.e.rebuild.onclick();
  f.e.captions.children[1].onclick();
  const event={key:'Delete',target:{tagName:'DIV'},preventDefault(){},stopPropagation(){}};
  f.doc.handlers.keydown[0]({...event,target:{tagName:'INPUT'}});
  assert.equal(f.e.transcript.value,'first\nsecond\nthird');
  f.doc.handlers.keydown[0](event);
  assert.equal(f.e.transcript.value,'first\nthird');
  f.doc.handlers.keydown[0]({...event,repeat:true});
  assert.equal(f.e.transcript.value,'first\nthird');
});

test('double clicking edits a caption inline; Enter saves and Escape cancels',async()=>{
  const f=await timedPanel();
  f.e.captions.children[0].onclick();f.e.captions.children[0].onclick();
  const form=()=>f.e.captions.children[0].children[0];
  assert.equal(form().className,'inline-caption-editor');
  const key=key=>({key,preventDefault(){},stopPropagation(){}});
  form().children[0].value='inline correction';
  form().children[1].children[0].value='0.2';
  form().children[2].children[0].value='0.8';
  form().handlers.keydown[0](key('Enter'));
  assert.equal(f.e.transcript.value,'inline correction');
  const check=editRow(f);assert.equal(check.children[1].children[0].value,'0.2');assert.equal(check.children[2].children[0].value,'0.8');
  check.handlers.keydown[0](key('Escape'));
  f.e.captions.children[0].handlers.dblclick[0]();
  form().children[0].value='discard this';form().handlers.keydown[0](key('Escape'));
  assert.equal(f.e.transcript.value,'inline correction');
  f.e.captions.children[0].handlers.dblclick[0]();
  form().children[2].children[0].value='0.1';form().handlers.keydown[0](key('Enter'));
  assert.match(form().children[3].textContent,/valid/);
  assert.equal(f.e.transcript.value,'inline correction');
});

test('double clicking playback preview edits current caption text and timing',async()=>{
  const f=await timedPanel(),audio=f.e['review-audio'];audio.currentTime=.5;
  f.e['subtitle-preview'].handlers.dblclick[0]();
  assert.equal(audio.paused,true);assert.equal(f.e['subtitle-text'].hidden,true);
  const form=f.e['preview-editor'].children[0];
  form.children[0].value='preview correction';form.children[1].children[0].value='0.2';form.children[2].children[0].value='0.8';finishRow(form);
  assert.equal(f.e.transcript.value,'preview correction');
  assert.equal(f.e['preview-editor'].hidden,true);assert.equal(f.e['subtitle-text'].hidden,false);
  assert.equal(f.e['subtitle-text'].textContent,'preview correction');
  f.e['subtitle-preview'].handlers.dblclick[0]();
  const cancelled=f.e['preview-editor'].children[0];cancelled.children[0].value='discard';
  cancelled.handlers.keydown[0]({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(f.e.transcript.value,'preview correction');
  audio.currentTime=0;f.e['subtitle-preview'].handlers.dblclick[0]();
  assert.equal(f.e['preview-editor'].hidden,true);assert.match(f.e.notice.textContent,/Seek to a caption/);
});

test('Apply grouping stays visible before timing and after caption edits',async()=>{
  const f=panel();
  assert.equal(f.e['apply-grouping'].hidden,false);assert.equal(f.e['apply-grouping'].disabled,true);
  assert.equal(f.e['grouping-status'].hidden,false);
  const timed=await timedPanel();assert.equal(timed.e['apply-grouping'].disabled,false);
  const form=editRow(timed);form.children[0].value='corrected';finishRow(form);
  assert.equal(timed.e['apply-grouping'].hidden,false);assert.equal(timed.e['apply-grouping'].disabled,false);
  assert.equal(timed.e['grouping-status'].hidden,false);
  assert.match(timed.e['grouping-status'].textContent,/Update timing/);
});

test('Apply grouping updates all caption views after transcription and after edits',async()=>{
  const f=panel();let alignments=0;
  f.host.transcribeAudio=async()=>({fullText:'one two three four five six',model:'gemini'});
  f.host.alignAudio=async(path,text)=>{
    alignments++;
    return {schemaVersion:1,audioSha256:core.sha256(wav()),fullText:text,engine:'kfa-local',directAlignment:true,
      words:text.split(/\s+/).map((text,i)=>({text,startMs:i*140,endMs:i*140+100}))};
  };
  await f.e['choose-audio'].onclick();await f.e.generate.onclick();
  f.e['caption-length'].value='word';await f.e['apply-grouping'].onclick();
  assert.equal(alignments,1);assert.equal(f.e.counts.textContent,'6 captions');
  assert.equal(f.e['page-info'].textContent,'1-5 of 6 captions');
  f.e['review-audio'].currentTime=.05;f.e['review-audio'].emit('timeupdate');
  assert.equal(f.e['subtitle-text'].textContent,'one');
  f.e['caption-length'].value='sentence';await f.e['apply-grouping'].onclick();
  assert.equal(alignments,1);assert.equal(f.e.counts.textContent,'1 captions');
  assert.equal(f.e['subtitle-text'].textContent,'one two three four five six');
  const form=editRow(f);form.children[0].value='ONE two three four five six';finishRow(form);
  f.e['caption-length'].value='word';await f.e['apply-grouping'].onclick();
  assert.equal(alignments,2);assert.equal(f.stats().transcriptions,0);
  assert.equal(f.e.counts.textContent,'6 captions');assert.equal(f.e['subtitle-text'].textContent,'ONE');
  assert.equal(f.e.export.disabled,true);assert.match(f.e['approval-summary'].textContent,/0 of 6 approved/);
});

test('both caption editors provide Save changes without duplicate caption text',async()=>{
  const f=await timedPanel();let form=editRow(f);
  assert.equal(form.children[4].textContent,'Save changes');
  form.children[0].value='row save';
  assert.equal(form.children.length,5);
  form.children[4].onclick();assert.equal(f.e.transcript.value,'row save');
  f.e['review-audio'].currentTime=.5;f.e['subtitle-preview'].handlers.dblclick[0]();
  form=f.e['preview-editor'].children[0];assert.equal(form.children[4].textContent,'Save changes');
  form.children[0].value='';form.children[4].onclick();assert.match(form.children[3].textContent,/wording/);
  form.children[0].value='preview save';form.children[4].onclick();
  assert.equal(f.e.transcript.value,'preview save');assert.equal(f.e['preview-editor'].hidden,true);
});

test('compact actions contain only approve and previous/next caption controls',()=>{
  const f=panel();f.e.transcript.value='first\nsecond\nthird';f.e.rebuild.onclick();
  const actions=()=>f.e['selected-editor'].children[0];
  const navigation=()=>actions().children[1].children;
  assert.equal(actions().children.length,2);assert.equal(actions().children[0].textContent,'Approve caption');
  assert.equal(navigation()[0].disabled,true);
  navigation()[1].onclick();assert.equal(navigation()[0].disabled,false);
  navigation()[1].onclick();assert.equal(navigation()[1].disabled,true);
  navigation()[0].onclick();assert.equal(f.e.transcript.value,'first\nsecond\nthird');
});
test('timeline selection cannot replace existing transcript and failure preserves uploaded audio',async()=>{
  const f=panel();await f.e['choose-audio'].onclick();
  f.timeline.chooseTimelineAudio=async()=>{throw new Error('Render failed');};
  await f.e['choose-timeline'].onclick();assert.equal(f.e['audio-name'].textContent,'upload.wav');assert.equal(f.e.generate.disabled,false);
  f.e.transcript.value='Keep these edits';await f.e['choose-timeline'].onclick();
  assert.match(f.e.notice.textContent,/Save your draft/);assert.equal(f.e.transcript.value,'Keep these edits');
});
test('timeline audio uses existing Gemini/KFA flow and exports captions at the range start',async()=>{
  const f=panel(),saved=[];
  f.host.alignAudio=async(wavPath,text)=>({schemaVersion:1,audioSha256:core.sha256(wav()),fullText:text,
    engine:'kfa-local',directAlignment:true,words:[{text,startMs:100,endMs:900}]});
  f.host.saveText=async(name,text)=>{saved.push({name,text});return true;};
  await f.e['choose-timeline'].onclick();await f.e.generate.onclick();
  assert.equal(f.stats().transcriptions,1);assert.equal(f.e.transcript.value,'hello');
  f.e['approve-all'].onclick();assert.equal(f.e.export.disabled,false);
  await f.e.export.onclick();assert.match(saved[0].text,/00:00:10,100 --> 00:00:10,900/);
});

async function timedPanel(){
  const f=panel();
  f.host.alignAudio=async(wavPath,text)=>({schemaVersion:1,audioSha256:core.sha256(wav()),fullText:text,
    engine:'kfa-local',directAlignment:true,words:[{text,startMs:100,endMs:900}]});
  await f.e['choose-audio'].onclick();await f.e.generate.onclick();return f;
}

test('failed automatic timing exposes the preserved transcript and allows timing retry',async()=>{
  const f=panel();await f.e['choose-audio'].onclick();await f.e.generate.onclick();
  assert.equal(f.e.transcript.value,'hello');assert.equal(f.e['review-page'].hidden,false);
  assert.match(f.e['timing-status'].textContent,/Transcript preserved/);assert.equal(f.e.export.disabled,true);
  f.host.alignAudio=async(wavPath,text)=>({schemaVersion:1,audioSha256:core.sha256(wav()),fullText:text,
    engine:'kfa-local',directAlignment:true,words:[{text,startMs:100,endMs:900}]});
  await f.e['align-now'].onclick();f.e['approve-all'].onclick();assert.equal(f.e.export.disabled,false);
  assert.equal(f.stats().transcriptions,1);
});

test('transcript edits block export and invalidate approval and old timing',async()=>{
  const f=await timedPanel();f.e['approve-all'].onclick();assert.equal(f.e.export.disabled,false);
  f.e.transcript.value='changed wording';f.e.transcript.oninput();assert.equal(f.e.export.disabled,true);
  f.e.rebuild.onclick();assert.equal(f.e.export.disabled,true);
  await f.e['align-now'].onclick();assert.equal(f.e.export.disabled,true);
  f.e['approve-all'].onclick();assert.equal(f.e.export.disabled,false);
});

test('regrouping uses existing alignment and resets approval',async()=>{
  const f=await timedPanel();f.e['approve-all'].onclick();
  f.host.alignAudio=async()=>{throw new Error('Regrouping must not call KFA');};
  f.e['caption-length'].value='word';await f.e['apply-grouping'].onclick();
  assert.equal(f.e.export.disabled,true);assert.match(f.e['grouping-status'].textContent,/timing was reused/);
  f.e['approve-all'].onclick();assert.equal(f.e.export.disabled,false);
});

test('draft round trip restores timing and offset but requires renewed approval',async()=>{
  const f=await timedPanel();let draft;
  f.e.offset.value='12.5';f.e['approve-all'].onclick();
  f.host.saveText=async(name,text)=>{draft=JSON.parse(text);return true;};
  await f.e['save-draft'].onclick();assert.equal(draft.captions[0].approved,true);
  await f.e.clear.onclick();f.host.openJson=async()=>draft;await f.e['load-draft'].onclick();
  assert.equal(f.e.transcript.value,'hello');assert.equal(f.e.offset.value,'12.5');assert.equal(f.e.export.disabled,true);
  f.e['approve-all'].onclick();assert.equal(f.e.export.disabled,false);
});

test('cancelled draft save never reports that the draft was saved',async()=>{
  const f=await timedPanel();f.host.saveText=async()=>false;
  await f.e['save-draft'].onclick();assert.equal(f.e.notice.textContent,'Draft save cancelled.');
});

test('mismatched draft is rejected without replacing current workspace',async()=>{
  const f=panel();await f.e['choose-audio'].onclick();
  f.host.openJson=async()=>({schemaVersion:1,kind:'sthang-gemini-kfa-caption-draft',source:{sha256:'wrong'}});
  await f.e['load-draft'].onclick();assert.match(f.e.notice.textContent,/does not match/);
  assert.equal(f.e.transcript.value,'');assert.equal(f.e['audio-name'].textContent,'upload.wav');
});

test('cancelled transcription unlocks the UI and preserves the selected recording',async()=>{
  const f=panel();await f.e['choose-audio'].onclick();
  f.host.transcribeAudio=async(audio,token)=>{f.e.cancel.onclick();token.check();};
  await f.e.generate.onclick();assert.match(f.e.notice.textContent,/Cancelled/);
  assert.equal(f.e.transcript.value,'');assert.equal(f.e.generate.disabled,false);
  assert.equal(f.e.processing.hidden,true);assert.equal(f.e['audio-name'].textContent,'upload.wav');
});

test('invalid offset blocks export and clearing twice releases timeline audio',async()=>{
  const f=await timedPanel();f.e['approve-all'].onclick();
  f.e.offset.value='invalid';f.e.offset.oninput();assert.equal(f.e.export.disabled,true);
  f.e.offset.value='0';f.e.offset.oninput();assert.equal(f.e.export.disabled,false);
  await f.e.clear.onclick();assert.equal(f.e.transcript.value,'');assert.equal(f.e.generate.disabled,false);
  await f.e['choose-timeline'].onclick();await f.e.clear.onclick();
  assert.equal(f.stats().released,1);assert.equal(f.e.generate.disabled,true);assert.equal(f.e.offset.value,'0');
});

function editRow(f,index=0){
  f.e.captions.children[index].handlers.dblclick[0]();
  return f.e.captions.children[index].children[0];
}
function finishRow(form){form.handlers.keydown[0]({key:'Enter',preventDefault(){},stopPropagation(){}});}
