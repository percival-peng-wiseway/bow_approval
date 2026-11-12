import test from 'node:test';
import assert from 'node:assert/strict';
import {filePicker,fileType,validateFiles,selectedFiles,readUploadFiles} from '../app/uploads.mjs';
const mb=1024*1024;
test('file controls provide separate visible native file and photo inputs without capture',()=>{
 const html=filePicker('Contract','contract-0');
 assert.equal((html.match(/type="file"/g)||[]).length,2);assert.match(html,/id="contract-0-photos" accept="image\/\*"/);assert.match(html,/application\/pdf,.pdf/);assert.doesNotMatch(html,/capture|hidden|display:none|onclick/);
 assert.doesNotMatch(filePicker('Invoice','invoice',{multiple:false,invoice:true}),/multiple|text\/plain/);
});
test('validate size, count, unsupported/empty images and missing mobile provider MIME before reading',()=>{
 assert.equal(fileType({name:'invoice.PDF',type:''}),'application/pdf');assert.equal(fileType({name:'photo.JPG',type:'application/octet-stream'}),'image/jpeg');
 assert.throws(()=>validateFiles([{name:'large.jpg',type:'image/jpeg',size:3*mb}],2*mb),/2 MB/);
 assert.throws(()=>validateFiles([{name:'photo.heic',type:'image/heic',size:5}],2*mb),/HEIC/);
 assert.throws(()=>validateFiles([{name:'photo.jpg',type:'text/html',size:5}],2*mb),/Choose/);
 assert.throws(()=>validateFiles([{name:'photo.jpg',size:0}],2*mb),/Empty/);
 assert.throws(()=>validateFiles([{name:'note.txt',size:5}],2*mb,{invoice:true}),/invoice/);
 assert.throws(()=>validateFiles(Array.from({length:21},()=>({name:'a.txt',size:1})),2*mb),/20 files/);
 assert.deepEqual(selectedFiles({closest:()=>({querySelectorAll:()=>[{files:[1,2]},{files:[3]}]})}),[1,2,3]);
});
test('file reads are sequential, bounded, normalize missing MIME, and abort cleanly',async t=>{
 let reads=0,active=0,peak=0;
 class Reader{
  readAsDataURL(file){reads++;active++;peak=Math.max(peak,active);this.timer=setTimeout(async()=>{this.result=`data:${file.type||'application/octet-stream'};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;active--;this.onload();},5);}
  abort(){clearTimeout(this.timer);active--;this.onabort();}
 }
 const previous=globalThis.FileReader;globalThis.FileReader=Reader;t.after(()=>{if(previous)globalThis.FileReader=previous;else delete globalThis.FileReader;});
 await assert.rejects(readUploadFiles([{name:'large.jpg',size:4*mb}],{maxBytes:2*mb}),/2 MB/);assert.equal(reads,0);
 const files=[new File(['first'],'first.txt'),new File(['second'],'second.txt',{type:'text/plain'})];
 const result=await readUploadFiles(files);assert.equal(peak,1);assert.equal(result[0].type,'text/plain');assert.equal(result[0].data,'data:text/plain;base64,Zmlyc3Q=');assert.equal(result[1].name,'second.txt');
 const controller=new AbortController(),reading=readUploadFiles(files,{signal:controller.signal});setTimeout(()=>controller.abort(),3);await assert.rejects(reading,{name:'AbortError'});assert.equal(active,0);
 const cancelled=new AbortController();cancelled.abort();const before=reads;await assert.rejects(readUploadFiles(files,{signal:cancelled.signal}),{name:'AbortError'});assert.equal(reads,before);
});
