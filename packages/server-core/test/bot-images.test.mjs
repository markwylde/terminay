import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,writeFileSync,symlinkSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {botImagePath,botImageMime,readBotImage,BOT_IMAGE_BYTES} from '../dist/botService/images.js';
const id='abc123def456';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD0kAAAAASUVORK5CYII=','base64');
test('container image reads enforce ownership, bounds, signatures and no-follow traversal',async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'bot-images-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'screen.png'),png);writeFileSync(join(root,'text.png'),'secret');writeFileSync(join(root,'huge.png'),Buffer.alloc(BOT_IMAGE_BYTES+1));
 symlinkSync(join(root,'screen.png'),join(root,'link.png'));mkdirSync(join(root,'folder'));symlinkSync(root,join(root,'alias'));
 let owned=true,running=true,calls=0;
 const driver={inspect:async()=>({State:{Running:running},Config:{Labels:{'terminay.server':owned?'server':'other','terminay.bot':id,'terminay.managed':'1'}}}),exec:async(name,args,options)=>{
 calls++;assert.equal(name,`terminay-bot-${id}`);assert.equal(options.user,'bot');assert.equal(options.deadlineMs,10000);
 const source=args[2].replace("root='/tmp' if path.startswith('/tmp/') else '/home/bot'",`root=${JSON.stringify(root)}`);
 return execFileSync('python3',['-c',source,join(root,args[3].slice('/tmp/'.length))],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 }};
 assert.equal(botImageMime((await readBotImage(driver,'server',id,'/tmp/screen.png')).bytes),'image/png');
 for(const path of ['/etc/passwd','/tmp/../secret','/tmp//screen.png','/tmp/a\0.png'])assert.throws(()=>botImagePath(path));
 for(const path of ['text.png','huge.png','link.png','alias/screen.png','folder'])await assert.rejects(readBotImage(driver,'server',id,`/tmp/${path}`));
 const before=calls;owned=false;await assert.rejects(readBotImage(driver,'server',id,'/tmp/screen.png'));owned=true;running=false;await assert.rejects(readBotImage(driver,'server',id,'/tmp/screen.png'));assert.equal(calls,before);
 assert.throws(()=>botImageMime(Buffer.from('<svg><script/></svg>')));
});
