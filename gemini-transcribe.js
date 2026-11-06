'use strict';
// Dedicated transcription schema, matching scripts/test-gemini-transcribe.cjs.
// https://ai.google.dev/gemini-api/docs/transcribe
(function(root){
  const local=root.LocalCaptionCore||(typeof require==='function'&&require('./local-core.js'));
  const model='gemini-3.5-transcribe';
  const endpoint='https://generativelanguage.googleapis.com/v1beta/interactions';
  function validKey(key){return typeof key==='string'&&/^[A-Za-z0-9_.-]{20,200}$/.test(key.trim());}
  async function encodeAudio(value,token){
    const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const parts=[];
    // Yield between bounded multiples-of-three chunks to keep UXP responsive.
    for(let at=0;at<bytes.length;at+=49152){
      token.check();const end=Math.min(at+49152,bytes.length),chars=[];
      for(let i=at;i<end;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];chars.push(alphabet[a>>2],alphabet[((a&3)<<4)|((b||0)>>4)],i+1<end?alphabet[((b&15)<<2)|((c||0)>>6)]:'=',i+2<end?alphabet[c&63]:'=');}
      parts.push(chars.join(''));await new Promise(resolve=>setTimeout(resolve,0));
    }
    token.check();return parts.join('');
  }
  async function buildRequest(audio,token=local.cancellation()){
    local.wavInfo(audio);token.check();
    return {model,store:false,input:[{type:'audio',data:await encodeAudio(audio,token),mime_type:'audio/wav'}],
      generation_config:{transcription_config:{language_codes:['km-KH'],mode:{type:'verbatim'}}}};
  }
  function parseResponse(response){
    if(!response||response.status!=='completed')throw new Error('Gemini did not finish transcription. Try again when the service is available.');
    const text=typeof response.output_text==='string'?response.output_text:(response.steps||[])
      .filter(step=>step.type==='model_output').flatMap(step=>step.content||[])
      .filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n');
    if(typeof text!=='string'||!text.trim())throw new Error('Gemini returned no intelligible speech.');
    if(text.length>60000)throw new Error('Gemini returned a transcript exceeding the supported length.');
    return {fullText:text.trim(),model};
  }
  async function transcribe({audio,apiKey,token=local.cancellation(),transport,stage=()=>{}}){
    token.check();if(!validKey(apiKey))throw new Error('Enter your Gemini API key or save it in AI connection.');
    stage('Preparing audio for Gemini...');const body=await buildRequest(audio,token);token.check();
    stage('Sending audio to Gemini 3.5 Transcribe...');
    const response=await transport({url:endpoint,body,headers:{'Content-Type':'application/json','x-goog-api-key':apiKey.trim(),'Api-Revision':'2026-05-20'},timeoutMs:180000},token,stage);
    token.check();return parseResponse(response);
  }
  const api={model,endpoint,validKey,buildRequest,parseResponse,transcribe};root.GeminiTranscribeCore=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
