// Bake the editable SVG sources into PNGs. Premiere's SVG renderer does not
// render the gradient button fills consistently; runtime uses PNGs only.
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  let tabs;
  for(let i=0;i<30;i++){try{tabs=await fetch('http://127.0.0.1:9223/json').then(r=>r.json());break;}catch(e){if(i===29)throw e;await new Promise(r=>setTimeout(r,100));}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let sequence=0;const pending=new Map();
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  try{
    await call('Page.navigate',{url:pathToFileURL(path.resolve('index.html')).href});
    await new Promise(r=>setTimeout(r,500));
    for(const name of fs.readdirSync('assets').filter(n=>n.endsWith('.svg'))){
      const url='data:image/svg+xml;base64,'+fs.readFileSync(path.join('assets',name)).toString('base64');
      const result=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{const img=new Image();img.src=${JSON.stringify(url)};await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth*2;c.height=img.naturalHeight*2;const g=c.getContext('2d');g.drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];})()`});
      if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
      fs.writeFileSync(path.join('assets',name.replace('.svg','.png')),Buffer.from(result.result.value,'base64'));
      console.log('Rasterized',name);
    }
  }finally{ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
