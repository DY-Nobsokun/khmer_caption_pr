'use strict';
(function(root) {
  try {
  const core=root.LocalCaptionCore,host=root.LocalCaptionHost,$=id=>document.getElementById(id);
  let source=null,media=null,captions=[],active=null,pendingEdits=false,selected=1,resultModel='',page=0,wordAnchors=[],appliedGroupingMode='short';
  const createButton=()=>root.PanelControls?root.PanelControls.createButton(document):document.createElement('div');
  const pageSize=12;
  let currentView='generate';
  let player=null;
  // Bind navigation before optional playback or artwork can fail to initialize.
  for(const view of ['generate','review','export']){
    const button=$('view-'+view);
    const activate=()=>{if(!active)showView(view);};
    button.onclick=activate;
  }
  showView('generate');
  try{if(root.CaptionPlayback)player=root.CaptionPlayback.create({document,notice,onFrame:followPlayback});}catch(error){console.warn('Audio review initialization:',error);$('playback-state').textContent='Playback unavailable';$('playback-help').textContent='Audio player could not start: '+String(error&&error.message||error);}
  function showView(view){
    currentView=view;
    for(const name of ['generate','review','export']){
      const panel=$(name+'-page'),visible=name===view;
      panel.hidden=!visible;
      panel.setAttribute('aria-hidden',String(!visible));
      panel.setAttribute('style',visible?'display:block':'display:none');
    }
    for(const name of ['generate','review','export'])$('view-'+name).setAttribute('aria-pressed',String(name===view));
    if(root.PanelControls){try{root.PanelControls.refresh();}catch(error){console.warn('Navigation artwork:',error);}}
    if(player)player.pause();
  }
  function followPlayback(c){
    document.querySelectorAll('.caption-row').forEach(row=>{row.setAttribute('data-playing',String(!!c&&row.id==='row-'+c.id));});
    if(!$('audio-follow').checked||!c)return;
    const focused=document.activeElement;
    if(focused&&['INPUT','TEXTAREA'].includes(focused.tagName)&&focused.id!=='audio-seek')return;
    const index=filtered().findIndex(row=>row.id===c.id);
    if(index>=0&&Math.floor(index/pageSize)!==page){page=Math.floor(index/pageSize);render();}
    const row=$('row-'+c.id),list=$('captions');
    if(row&&Number.isFinite(row.offsetTop)&&Number.isFinite(list.offsetTop)){
      const top=row.offsetTop-list.offsetTop;
      if(top<list.scrollTop||top+row.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=Math.max(0,top);
    }
  }
  const filtered=()=>captions.filter(c=>!$('only-review').checked||!c.approved);
  const setText=(id,value)=>{const el=$(id);if(el.textContent!==value)el.textContent=value;};
  function notice(value){$('notice').textContent=value;}
  const fieldText=el=>String(el.value==null?'':el.value);
  const transcript=()=>fieldText($('transcript')).trim();
  function offset(){const raw=fieldText($('offset')).trim(),n=Number(raw)*1000;if(!raw||!Number.isFinite(n)||n<0||n>86400000)throw new Error('Enter a start offset from 0 to 86,400 seconds.');return Math.round(n);}
  const groupingMode=()=>core.groupingModes.includes($('caption-length').value)?$('caption-length').value:'short';
  function invalidateAnchors(message){wordAnchors=[];$('grouping-status').textContent=message;}
  function applyGroups(){
    if(!source||!wordAnchors.length)throw new Error('Run Update timing to obtain word timings before regrouping.');
    if(pendingEdits)throw new Error('Apply transcript edits and update timing before regrouping.');
    const mode=groupingMode(),grouped=core.groupCaptions(wordAnchors,mode,source.durationMs);
    captions=grouped;appliedGroupingMode=mode;$('transcript').value=captions.map(c=>c.text).join('\n');page=0;selected=1;
    $('grouping-status').textContent=`${captions.length} captions grouped. Review and approve again. Word timing was reused.`;
  }
  function summary(){
    if(player){try{player.update(captions,selected,!!active||pendingEdits);}catch(error){console.warn('Audio review update:',error);try{player.dispose();}catch(_){}player=null;$('playback-state').textContent='Playback unavailable';}}
    $('view-generate').setAttribute('data-complete',String(captions.length>0));
    $('view-review').setAttribute('data-complete',String(captions.length>0&&captions.every(c=>c.approved)));
    $('choose-timeline').disabled=!!active||!root.TimelineAudioHost||!root.TimelineAudioHost.available;
    $('apply-grouping').disabled=!!active||pendingEdits||!wordAnchors.length;
    $('apply-grouping').hidden=!wordAnchors.length;
    $('grouping-status').hidden=!wordAnchors.length;
    $('counts').textContent=`${captions.length} captions`;
    $('approval-summary').textContent=`${captions.filter(c=>c.approved).length} of ${captions.length} approved · ${captions.filter(c=>c.start===null||c.end===null).length} need timing`;
    $('next').disabled=!!active||pendingEdits||!captions.some(c=>!c.approved);
    $('approve-all').disabled=!!active||pendingEdits||!captions.length||captions.every(c=>c.approved);
    $('generate').disabled=!!active||!media||!media.path;
    $('export').disabled=true;
    try{if(!source||pendingEdits)throw new Error();offset();core.validateCaptions(captions,source.durationMs);$('export').disabled=!!active;}catch(_){}
    if(root.PanelControls){try{root.PanelControls.refresh();}catch(error){console.warn('Control artwork:',error);}}
  }
  function busy(value){if(value&&player)player.pause();document.querySelectorAll('.ui-button,input,select,textarea').forEach(el=>{el.disabled=value;});$('processing').hidden=!value;$('cancel').disabled=!value;summary();}
  async function job(fn){
    if(active)return;
    const token=core.cancellation();active=token;
    try{setText('stage','Working…');busy(true);await fn(token);}catch(e){
      const message=(e&&e.name)==='AbortError'?'Cancelled. Available transcript preserved. A request already received by Google may still be processed or billed.':core.errorMessage(e);
      notice(message);$('media-status').textContent=message;console.error('Caption operation:',e);
    }
    finally{active=null;try{busy(false);render();}catch(error){notice(core.errorMessage(error));$('media-status').textContent=core.errorMessage(error);console.error('Caption controls:',error);}}
  }
  function safe(fn){return()=>job(fn);}
  function approve(c){
    if(pendingEdits)throw new Error('Apply transcript edits before approving.');
    if(!source)throw new Error('Choose matching audio first.');
    if(!c.text.trim())throw new Error('Enter caption wording before approving.');
    if(c.start===null||c.end===null)throw new Error('Enter start and end times in seconds, or import KFA timing, before approving.');
    core.validateCaptions([{...c,approved:true}],source.durationMs);
    const i=captions.indexOf(c),before=captions[i-1],after=captions[i+1];
    if((before&&before.end!==null&&c.start<before.end)||(after&&after.start!==null&&c.end>after.start))throw new Error('Adjust overlapping caption times.');
    c.approved=true;selected=(captions.find(x=>!x.approved)||c).id;page=Math.floor(Math.max(0,filtered().findIndex(x=>x.id===selected))/pageSize);render();notice(`Caption ${c.id} approved.`);
  }
  function render(){
    const list=$('captions');list.textContent='';
    const editor=$('selected-editor');editor.textContent='';
    const visible=filtered();const pageCount=Math.max(1,Math.ceil(visible.length/pageSize));page=Math.max(0,Math.min(page,pageCount-1));
    $('page-prev').disabled=!!active||page===0;$('page-next').disabled=!!active||page>=pageCount-1;
    $('page-info').textContent=visible.length?`${page*pageSize+1}-${Math.min((page+1)*pageSize,visible.length)} of ${visible.length} captions`:'No captions';
    for(const c of visible.slice(page*pageSize,(page+1)*pageSize)){
      const compact=createButton();compact.className='ui-button caption-row'+(c.id===selected?' selected':'');compact.id='row-'+c.id;compact.disabled=!!active;
      compact.setAttribute('aria-pressed',String(c.id===selected));
      compact.textContent=`${c.approved?'✓':'○'}  ${c.id}   ${c.start===null?'—':formatTime(c.start)} – ${c.end===null?'—':formatTime(c.end)}   ${c.text}`;
      compact.onclick=()=>{selected=c.id;render();if(player&&c.start!==null)player.seek(c.start/1000);};list.appendChild(compact);
    }
    const chosen=captions.find(c=>c.id===selected)||visible[0];
    if(chosen){selected=chosen.id;}
    for(const c of chosen?[chosen]:[]){
      const row=document.createElement('article');row.className='caption'+(c.id===selected?' selected':'');
      const title=document.createElement('h2');title.textContent=`Edit caption #${c.id}`;row.appendChild(title);
      const meta=document.createElement('div');meta.className='caption-meta';
      const number=document.createElement('span');number.className='caption-number';number.textContent=String(c.id).padStart(2,'0');
      const state=document.createElement('span');state.className='review-state'+(c.approved?' approved':'');state.textContent=c.approved?'Approved':c.start===null||c.end===null?'Needs timing':'Needs review';meta.appendChild(number);meta.appendChild(state);
      const text=document.createElement('textarea');text.lang='km';text.rows=2;text.value=c.text;text.setAttribute('aria-label',`Caption ${c.id} text`);
      const times=document.createElement('div');times.className='times';const fields={};
      const button=createButton();button.className='ui-button approve';button.textContent='Approve wording & timing';button.disabled=!!active||c.approved||pendingEdits;
      const retime=createButton();retime.className='ui-button retime';retime.textContent='Update timing';retime.disabled=!!active||pendingEdits;
      retime.onclick=()=>{$('align-now').onclick();};
      const feedback=document.createElement('p');feedback.className='caption-feedback';feedback.setAttribute('role','status');
      feedback.textContent=pendingEdits?'Apply transcript edits above before approving.':c.start===null||c.end===null?'Enter start and end in seconds (for example 0 and 2.5), or import KFA timing.':'';
      const changed=()=>{if(player)player.pause();c.approved=false;state.textContent=c.start===null||c.end===null?'Needs timing':'Needs review';state.className='review-state';button.disabled=!!active||pendingEdits;feedback.textContent=c.start===null||c.end===null?'Edits saved in this workspace. Enter both times or Update timing before approving.':'Edits saved in this workspace. Review wording and times, then approve.';const compact=$('row-'+c.id);if(compact)compact.textContent=`○  ${c.id}   ${c.start===null?'—':formatTime(c.start)} – ${c.end===null?'—':formatTime(c.end)}   ${c.text}`;summary();};
      for(const name of ['start','end']){
        const field=document.createElement('div');field.className='timing-field';
        const label=document.createElement('label');label.textContent=name==='start'?'Start (seconds)':'End (seconds)';
        const input=document.createElement('input');input.type='text';input.disabled=!!active;input.setAttribute('inputmode','decimal');input.className='timing-input';input.id=`caption-${c.id}-${name}`;label.setAttribute('for',input.id);input.setAttribute('aria-label',`Caption ${c.id} ${name} in seconds`);input.placeholder=name==='start'?'e.g. 0.000':'e.g. 2.500';input.value=c[name]===null?'':String(c[name]/1000);fields[name]=input;
        input.oninput=()=>{invalidateAnchors('Timing edited. Update timing before changing caption length.');const raw=fieldText(input).trim(),n=Number(raw);c[name]=raw&&Number.isFinite(n)&&n>=0?Math.round(n*1000):null;c.timingSource='manual';changed();};
        const shell=document.createElement('div');shell.className='field-shell';input.setAttribute('uxp-quiet','true');shell.appendChild(input);
        field.appendChild(label);field.appendChild(shell);times.appendChild(field);
      }
      text.oninput=()=>{invalidateAnchors('Wording edited. Update timing before changing caption length.');c.text=fieldText(text);c.start=null;c.end=null;c.timingSource='missing';fields.start.value='';fields.end.value='';$('transcript').value=captions.map(x=>x.text).join('\n');changed();};
      text.disabled=!!active||pendingEdits;
      text.onfocus=()=>{selected=c.id;};
      button.onclick=()=>{try{approve(c);}catch(e){feedback.textContent=core.errorMessage(e);notice(core.errorMessage(e));}};
      row.appendChild(meta);row.appendChild(text);row.appendChild(times);row.appendChild(button);row.appendChild(retime);row.appendChild(feedback);editor.appendChild(row);
    }
    if(!list.childElementCount){const p=document.createElement('p');p.className='helper';p.textContent=captions.length?'All captions approved. Turn off the filter to see them.':'Transcribe audio or enter a transcript to begin.';list.appendChild(p);}
    summary();
  }
  function formatTime(ms){const s=Math.max(0,Math.round(ms));return String(Math.floor(s/60000)).padStart(2,'0')+':'+String(Math.floor(s/1000)%60).padStart(2,'0')+'.'+String(s%1000).padStart(3,'0');}
  async function release(file){if(file&&file.dispose){try{await file.dispose();}catch(_){}}}
  async function selectAudio(token,fromTimeline){
    if(transcript()||captions.length)throw new Error('Save your draft and clear the workspace before changing audio.');
    let file;
    $('media-status').textContent=fromTimeline?'Preparing the active sequence In/Out range...':'Choose a WAV or MP4 recording...';
    try {
      const prepare=fromTimeline?root.TimelineAudioHost.chooseTimelineAudio:host.chooseAudio;
      file=await prepare(token,message=>{setText('stage',message);$('media-status').textContent=message;});
    }
    catch(e) { $('media-status').textContent=(e&&e.name)==='AbortError'?'Recording preparation cancelled.':`Could not prepare recording: ${core.errorMessage(e)}`;throw e; }
    if(!file){$('media-status').textContent=source?`${source.name} is still ready.`:'No recording selected.';return;}
    try {
      token.check();
      const info=core.wavInfo(file.data),hash=await core.sha256Async(file.data,token);
      token.check();
      const wasTimeline=source&&source.kind==='timeline';
      if(player)player.reset();await release(media);media=file;
      source={name:file.name,sha256:hash,durationMs:info.durationMs};
      if(player)player.load(file,source.durationMs);
      if(file.kind==='timeline'){
        source.kind='timeline';source.timeline=file.timeline;
        $('offset').value=String(file.timeline.offsetMs/1000);
      }else if(wasTimeline){$('offset').value='0';}
      $('audio-name').textContent=file.name;
      $('audio-info').textContent=`${(info.durationMs/1000).toFixed(3)} seconds · ready`;
      $('media-status').textContent=`Ready: ${file.name}. Press Transcribe to send audio to Gemini.`;
      notice(file.kind==='timeline'?'Timeline audio ready. Start offset set from the In point. Press Transcribe to send audio to Gemini.':file.extracted?'MP4 audio extracted locally. Press Transcribe to send audio to Gemini.':'Audio ready. Press Transcribe to send audio to Gemini.');
    }catch(e){await release(file);$('media-status').textContent=`Could not prepare recording: ${core.errorMessage(e)}`;throw e;}
  }
  $('choose-audio').onclick=safe(token=>selectAudio(token,false));
  $('choose-timeline').onclick=safe(token=>selectAudio(token,true));
    async function automaticTiming(token) {
    if(!source||!media||!media.path||!transcript())throw new Error('Choose a recording and enter transcript wording first.');
    const wording=transcript();
    $('timing-status').textContent='Generating word timing with local KFA...';
    try {
      const payload=await host.alignAudio(media.path,wording,token,message=>{setText('stage',message);setText('timing-status',message);});token.check();
      const timed=core.importAlignment(payload,source,wording);token.check();
      wordAnchors=timed;pendingEdits=false;applyGroups();
      const grouped=payload.words.some(word=>word.mergedAcousticWords>1);
      $('timing-status').textContent=`KFA timing ready: ${captions.length} caption rows. ${grouped?'Some adjacent words were grouped to preserve Khmer spelling. ':''}Review and approve the wording and times.`;
      notice('Transcription and KFA timing complete. Review each caption before exporting.');showView('review');
    } catch(error) {
      $('timing-status').textContent=(error&&error.name)==='AbortError'?'Timing cancelled. Transcript preserved; no partial timing applied.':`Timing could not be generated: ${core.errorMessage(error)}. Transcript preserved.`;
      throw error;
    }
  }
  $('generate').onclick=safe(async token=>{
    if(!media||!media.path)throw new Error('Choose a WAV or MP4, or use timeline audio inside Premiere first.');
    if(transcript()||captions.length)throw new Error('Save your current draft, then clear the transcript before transcribing again.');
    let result;
    try {result=await host.transcribeAudio(media.data,token,message=>{setText('stage',message);setText('transcription-status',message);},$('api-key').value);token.check();}
    catch(error){$('transcription-status').textContent=(error&&error.name)==='AbortError'?'Transcription cancelled. Google may still process a request it already received.':core.errorMessage(error);throw error;}
    $('transcription-status').textContent='Gemini transcription complete. Generating local timing...';
    wordAnchors=[];$('transcript').value=result.fullText;captions=core.untimedCaptions(result.fullText);resultModel=result.model;pendingEdits=false;page=0;
    notice('Gemini transcript ready. Generating local KFA word timing...');showView('review');await automaticTiming(token);
  });
  $('save-key').onclick=safe(async()=>{await host.saveKey($('api-key').value);$('api-key').value='';$('key-status').textContent='API key saved in Adobe secure storage. Leave the field empty to use it.';});
  $('forget-key').onclick=safe(async()=>{await host.forgetKey();$('api-key').value='';$('key-status').textContent='Saved API key removed.';});
  host.loadKey().then(key=>{if(key){$('key-status').textContent='A key is saved in Adobe secure storage. Leave the key field empty to use it.';$('ai-connection').open=false;}}).catch(()=>{});
  $('align-now').onclick=safe(async token=>{
    if(pendingEdits){wordAnchors=[];captions=core.untimedCaptions(transcript());pendingEdits=false;}
    await automaticTiming(token);
  });
  $('cancel').onclick=()=>{if(active){active.cancel();$('cancel').disabled=true;$('stage').textContent='Cancelling… Waiting for native cleanup.';}};
  $('transcript').oninput=()=>{if(pendingEdits)return;invalidateAnchors('Wording changed. Update timing before regrouping.');pendingEdits=true;$('timing-status').textContent='Wording changed. Apply edits, then press Update timing.';captions.forEach(c=>{c.approved=false;});render();notice('Apply transcript edits to rebuild caption rows and clear old timing.');};
  $('rebuild').onclick=()=>{invalidateAnchors('Transcript edits applied. Update timing before regrouping.');captions=core.untimedCaptions(transcript());pendingEdits=false;selected=1;page=0;render();notice('Caption rows rebuilt. Add or import timing.');};
  $('caption-length').onchange=()=>{setText('grouping-status',wordAnchors.length?'Press Apply grouping to use this caption length. Approvals will reset.':'This caption length will be applied after KFA timing.');};
  $('apply-grouping').onclick=()=>{if(active)return;try{applyGroups();render();notice('Caption grouping updated using existing word timing.');}catch(error){$('grouping-status').textContent=core.errorMessage(error);notice(core.errorMessage(error));}};
  $('only-review').onchange=()=>{page=0;render();};
  $('page-prev').onclick=()=>{if(!active&&page>0){page--;render();}};
  $('page-next').onclick=()=>{if(!active&&(page+1)*pageSize<filtered().length){page++;render();}};
  $('approve-all').onclick=()=>{
    if(active)return;
    try {
      if(pendingEdits)throw new Error('Apply transcript edits before approving.');
      if(!source)throw new Error('Choose matching audio first.');
      // Validate the full set before changing any approval; failures are atomic.
      core.validateCaptions(captions.map(c=>({...c,approved:true})),source.durationMs);
      captions.forEach(c=>{c.approved=true;});render();
      $('timing-status').textContent=`All ${captions.length} captions approved. Ready to export SRT.`;
      notice(`All ${captions.length} captions approved.`);
    }catch(error){$('timing-status').textContent=`Cannot approve all: ${core.errorMessage(error)}`;notice(core.errorMessage(error));}
  };
  $('offset').oninput=summary;
  $('next').onclick=()=>{try{const c=captions.find(x=>x.id===selected&&!x.approved)||captions.find(x=>!x.approved);if(c)approve(c);}catch(e){notice(e.message);}};
  $('alignment-request').onclick=safe(async token=>{
    if(!source||!transcript())throw new Error('Choose audio and review a transcript first.');
    const request={schemaVersion:1,kind:'sthang-kfa-request',audioSha256:source.sha256,durationMs:source.durationMs,fullText:transcript()};
    token.check();if(await host.saveText('khmer-kfa-request.json',JSON.stringify(request,null,2)))notice('KFA request saved. Run scripts/align-gemini-draft.py locally, then import the timing JSON.');
  });
  $('import-alignment').onclick=safe(async token=>{if(!source||!transcript())throw new Error('Choose matching audio and transcript first.');const value=await host.openJson();token.check();if(!value)return;wordAnchors=core.importAlignment(value,source,transcript());pendingEdits=false;applyGroups();render();notice('KFA timing imported. Review and approve each caption.');});
  $('export').onclick=safe(async()=>{if(!source||pendingEdits)throw new Error('Apply transcript edits first.');if(await host.saveText('khmer-captions.srt',core.srt(captions,source.durationMs,offset())))notice('Reviewed SRT saved. Import it into Premiere to create a caption track.');});
  $('save-draft').onclick=safe(async()=>{if(!source)throw new Error('Choose audio first.');const rows=pendingEdits?core.untimedCaptions(transcript()):captions;const saved=await host.saveText('khmer-captions-draft.json',JSON.stringify({schemaVersion:1,kind:'sthang-gemini-kfa-caption-draft',source,fullText:rows.map(c=>c.text).join('\n'),model:resultModel,offsetMs:offset(),groupingMode:appliedGroupingMode,anchorAudioSha256:source.sha256,wordAnchors:pendingEdits?[]:wordAnchors,captions:rows},null,2));notice(saved?'Draft saved.':'Draft save cancelled.');});
  $('load-draft').onclick=safe(async token=>{
    if(!source)throw new Error('Choose the matching recording before opening its draft.');if(transcript()||captions.length)throw new Error('Clear the current transcript before opening another draft.');
    const d=await host.openJson();token.check();if(!d)return;
    if(d.schemaVersion!==1||!['sthang-local-caption-draft','sthang-gemini-kfa-caption-draft'].includes(d.kind)||!d.source||d.source.sha256!==source.sha256||d.source.durationMs!==source.durationMs||typeof d.fullText!=='string'||!Number.isInteger(d.offsetMs)||d.offsetMs<0||d.offsetMs>86400000)throw new Error('This draft does not match the selected audio or format.');
    // Restore validated timing, but require renewed approval.
    const restored=core.restoreDraftCaptions(d,source);
    const restoredAnchors=core.restoreWordAnchors(d,source);
    $('transcript').value=d.fullText;captions=restored;wordAnchors=restoredAnchors;appliedGroupingMode=core.groupingModes.includes(d.groupingMode)?d.groupingMode:'short';$('caption-length').value=appliedGroupingMode;$('grouping-status').textContent=wordAnchors.length?'Saved word timing restored. You can regroup without another request.':'Update timing to enable caption regrouping.';page=0;pendingEdits=false;resultModel=typeof d.model==='string'?d.model:'';$('offset').value=String(d.offsetMs/1000);render();notice('Draft restored. Review wording and timing before approving again.');
  });
  $('clear').onclick=safe(async()=>{if(transcript()||captions.length){$('transcript').value='';captions=[];wordAnchors=[];page=0;pendingEdits=false;render();notice('Transcript cleared. Selected audio preserved. Press Clear workspace again to release it.');return;}if(player)player.reset();await release(media);media=null;source=null;wordAnchors=[];$('timing-status').textContent='Word timing is generated automatically after transcription.';$('media-status').textContent='No recording selected.';$('audio-name').textContent='Choose your recording';$('audio-info').textContent='WAV or MP4, 0.1-120 seconds';$('offset').value='0';resultModel='';summary();notice('Workspace cleared.');});
  root.disposeCaptionWorkspace=()=>{if(active)active.cancel();if(player)player.dispose();};
  if(root.addEventListener)root.addEventListener('beforeunload',root.disposeCaptionWorkspace);
  render();busy(false);showView(currentView);
  root.captionWorkspaceReady=true;
  $('media-status').textContent='Ready to choose WAV or MP4, or use timeline audio.';
  } catch(error) {
    root.captionWorkspaceReady=false;
    const message='Panel could not start: '+String(error&&error.message||error);
    for(const id of ['media-status','notice']){const el=document.getElementById(id);if(el)el.textContent=message;}
    console.error(message,error);
  }
})(globalThis);
