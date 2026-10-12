import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL, URL} from 'node:url';
import vm from 'node:vm';
const root = '/Users/zj/Desktop/LumiP/LumiPlug';
const require = createRequire(path.join(root,'packages/core/package.json'));
const {Client,StreamableHTTPClientTransport} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')).href);
const app = path.join(root,'src-tauri/target/debug/bundle/macos/Lumi.app');
const executable = path.join(app,'Contents/MacOS/Lumi');
const node = process.execPath;
const worker = `
const {execFileSync,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const [pidText,executable,app]=process.argv.slice(1);
const pid=Number(pidText);
const log=path.join(os.homedir(),'Library/Logs/Lumi/restart.log');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function record(text){fs.mkdirSync(path.dirname(log),{recursive:true});fs.appendFileSync(log,new Date().toISOString()+' '+text+'\\n');}
(async()=>{
 await sleep(1500);
 const command=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();
 if(command!==executable)throw new Error('Lumi process changed; restart cancelled');
 process.kill(pid,'SIGTERM');
 let closed=false;
 for(let i=0;i<100;i++){
  try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){closed=true;break;}throw e;}
  await sleep(100);
 }
 if(!closed)throw new Error('Lumi did not close within 10 seconds; no second instance opened');
 const result=spawnSync('/usr/bin/open',[app],{stdio:'ignore'});
 if(result.error||result.status!==0)throw new Error('Lumi could not be reopened');
 record('Reopen request succeeded');
})().catch(e=>{record(e.message);process.exitCode=1;});
`;
const launcher=`
const {execFileSync,spawn}=require('node:child_process');
const executable=${JSON.stringify(executable)},app=${JSON.stringify(app)};
const entries=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\\n');
const pids=entries.flatMap(line=>{const m=line.match(/^\\s*(\\d+)\\s+(.+)$/);return m&&m[2]===executable?[Number(m[1])]:[];});
if(pids.length!==1)throw new Error('Expected exactly one running Lumi instance');
const child=spawn(process.execPath,['-e',${JSON.stringify(worker)},String(pids[0]),executable,app],{
 detached:true,stdio:'ignore',env:{PATH:process.env.PATH,HOME:process.env.HOME}
});
child.once('error',e=>{console.error(e.message);process.exitCode=1;});
child.once('spawn',()=>{child.unref();console.log('Lumi restart scheduled. Save your work before running this tool.');});
`;
new vm.Script(launcher);new vm.Script(worker);
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const command=quote(node)+' -e '+quote(launcher);
fs.writeFileSync(path.join(root,'.impeccable/review/lumi-restart/restart-command.sh'),command+'\n');
if(process.argv.includes('--verify')){console.log(JSON.stringify({valid:true,target:app,commandBytes:Buffer.byteLength(command),doesNotRun:true}));process.exit(0);}
const entries=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');
const core=entries.find(line=>/^\s*\d+\s+\S*node\b/.test(line)&&line.includes('--host 127.0.0.1')&&line.includes('--session-token')&&line.includes('--user-data-dir'));
if(!core)throw new Error('Running Lumi Core not found');
const token=core.match(/--session-token (\S+)/)?.[1],port=core.match(/--port (\d+)/)?.[1];
if(!token||!port)throw new Error('Missing live MCP connection');
const client=new Client({name:'codex-lumi-tool-builder',version:'1.0.0'});
try{
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+port+'/mcp'),{requestInit:{headers:{'x-lumiplug-session-token':token}}}));
 const listed=await client.listTools();
 const tool=listed.tools.find(t=>t.name==='Lumi.create_capability_draft');
 if(!tool?.inputSchema?.properties?.command)throw new Error('Live MCP command schema is not updated');
 if(process.argv.includes('--inspect')) {
  const restart=listed.tools.find(t=>t.name==='lumiDesktop.run');
  const tasks=await client.callTool({name:'Lumi.list_tasks',arguments:{capabilityId:'80c82bf0-9b90-4b68-9a53-fd6e9cfccbb6'}});
  console.log(JSON.stringify({tool:restart?{name:restart.name,inputSchema:restart.inputSchema}:null,tasks:tasks.structuredContent}));
  process.exitCode=0;
  await client.close();
  process.exit(0);
 }
 const context=await client.callTool({name:'Lumi.get_context',arguments:{}});
 if(context.isError)throw new Error('MCP context failed');
 const list=await client.callTool({name:'Lumi.list_capabilities',arguments:{}});
 const current=list.structuredContent?.capabilities?.find(t=>t.name==='restartLumi'&&t.namespace==='lumiDesktop');
 if(current){console.log(JSON.stringify({alreadyExists:true,capability:current}));process.exitCode=0;}
 else{
  const result=await client.callTool({name:'Lumi.create_capability_draft',arguments:{kind:'terminal',name:'restartLumi',namespace:'lumiDesktop',description:'重新运行当前 macOS Lumi：先保存窗口中的未保存内容。调用后延迟关闭当前 Lumi 并重新打开；不编译代码。重启请求记录在 ~/Library/Logs/Lumi/restart.log。',command}});
  if(result.isError)throw new Error(JSON.stringify(result.structuredContent??result.content));
  fs.writeFileSync(path.join(root,'.impeccable/review/lumi-restart/created-draft.json'),JSON.stringify(result.structuredContent,null,2));
  console.log(JSON.stringify({via:'Lumi MCP',...result.structuredContent}));
 }
}finally{await client.close();}
