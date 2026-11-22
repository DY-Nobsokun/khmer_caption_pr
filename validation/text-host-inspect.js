(async()=>{
  const ppro=require('premierepro'),project=await ppro.Project.getActiveProject(),sequence=project&&await project.getActiveSequence();
  const tracks=[];
  if(sequence)for(let i=0;i<await sequence.getVideoTrackCount();i++){
    const track=await sequence.getVideoTrack(i),items=track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
    tracks.push({index:i,count:items.length,name:track.name});
  }
  return {project:project&&project.name,sequence:sequence&&sequence.name,timebase:sequence&&await sequence.getTimebase(),tracks,audioTracks:sequence&&await sequence.getAudioTrackCount(),host:require('uxp').host,
    notice:document.getElementById('notice').textContent};
})()
