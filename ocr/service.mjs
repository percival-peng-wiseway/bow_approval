import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseInvoice} from './parse.mjs';
const exec=promisify(execFile);
const script=fileURLToPath(new URL('./extract.py',import.meta.url));
const python=process.env.INVOICE_PYTHON||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
export const MAX_FILE_BYTES=2*1024*1024;
export async function scanInvoice(input, {previewOnly=false}={}) {
  if(!input||typeof input.name!=='string'||typeof input.data!=='string')throw new Error('Choose an invoice file.');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data))throw new Error('Invalid file encoding.');
  const bytes=Buffer.from(input.data,'base64');
  if(!bytes.length||bytes.length>MAX_FILE_BYTES)throw new Error('Invoice files must be 2 MB or less.');
  const extension=path.extname(input.name).toLowerCase();
  const pdf=bytes.subarray(0,5).toString()==='%PDF-';
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!(pdf&&extension==='.pdf'||png&&extension==='.png'||jpg&&['.jpg','.jpeg'].includes(extension)||webp&&extension==='.webp'))throw new Error('Use a valid PDF, PNG, JPG or WebP invoice.');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'approval-invoice-'));
  try{
    const source=path.join(directory,'invoice'+extension);await fs.writeFile(source,bytes,{mode:0o600});
    let output;
    try{output=await exec(python,[script,source,...(previewOnly?['--preview']:[])],{timeout:90000,maxBuffer:8*1024*1024,env:{...process.env,PYTHONUNBUFFERED:'1'}});}
    catch(error){let message;if(error.stdout){try{message=JSON.parse(error.stdout).error;}catch{}}throw new Error(message||(error.killed?'Scanning took too long. Try a smaller or clearer invoice.':error.code==='ENOENT'?'Local OCR runtime is unavailable. Check INVOICE_PYTHON and INVOICE_TESSERACT.':'The invoice could not be read. Try another PDF or a clearer image.'));}
    const extracted=JSON.parse(output.stdout);
    if(previewOnly)return {previews:extracted.previews};
    return {...parseInvoice(extracted.text),text:extracted.text,pages:extracted.pages,previews:extracted.previews,engine:'Local PDF text + Tesseract OCR',sha256:createHash('sha256').update(bytes).digest('hex')};
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
