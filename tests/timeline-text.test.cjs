const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),zlib=require('node:zlib');
const core=require('../local-core.js');
const template=require('../presets/text-layer-template.json');
const code=fs.readFileSync(path.join(__dirname,'../timeline-text.js'),'utf8');
function load(ppro,storage){
  const context={LocalCaptionCore:core,require(name){if(name==='premierepro')return ppro;if(name==='uxp'&&storage)return {storage};throw Error(name);}};
  vm.runInNewContext(code,context);return context.TimelineTextHost;
}
const api=load(null,null),ticks=254016000000,frame=ticks/25;
const rows=[{id:1,text:'សួស្តី ខ្មែរ 😀 <&>',start:100,end:900,approved:true},{id:2,text:'Second caption',start:1000,end:1800,approved:true}];
// Read the stored ZIP entries independently and use Node's gzip decoder to
// check the complete native project payload (including its checksum).
function unzip(buffer){
  const b=Buffer.from(buffer),files={};let at=0;
  while(b.readUInt32LE(at)===0x04034b50){
    assert.equal(b.readUInt16LE(at+8),0);
    const length=b.readUInt32LE(at+18),nameLength=b.readUInt16LE(at+26),extra=b.readUInt16LE(at+28);
    const name=b.toString('utf8',at+30,at+30+nameLength),start=at+30+nameLength+extra;
    files[name]=b.subarray(start,start+length);at=start+length;
  }
  assert.equal(b.readUInt32LE(at),0x02014b50);return files;
}
function inspect(buffer){
  const files=unzip(buffer),definition=JSON.parse(files['definition.json']);
  const inner=unzip(files['project.prgraphic']),project=zlib.gunzipSync(inner['caption.prproj']).toString('utf8');
  const payload=Buffer.from(project.match(/<StartKeyframeValue Encoding="base64">([^<]+)</)[1],'base64');
  assert.equal(payload.readUInt32LE(0),payload.length-8);
  return {definition,project,text:JSON.parse(payload.subarray(8).toString('utf16le'))};
}
function fixture(options={}){
  const imports=[],files=[],deleted=[],actions=[],events=[],rootItems=[],trackItems=[];
  let trackCount=3;
  const sequence={guid:'sequence',async getTimebase(){return String(frame);},async getVideoTrackCount(){return trackCount;},
    async getVideoTrack(index){if(index>=trackCount)throw Error('Invalid parameter.');return {getTrackItems(){return trackItems[index]||[];}};}};
  const rootItem={async getItems(){return rootItems;},createRemoveItemAction(item){return()=>{rootItems.splice(rootItems.indexOf(item),1);events.push('remove-project-item');};}};
  let reads=0,locked=false;
  const project={guid:'project',async getActiveSequence(){reads++;return options.noSequence?null:options.changeSequence&&reads>2?{guid:'other'}:sequence;},
    async getRootItem(){return rootItem;},
    async importFiles(paths,suppressUI,parent,numbered){assert.equal(parent,rootItem);assert.equal(numbered,false);const name=paths[0].split('\\').pop();rootItems.push({name,getId(){return name;}});events.push('import-placeholder');return true;},
    lockedAccess(fn){locked=true;try{fn();}finally{locked=false;}},executeTransaction(fn,label){assert.equal(locked,true);if(options.trimFailure&&label==='Set caption text layer timing')return false;if(options.trackFailure&&label==='Create caption text track')return false;fn({addAction(action){action();}});return true;}};
  const editor={insertMogrtFromPath(file,time,video,audio){
    assert.equal(locked,true);if(video>=trackCount)throw Error('Invalid parameter.');if(options.insertFailure)return [];
    assert.equal((trackItems[video]||[]).length,0);events.push('insert-mogrt');
    const imported={file,time,video,audio,end:null};imports.push(imported);
    return [{createSetEndAction(end){return()=>{imported.end=end;};},createSetNameAction(name){return()=>{imported.name=name;actions.push(name);};},
      async getStartTime(){return time;},async getEndTime(){return options.wrongTiming?{ticks:'0'}:imported.end;}}];
  },createInsertProjectItemAction(item,time,index,audio,limitShift){
    assert.equal(locked,true);assert.equal(index,trackCount);assert.equal(limitShift,true);
    return()=>{trackCount++;trackItems[index]=[{async getProjectItem(){return item;}}];events.push('create-track');};
  },createRemoveItemsAction(selection,ripple,media,shift){
    assert.equal(ripple,false);assert.equal(shift,false);
    return()=>{for(let i=0;i<trackItems.length;i++)trackItems[i]=(trackItems[i]||[]).filter(item=>!selection.items.includes(item));events.push('remove-placeholder');};
  }};
  const storage={formats:{binary:'binary'},localFileSystem:{
    async getPluginFolder(){return {async getEntry(name){return {async read(){return name.endsWith('.png')?new Uint8Array([1,2,3]).buffer:JSON.stringify(template);}};}};},
    async getDataFolder(){return {async createFolder(name){return {async createFile(name){const file={name,nativePath:'C:\\data\\'+name,async write(bytes){if(name.endsWith('.mogrt')){files.push(bytes);if(options.onWrite)options.onWrite();}},async delete(){}};return file;},async delete(){deleted.push(name);}};}};}
  }};
  const ppro={Project:{async getActiveProject(){return project;}},SequenceEditor:{getEditor(){return editor;}},TickTime:{TIME_ZERO:{ticks:'0'},createWithTicks(value){return {ticks:value};}},
    ProjectItem:{cast(value){return value;}},Constants:{TrackItemType:{CLIP:1},MediaType:{VIDEO:'video'}},TrackItemSelection:{createEmptySelection(fn){fn({items:[],addItem(item){this.items.push(item);}});return true;}}};
  return {api:load(ppro,storage),imports,files,deleted,actions,events,rootItems};
}
test('generated MOGRTs carry independent native Khmer text, style, identities and duration',()=>{
  const first=inspect(api.makeTemplate(template,rows[0].text,ticks)),second=inspect(api.makeTemplate(template,'Different',2*ticks));
  assert.equal(first.text.mTextParam.mStyleSheet.mText,rows[0].text);
  assert.equal(first.text.mTextParam.mIndic,true);
  assert.equal(first.text.mTextParam.mStyleSheet.mFontName.mParamValues[0][1],'LeelawadeeUI');
  assert.equal(first.definition.clientControls[0].value.strDB[0].str,rows[0].text);
  assert.notEqual(first.definition.capsuleID,second.definition.capsuleID);
  assert.notEqual(first.definition.sourceInfoLocalized.en_US.id,second.definition.sourceInfoLocalized.en_US.id);
  assert.ok(first.project.includes('ObjectUID="'+first.definition.sourceInfoLocalized.en_US.id+'"'));
  assert.match(first.project,new RegExp('<End>'+ticks+'</End>'));
  assert.match(second.project,new RegExp('<End>'+2*ticks+'</End>'));
  assert.deepEqual(first.definition.sourceInfoLocalized.en_US.duration,{scale:1,value:1});
  assert.equal(first.project.includes('{{'),false);
  assert.equal(first.project.includes('Your Title Here'),false);
  assert.equal(second.text.mTextParam.mStyleSheet.mText,'Different');
  assert.equal(inspect(api.makeTemplate(template,'Line one\nខ្មែរ',ticks)).text.mTextParam.mStyleSheet.mText,'Line one\rខ្មែរ');
});
test('large text payload crosses gzip blocks without breaking Unicode',()=>{
  const text=rows[0].text.repeat(3000);assert.equal(inspect(api.makeTemplate(template,text,ticks)).text.mTextParam.mStyleSheet.mText,text);
});
test('placement snaps caption timing and offset to sequence frames without adding timecode zero',()=>{
  const plan=api.plan(rows,2000,10000,String(frame));
  assert.deepEqual(Array.from(plan,r=>[r.start,r.end]),[[253*frame,273*frame],[275*frame,295*frame]]);
  assert.equal(api.plan(rows,2000,86400000,String(frame))[0].start,(2160000+3)*frame);
  for(const invalid of [[rows,2000,-1,frame],[rows,2000,0,0],[rows.map(r=>({...r,approved:false})),2000,0,frame],[[{...rows[0],start:1,end:2}],2000,0,frame]])assert.throws(()=>api.plan(...invalid));
});
test('host creates every caption on a new track, sets exact timing and preserves generated source files',async()=>{
  const f=fixture(),result=await f.api.generate(rows,2000,10000);
  assert.equal(result.count,2);assert.equal(result.track,4);assert.equal(f.imports.length,2);
  assert.ok(f.imports.every(i=>i.video===3&&i.audio===0));
  assert.equal(f.imports[0].time.ticks,String(253*frame));assert.equal(f.imports[0].end.ticks,String(273*frame));
  assert.equal(f.actions.length,2);assert.equal(f.deleted.length,0);
  assert.deepEqual(f.events.slice(0,5),['import-placeholder','create-track','remove-placeholder','remove-project-item','insert-mogrt']);
  assert.equal(f.rootItems.length,0);
  assert.equal(inspect(f.files[0]).text.mTextParam.mStyleSheet.mText,rows[0].text);
  assert.equal(inspect(f.files[1]).text.mTextParam.mStyleSheet.mText,rows[1].text);
});
test('invalid captions, subframe timing, unavailable host and no active sequence fail before insertion',async()=>{
  const f=fixture();await assert.rejects(f.api.generate(rows.map(r=>({...r,approved:false})),2000,0),/No text layers were inserted/);assert.equal(f.files.length,0);
  await assert.rejects(fixture({noSequence:true}).api.generate(rows,2000,0),/Open the sequence/);
  await assert.rejects(api.generate(rows,2000,0),/inside Premiere/);
});
test('cancel before insertion removes unused files; partial cancellation accurately reports inserted clips',async()=>{
  const before=core.cancellation(),f=fixture({onWrite(){before.cancel();}});
  await assert.rejects(f.api.generate(rows,2000,0,before),/Generation cancelled.*No text layers were inserted/);
  assert.equal(f.imports.length,0);assert.equal(f.deleted.length,1);
  const token=core.cancellation(),partial=fixture();
  await assert.rejects(partial.api.generate(rows,2000,0,token,message=>{if(message.includes('2 of'))token.cancel();}),/1 text clip\(s\) were inserted on V4/);
  assert.equal(partial.imports.length,1);assert.equal(partial.deleted.length,0);
});
test('failed insertion or timing and sequence changes stop generation with accurate partial results',async()=>{
  const empty=fixture({insertFailure:true});await assert.rejects(empty.api.generate(rows,2000,0),/No text layers were inserted/);assert.equal(empty.deleted.length,1);
  for(const options of [{trimFailure:true},{wrongTiming:true},{changeSequence:true}]){
    const f=fixture(options);await assert.rejects(f.api.generate(rows,2000,0),/1 text clip\(s\) were inserted on V4/);assert.equal(f.imports.length,1);
  }
});
test('failed track creation cleans its own imported placeholder and never attempts MOGRT insertion',async()=>{
  const f=fixture({trackFailure:true});await assert.rejects(f.api.generate(rows,2000,0),/Create text track.*No text layers were inserted/);
  assert.equal(f.imports.length,0);assert.equal(f.rootItems.length,0);
});
