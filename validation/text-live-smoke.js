// Exercises the real module in a disposable sequence, then restores the user.
(async()=>{
  const ppro=require('premierepro'),project=await ppro.Project.getActiveProject(),original=await project.getActiveSequence();
  const before=[];
  for(let i=0;i<await original.getVideoTrackCount();i++)before.push((await original.getVideoTrack(i)).getTrackItems(ppro.Constants.TrackItemType.CLIP,false).length);
  let scratch=null;
  try{
    scratch=await project.createSequence('__Khmer text generation check '+Date.now());
    const settings=await original.getSettings();let settingsApplied=false;
    project.lockedAccess(()=>{settingsApplied=project.executeTransaction(action=>action.addAction(scratch.createSetSettingsAction(settings)),'Match caption test sequence settings');});
    if(!settingsApplied)throw Error('Could not match the original sequence settings');
    await project.setActiveSequence(scratch);
    const audioBefore=await scratch.getAudioTrackCount(),tracksBefore=await scratch.getVideoTrackCount();
    const result=await TimelineTextHost.generate([
      {id:1,text:'សួស្តី ខ្មែរ',start:100,end:900,approved:true},
      {id:2,text:'Second caption',start:1000,end:1800,approved:true}
    ],2000,10000);
    const track=await scratch.getVideoTrack(result.track-1),clips=track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false),details=[];
    for(const clip of clips){
      const chain=await clip.getComponentChain(),components=[];
      for(let i=0;i<chain.getComponentCount();i++)components.push(await chain.getComponentAtIndex(i).getMatchName());
      details.push({name:await clip.getName(),start:(await clip.getStartTime()).ticks,end:(await clip.getEndTime()).ticks,components});
    }
    const second=await TimelineTextHost.generate([{id:1,text:'Independent run',start:100,end:900,approved:true}],2000,0);
    return {result,timebase:await scratch.getTimebase(),details,second,tracksBefore,tracksAfter:await scratch.getVideoTrackCount(),audioBefore,audioAfter:await scratch.getAudioTrackCount()};
  }finally{
    if(original)await project.setActiveSequence(original);
    if(scratch){await project.closeSequence(scratch);await project.deleteSequence(scratch);}
    const after=[];
    for(let i=0;i<await original.getVideoTrackCount();i++)after.push((await original.getVideoTrack(i)).getTrackItems(ppro.Constants.TrackItemType.CLIP,false).length);
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Original sequence track contents changed');
  }
})()
