// Retry the current workspace's grouping locally. No new transcription request.
// Run: node validation/uxp-debug.cjs validation/grouping-live-smoke.js local-paths.js
(async()=>{
  const el=id=>document.getElementById(id);
  if(el('apply-grouping').disabled)throw Error('Apply grouping is currently disabled');
  const compact=text=>String(text).replace(/\s/g,'');
  const before=compact(el('transcript').value);
  await el('apply-grouping').onclick();
  if(compact(el('transcript').value)!==before)throw Error('Regrouping changed the original spelling');
  const result={counts:el('counts').textContent,grouping:el('grouping-status').textContent,
    timing:el('timing-status').textContent,approvals:el('approval-summary').textContent,
    notice:el('notice').textContent,transcriptPreserved:true};
  if(!/captions grouped/.test(result.grouping))throw Error(JSON.stringify(result));
  return result;
})()
