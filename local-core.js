'use strict';
// Local algorithms shared in behavior with gemini-panel/core.js; no cloud transport.
(function(root) {
const maxBytes=4000000, maxSeconds=120;
  function cancellation() {
    let cancelled = false;
    const listeners = new Set();
    return {
      get cancelled() { return cancelled; },
      check() { if (cancelled) { const e = new Error('Cancelled.'); e.name = 'AbortError'; throw e; } },
      subscribe(fn) { if (cancelled) fn(); else listeners.add(fn); return () => listeners.delete(fn); },
      cancel() { cancelled = true; for (const fn of listeners) fn(); listeners.clear(); }
    };
  }
  function bytes(value) {
    return value instanceof Uint8Array ? value : new Uint8Array(value);
  }
  function wavInfo(value) {
    const data = bytes(value);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tag = at => String.fromCharCode(...data.subarray(at, at + 4));
    if (data.length < 44 || data.length > maxBytes || tag(0) !== 'RIFF' || tag(8) !== 'WAVE')
      throw new Error('Choose a PCM WAV up to 120 seconds.');
    const limit = view.getUint32(4, true) + 8;
    if (limit > data.length || limit < 44) throw new Error('The WAV is incomplete.');
    let format, pcm;
    for (let at = 12; at + 8 <= limit;) {
      const size = view.getUint32(at + 4, true), start = at + 8;
      if (start + size > limit) throw new Error('The WAV contains a truncated chunk.');
      if (tag(at) === 'fmt ') {
        if (size < 16 || format) throw new Error('Unsupported WAV format chunk.');
        format = { encoding: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
          sampleRate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true),
          blockAlign: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) };
      }
      if (tag(at) === 'data') { if (pcm) throw new Error('Multiple WAV data chunks are unsupported.'); pcm = { offset: start, size }; }
      at = start + size + (size % 2);
    }
    if (!format || !pcm || format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 16000 ||
        format.bits !== 16 || format.blockAlign !== 2 || format.byteRate !== 32000 || pcm.size % 2)
      throw new Error('Export mono, 16 kHz, 16-bit PCM WAV audio.');
    const durationMs = pcm.size / 32;
    if (durationMs < 100 || durationMs > maxSeconds * 1000) throw new Error('Choose audio between 0.1 and 120 seconds.');
    return { ...format, ...pcm, durationMs };
  }

  function* sha256Steps(value) {
    const data = bytes(value), length = Math.ceil((data.length + 9) / 64) * 64;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tail = new Uint8Array(8), tailView = new DataView(tail.buffer);
    tailView.setUint32(0, Math.floor(data.length / 0x20000000));
    tailView.setUint32(4, data.length * 8 >>> 0);
    const byteAt = i => i < data.length ? data[i] : i === data.length ? 128 : i >= length-8 ? tail[i-(length-8)] : 0;
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const r = (x, n) => (x >>> n) | (x << (32 - n)), w = new Uint32Array(64);
    for (let at = 0; at < length; at += 64) {
      if (at && at % (512*1024) === 0) yield;
      for (let i = 0; i < 16; i++) {
        const offset = at+i*4;
        w[i] = offset+4 <= data.length ? view.getUint32(offset) : ((byteAt(offset)<<24)|(byteAt(offset+1)<<16)|(byteAt(offset+2)<<8)|byteAt(offset+3)) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = w[i - 16] + (r(a,7)^r(a,18)^(a>>>3)) + w[i - 7] + (r(b,17)^r(b,19)^(b>>>10));
      }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) {
        const t = (j + (r(e,6)^r(e,11)^r(e,25)) + ((e&f)^(~e&g)) + k[i] + w[i]) | 0;
        const u = ((r(a,2)^r(a,13)^r(a,22)) + ((a&b)^(a&c)^(b&c))) | 0;
        j=g; g=f; f=e; e=(d+t)|0; d=c; c=b; b=a; a=(t+u)|0;
      }
      [a,b,c,d,e,f,g,j].forEach((x,i) => { h[i] = (h[i] + x) | 0; });
    }
    return h.map(x => (x >>> 0).toString(16).padStart(8,'0')).join('');
  }
  function sha256(value) {
    const iterator = sha256Steps(value); let step;
    do { step = iterator.next(); } while (!step.done);
    return step.value;
  }
  async function sha256Async(value, token = cancellation()) {
    const iterator = sha256Steps(value);
    for (;;) {
      token.check(); const step = iterator.next(); if (step.done) return step.value;
      await new Promise(resolve => setTimeout(resolve,0));
    }
  }

  function untimedCaptions(text) {
    return text.split(/\n+/).map(s => s.trim()).filter(Boolean).map((text, i) => ({ id: i + 1, text, start: null, end: null, approved: false, timingSource: 'missing' }));
  }
  function validateCaptions(captions, durationMs) {
    if (!Array.isArray(captions) || !captions.length) throw new Error('There are no captions to export.');
    let previous = 0;
    for (const c of captions) {
      if (!c.text.trim() || !Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start < previous || c.end <= c.start || c.end > durationMs)
        throw new Error('Every caption needs text and valid, non-overlapping start/end times within the selected audio.');
      if (!c.approved) throw new Error('Review and approve every caption before exporting SRT.');
      previous = c.end;
    }
  }
  function timestamp(ms) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(Math.floor(ms/3600000))}:${pad(Math.floor(ms/60000)%60)}:${pad(Math.floor(ms/1000)%60)},${String(ms%1000).padStart(3,'0')}`;
  }
  function srt(captions, durationMs, offsetMs = 0) {
    validateCaptions(captions, durationMs);
    if (!Number.isInteger(offsetMs) || offsetMs < 0) throw new Error('Invalid sequence offset.');
    return captions.map((c,i) => `${i+1}\n${timestamp(c.start+offsetMs)} --> ${timestamp(c.end+offsetMs)}\n${c.text.trim()}\n`).join('\n');
  }
  function importAlignment(payload, source, fullText) {
    if (!payload || payload.schemaVersion !== 1 || payload.audioSha256 !== source.sha256 || payload.fullText !== fullText ||
        payload.engine !== 'kfa-local' || payload.directAlignment !== true || !Array.isArray(payload.words) || !payload.words.length || payload.words.length > 20000)
      throw new Error('KFA timing must match this exact WAV and transcript. Export a new alignment request.');
    const compact = s => s.replace(/\s/g, '');
    if (payload.words.some(w => typeof w.text !== 'string') || compact(payload.words.map(w=>w.text).join('')) !== compact(fullText))
      throw new Error('KFA word spelling differs from the transcript. Keep the transcript and review timing manually.');
    // Preserve original whitespace and wording; only KFA word boundaries partition the text.
    let cursor = 0, previous = 0;
    return payload.words.map((word, i) => {
      const start = word.startMs, end = word.endMs;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < previous || end <= start || end > source.durationMs || word.derived)
        throw new Error('KFA returned invalid, overlapping, or estimated word timing.');
      const begin = cursor, wanted = compact(word.text).length;
      let consumed = 0;
      while (cursor < fullText.length && consumed < wanted) { if (!/\s/.test(fullText[cursor])) consumed++; cursor++; }
      previous = end;
      const span=fullText.slice(begin,cursor),separatorBefore=(span.match(/^\s*/)||[''])[0];
      const atomicWords=word.mergedAcousticWords===undefined?1:word.mergedAcousticWords;
      if(!Number.isInteger(atomicWords)||atomicWords<1||atomicWords>20000)throw new Error('Invalid KFA word-group metadata.');
      return { id: i+1, text: span.trim(), separatorBefore, atomicWords, start, end, approved: false, timingSource: 'kfa-local' };
    });
  }
  const groupingModes=['word','short','long','sentence'];
  function groupCaptions(anchors, mode, durationMs) {
    if(!groupingModes.includes(mode))throw new Error('Select a supported caption length.');
    if(!Array.isArray(anchors)||!anchors.length)throw new Error('Generate KFA word timing before grouping captions.');
    validateCaptions(anchors.map(w=>({...w,approved:true})),durationMs);
    const settings={word:{target:1,max:1,ms:Infinity},short:{target:4,max:5,ms:4500},long:{target:8,max:10,ms:8000},sentence:{target:Infinity,max:24,ms:12000}}[mode];
    const rows=[];let current=[],count=0,firstIndex=0;
    const sentenceEnd=text=>/[.!?\u17d4\u17d5\u2026][\u201d\u2019"'\u00bb)\]]*$/.test(text.trim());
    function flush(){
      if(!current.length)return;
      const text=current.map((w,i)=>(i?(w.separatorBefore===undefined?' ':w.separatorBefore.replace(/\s+/g,' ')):'')+w.text).join('');
      rows.push({id:rows.length+1,text,start:current[0].start,end:current[current.length-1].end,approved:false,timingSource:'kfa-local-grouped',anchorStart:firstIndex,anchorEnd:firstIndex+current.length-1});
      current=[];count=0;
    }
    anchors.forEach((word,index)=>{
      const n=word.atomicWords===undefined?1:word.atomicWords;
      if(!Number.isInteger(n)||n<1||n>20000||word.derived)throw new Error('Invalid KFA word anchor.');
      if(word.separatorBefore!==undefined&&(typeof word.separatorBefore!=='string'||/\S/.test(word.separatorBefore)))throw new Error('Invalid KFA word separator.');
      if(current.length&&(word.start-current[current.length-1].end>=900||count+n>settings.max||word.end-current[0].start>settings.ms))flush();
      if(!current.length)firstIndex=index;
      current.push(word);count+=n;
      if(mode==='word'||count>=settings.target||sentenceEnd(word.text))flush();
    });
    flush();return rows;
  }
  function restoreWordAnchors(d,source) {
    if(d.wordAnchors===undefined||Array.isArray(d.wordAnchors)&&!d.wordAnchors.length)return [];
    if(!Array.isArray(d.wordAnchors)||d.wordAnchors.length>20000||d.anchorAudioSha256!==source.sha256)throw new Error('Draft word timing does not match this audio.');
    const anchors=d.wordAnchors.map((word,i)=>{
      if(!word||typeof word.text!=='string'||!word.text.trim()||word.timingSource!=='kfa-local'||word.derived||
          typeof word.separatorBefore!=='string'||word.separatorBefore.length>4096||/\S/.test(word.separatorBefore)||
          !Number.isInteger(word.atomicWords)||word.atomicWords<1||word.atomicWords>20000)throw new Error('Invalid saved word timing.');
      return {id:i+1,text:word.text,separatorBefore:word.separatorBefore,atomicWords:word.atomicWords,start:word.start,end:word.end,approved:false,timingSource:'kfa-local'};
    });
    validateCaptions(anchors.map(w=>({...w,approved:true})),source.durationMs);
    if(anchors.map(w=>w.text).join('').replace(/\s/g,'')!==d.fullText.replace(/\s/g,''))throw new Error('Saved word timing does not match the transcript.');
    return anchors;
  }
function restoreDraftCaptions(d, source) {
  if(!Array.isArray(d.captions)||d.captions.length>20000)throw new Error('Invalid draft captions.');
  const restored=d.captions.map((c,i)=>{
    if(!c||typeof c.text!=='string'||!c.text.trim())throw new Error('Invalid caption wording.');
    for(const key of ['start','end'])if(c[key]!==null&&(!Number.isInteger(c[key])||c[key]<0||c[key]>source.durationMs))throw new Error('Invalid draft timing.');
    if(c.start!==null&&c.end!==null&&c.end<=c.start)throw new Error('Invalid draft interval.');
    return {id:i+1,text:c.text,start:c.start,end:c.end,approved:false,timingSource:'draft'};
  });
  if(restored.map(c=>c.text).join('\n').trim()!==d.fullText.trim())throw new Error('Draft wording and rows differ.');
  return restored;
}
function errorMessage(error) {
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0,600);
  if (typeof error === 'number') return `Host error code ${error}`;
  if (error) {
    for (const key of ['message','description','reason']) {
      if (typeof error[key] === 'string' && error[key].trim()) return error[key].trim().slice(0,600);
    }
    if (error.code !== undefined) return `Host error code ${String(error.code).slice(0,100)}`;
    try { const text=JSON.stringify(error); if(text && text!=='{}') return text.slice(0,600); } catch (_) {}
  }
  return 'The host did not provide error details.';
}
const api = { groupingModes, groupCaptions, restoreWordAnchors, errorMessage, restoreDraftCaptions, cancellation, wavInfo, sha256, sha256Async, untimedCaptions, validateCaptions, srt, importAlignment };
root.LocalCaptionCore=api;
if(typeof module === 'object' && module.exports) module.exports=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
