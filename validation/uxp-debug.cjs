// Evaluate a local diagnostic in this plugin's connected UXP runtime.
// Requires UXP Developer Tool running with the plugin loaded.
const fs=require('node:fs');
(async()=>{
  const info=await fetch('http://127.0.0.1:14001/json/version').then(r=>r.json());
  const ws=new WebSocket(info.webSocketDebuggerUrl+'?adobe-uxp-app-id=premierepro');
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let next=0;const pending=new Map(),targets=[],contexts=[];
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Target.targetCreated')targets.push(message.params.targetInfo);
    if(message.method==='Runtime.executionContextCreated')contexts.push({sessionId:message.sessionId,...message.params.context});
    if(pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timeout);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}
    else if(process.env.UXP_DEBUG_EVENTS)console.log(JSON.stringify(message));
  });
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++next,timeout=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},15000);
    pending.set(id,{resolve,reject,timeout});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  try{
    await call('Target.setDiscoverTargets',{discover:true});
    await new Promise(resolve=>setTimeout(resolve,300));
    if(!process.argv[2]){console.log(JSON.stringify(targets));return;}
    const target=targets.find(t=>JSON.stringify(t).includes('app.sthang.captions.workspace.dev'));
    if(!target)throw Error('Khmer Captions UXP target not found');
    const attached=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    if(process.env.UXP_DEBUG_EVENTS)console.log('Attached',JSON.stringify(attached));
    await call('Runtime.enable',{},attached.sessionId);
    const context=contexts.find(entry=>entry.sessionId===attached.sessionId&&entry.auxData&&entry.auxData.isDefault);
    if(!context)throw Error('Khmer Captions execution context not found');
    const contextId=context.id;
    if(process.argv[3]){
      const loaded=await call('Runtime.evaluate',{expression:fs.readFileSync(process.argv[3],'utf8'),contextId,returnByValue:true},attached.sessionId);
      if(loaded.exceptionDetails)throw Error(JSON.stringify(loaded.exceptionDetails));
    }
    const source=fs.readFileSync(process.argv[2],'utf8');
    const started=await call('Runtime.evaluate',{expression:'globalThis.__khmerTextDiagnostic=null;Promise.resolve('+source+').then(value=>{globalThis.__khmerTextDiagnostic=JSON.stringify({ok:true,value});},error=>{globalThis.__khmerTextDiagnostic=JSON.stringify({ok:false,error:String(error),stack:error.stack});});"pending"',contextId,returnByValue:true},attached.sessionId);
    if(started.exceptionDetails)throw Error(JSON.stringify(started.exceptionDetails));
    for(let i=0;i<300;i++){
      const evaluated=await call('Runtime.evaluate',{expression:'globalThis.__khmerTextDiagnostic',contextId,returnByValue:true},attached.sessionId);
      if(evaluated.result&&evaluated.result.value){console.log(evaluated.result.value);return;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('Diagnostic did not finish');
  }finally{ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
