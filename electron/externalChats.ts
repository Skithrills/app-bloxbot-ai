import { open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { createInterface } from "node:readline";
import type { ExternalChatSummary, ExternalChatTranscript } from "../src/lib/externalChatTypes";

const uuid = /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i;
type Candidate = ExternalChatSummary & { path: string; root: string };
async function discover(ref?: string) {
  const codex = process.env.CODEX_HOME || join(homedir(), ".codex");
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const found: Candidate[] = [];
  for (const [source, root, depth] of [["codex", join(codex,"sessions"),3],["codex",join(codex,"archived_sessions"),3],["claude",join(claude,"projects"),1]] as const) {
    if (ref && !ref.startsWith(source+":")) continue;
    async function visit(dir: string, remaining: number) {
      const entries = await readdir(dir,{withFileTypes:true}).catch(()=>[]);
      for (const e of entries) {
        const path = join(dir,e.name);
        if (e.isDirectory() && remaining) await visit(path,remaining-1);
        if (!e.isFile()) continue;
        const id = uuid.exec(e.name)?.[1]?.toLowerCase();
        if (!id || (source === "claude" && e.name !== `${id}.jsonl`)) continue;
        const key = `${source}://${source === "codex" ? "threads" : "sessions"}/${id}`;
        if (ref && ref !== key) continue;
        const s = await stat(path).catch(()=>null);
        if (s) found.push({path,root,ref:key,source,title:source === "claude" ? `${basename(dirname(path))} · ${id}` : `Codex · ${id}`,updatedAt:s.mtimeMs,cwd:""});
      }
    }
    await visit(root,depth);
  }
  return found.sort((a,b)=>b.updatedAt-a.updatedAt);
}
export async function listExternalChats(query=""): Promise<ExternalChatSummary[]> {
  const needle=query.trim().toLowerCase();
  return (await discover()).filter(c=>(c.ref+" "+c.title).toLowerCase().includes(needle)).slice(0,100)
    .map(({path:_p,root:_r,...summary})=>summary);
}

export async function readExternalChat(ref: string): Promise<ExternalChatTranscript> {
  const source=(await discover(ref.toLowerCase()))[0];
  if (!source) throw new Error("This chat was not found in local Claude Code or Codex history.");
  const path=await realpath(source.path);
  const rel=relative(await realpath(source.root),path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid transcript path.");
  const file=await open(path,"r");
  const initial=await file.stat();
  type Msg=ExternalChatTranscript['messages'][number];
  const visible: Msg[]=[], legacy: Msg[]=[];
  const nodes=new Map<string,{parent:string;msg?:Msg}>();
  let leaf="",cwd="",title="",bytes=0,malformed=0;
  function msg(role:Msg['role'],content:unknown,ts:unknown): Msg|undefined {
    const text=typeof content==='string'?content:Array.isArray(content)?content.filter(c=>c && ['text','input_text','output_text'].includes(String(c.type).toLowerCase()) && typeof c.text==='string').map(c=>c.text).join('\n'):'';
    if (!text.trim()) return;
    bytes+=Buffer.byteLength(text);
    if(bytes>16*1024*1024) throw new Error("Visible conversation exceeds the 16 MiB import limit.");
    return {role,text,timestamp:Date.parse(String(ts))||initial.mtimeMs};
  }
  try {
    if(initial.size>256*1024*1024) throw new Error("Transcript exceeds the 256 MiB import limit.");
    if(!initial.size) throw new Error("The transcript is empty.");
    const lines=createInterface({input:file.createReadStream({autoClose:false,end:initial.size-1}),crlfDelay:Infinity});
    for await(const line of lines){
      if(!line.trim())continue;
      let r;try{r=JSON.parse(line);}catch{malformed++;continue;}
      if(!r || typeof r!=='object')continue;
      if(source.source==='codex'){
        const p=r.payload;
        if(r.type==='session_meta' && typeof p?.cwd==='string')cwd=p.cwd;
        const item=r.type==='event_msg' && p?.type==='item_completed' ? p.item : undefined;
        if(item && ['UserMessage','AgentMessage'].includes(item.type)){
          const m=msg(item.type==='UserMessage'?'user':'assistant',item.content,r.timestamp); if(m)visible.push(m);
        } else if(r.type==='response_item' && p?.type==='message' && ['user','assistant'].includes(p.role)){
          const m=msg(p.role,p.content,r.timestamp); if(m)legacy.push(m);
        }
        if(r.type==='event_msg' && p?.type==='thread_rolled_back') throw new Error('This rolled-back chat cannot yet be imported safely.');
      }else{
        if(typeof r.cwd==='string')cwd=r.cwd;
        if(r.type==='custom-title' && typeof r.customTitle==='string')title=r.customTitle;
        if(r.isSidechain || typeof r.uuid!=='string')continue;
        const m=!r.isMeta && ['user','assistant'].includes(r.type) ? msg(r.type,r.message?.content,r.timestamp):undefined;
        nodes.set(r.uuid,{parent:r.parentUuid,msg:m});if(m)leaf=r.uuid;
      }
    }
  }finally{await file.close();}
  if(source.source==='claude'){
    const seen=new Set<string>();while(leaf && !seen.has(leaf)){seen.add(leaf);const n=nodes.get(leaf);if(!n)break;if(n.msg)visible.push(n.msg);leaf=n.parent;}visible.reverse();
  }
  const messages=visible.length?visible:legacy;
  if(!messages.length)throw new Error("No visible conversation text to import.");
  const warnings=["Text only. Tool activity, attachments, and private reasoning are not copied."];
  if(malformed)warnings.push(`${malformed} unreadable record(s) omitted.`);
  return {ref:source.ref,source:source.source,cwd,updatedAt:source.updatedAt,title:(title||messages.find(m=>m.role==='user')?.text||source.title).replace(/\s+/g,' ').slice(0,100),messages,warnings};
}
