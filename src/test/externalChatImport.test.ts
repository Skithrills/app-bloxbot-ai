// No model requests. The optional real-thread test never prints transcript text or persists a copy.
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCode } from '@opencode/client';
import { expect,it,vi } from 'vitest';
import {listExternalChats,readExternalChat} from '../../electron/externalChats';
import {createOpencodeClient} from '@/lib/opencode/client';
import {startServer,PASSWORD} from './support/liveServer';

it('reads only the selected Claude branch, without changing the original',async()=>{
  const home=await mkdtemp(join(tmpdir(),'chat-source-test-'));
  try {
    vi.stubEnv('CLAUDE_CONFIG_DIR',home);
    const id='01234567-1234-1234-1234-123456789012';const path=join(home,'projects','fixture');await mkdir(path,{recursive:true});
    const rows=[['user','a','','hello'],['assistant','b','a','discarded'],['assistant','c','a','kept']].map(([type,uuid,parentUuid,text])=>({type,uuid,parentUuid,message:{content:[{type:'text',text},{type:'thinking',thinking:'hidden'}]}}));
    await writeFile(join(path,id+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n'));
    expect((await listExternalChats(id)).length).toBe(1);
    const chat=await readExternalChat(`claude://sessions/${id}`);expect(chat.messages.map(m=>m.text)).toEqual(['hello','kept']);
  }finally{vi.unstubAllEnvs();await rm(home,{recursive:true,force:true})}
});

it.skipIf(!process.env.BLOXBOT_IMPORT_TEST_REF||!process.env.OPENCODE_LIVE_BIN)('round-trips selected local history through an isolated backend without generation',async()=>{
  const home=await mkdtemp(join(tmpdir(),'chat-import-test-'));
  const engine=await startServer(process.env.OPENCODE_LIVE_BIN!,home);
  try{
    const headers={Authorization:`Basic ${Buffer.from(`opencode:${PASSWORD}`).toString('base64')}`};
    const client=createOpencodeClient({baseUrl:engine.baseUrl,headers,directory:engine.workspace});
    const api=OpenCode.make({baseUrl:engine.baseUrl,headers});
    const transcript=await readExternalChat(process.env.BLOXBOT_IMPORT_TEST_REF!);
    expect(transcript.messages.length).toBeGreaterThan(0);
    const {data}=await client.session.importExternal({transcript},{throwOnError:true});
    const {messages}=await api.experimental.session.export({sessionID:data.id,sanitize:false});
    expect(messages.length).toBe(transcript.messages.length);
    expect(messages.every((m,i)=>{const actual=m.type==='user'?m.text:m.type==='assistant'?m.content.map(c=>c.type==='text'?c.text:'').join(''):null;return m.type===transcript.messages[i].role&&actual===transcript.messages[i].text})).toBe(true);
    const again=await client.session.importExternal({transcript},{throwOnError:true});expect(again.data.id===data.id).toBe(true);
    console.log(`Verified ${messages.length} visible messages; duplicate import reopened the same chat.`);
  }finally{const done=once(engine.child,'exit');engine.child.kill();await done;await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
},60000);
