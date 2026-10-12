// SPDX-License-Identifier: MPL-2.0
import {setTimeout} from 'node:timers';
import fs from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath, URL} from 'node:url';
const require = createRequire('/Users/zj/Desktop/LumiP/LumiPlug/packages/core/package.json');
const {createCapabilityDefinition} = require('@lumiplug/shared');
const here = fileURLToPath(new URL('.',import.meta.url));
const manifestPath = here+'created.json';
const manifest = fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{tools:[],tasks:[],createdAt:new Date().toISOString()};
const persist=()=>fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const core=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n').find(line=>/^\s*\d+\s+\S*node\b/.test(line)&&line.includes('--host 127.0.0.1')&&line.includes('--session-token')&&line.includes('--user-data-dir'));
if(!core)throw new Error('Lumi Core is not running');
const token=core.match(/--session-token (\S+)/)[1],port=core.match(/--port (\d+)/)[1];
async function api(action,payload={}) {
 const res=await globalThis.fetch(`http://127.0.0.1:${port}/app/tools`,{method:'POST',headers:{'content-type':'application/json','x-lumiplug-session-token':token},body:JSON.stringify({action,payload})});
 const body=await res.json();if(!body.ok)throw new Error(`${action}: ${body.error?.code}`);return body.data;
}
if(process.argv.includes('--inspect')) {
 const tools=await api('list'),tasks=await api('tasks');
 console.log(JSON.stringify({tools:tools.filter(t=>manifest.tools.some(m=>m.id===t.id)).map(t=>({name:t.name,status:t.status,enabled:t.enabled,kind:t.runnerType,operations:t.toolCount})),tasks:tasks.filter(t=>manifest.tools.some(m=>m.id===t.capabilityId)).map(t=>({name:t.capabilityName,status:t.status,truncated:t.truncated})),existingRestart:tools.some(t=>t.name==='restartLumi')},null,2));process.exit(0);
}
let server;
try{server=JSON.parse(fs.readFileSync(here+'server.json','utf8'));process.kill(server.pid,0);const res=await globalThis.fetch(`http://127.0.0.1:${server.port}/json`);if(!res.ok)server=null;}catch{server=null;}
if(!server) {
 const log=fs.openSync(here+'server.log','a');
 const child=spawn(process.execPath,[here+'server.mjs'],{detached:true,stdio:['ignore',log,log]});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();fs.closeSync(log);
 for(let i=0;i<50;i++){await sleep(100);try{server=JSON.parse(fs.readFileSync(here+'server.json','utf8'));if(server.pid===child.pid)break;server=null;}catch{/* Wait for fixture server metadata. */}}
 if(!server)throw new Error('Local fixture server failed to start');
}
const local=`http://127.0.0.1:${server.port}`;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const nodeCommand=code=>quote(process.execPath)+' -e '+quote(code);
const field=(key,value,description,location='argument')=>({key,schema:{type:'string',default:value,description},required:false,aiVisible:true,value:null,binding:{location,key}});
async function add(key,kind,title,description,options={},mutate=()=>{},state='enabled') {
 const previous=manifest.tools.find(t=>t.key===key);if(previous)return api('get',{id:previous.id});
 let def=createCapabilityDefinition({kind,name:'审查 · '+title,namespace:'review_'+key,description:'UI 审查示例。'+description,...options});mutate(def);
 if(kind==='mcp'&&state!=='draft')def.tools=await api('discover',{definition:def});
 def=await api('save',{definition:def,expectedVersion:0});
 manifest.tools.push({key,id:def.id,name:def.name});persist();
 if(state!=='draft')def=await api('enable',{id:def.id,expectedVersion:def.version,expectedUpdatedAt:def.updatedAt});
 if(state==='disabled')def=await api('disable',{id:def.id,expectedVersion:def.version,expectedUpdatedAt:def.updatedAt});
 console.log(JSON.stringify({created:def.name,status:def.status,enabled:def.enabled}));return def;
}
async function run(def,operation=def.tools[0].name,args={},cancel=false,leaveRunning=false) {
 const old=manifest.tasks.find(t=>t.key===def.namespace+'_'+operation);if(old)return;
 const task=await api('run',{name:def.namespace+'.'+operation,arguments:args});
 manifest.tasks.push({key:def.namespace+'_'+operation,id:task.id,capabilityId:def.id});persist();
 if(cancel){await sleep(350);await api('stop',{id:task.id});}
 if(leaveRunning)return;
 for(let i=0;i<100;i++){const full=await api('task',{id:task.id});if(!['running','stopping'].includes(full.status)){console.log(JSON.stringify({executed:def.name,status:full.status,truncated:full.truncated}));return;}await sleep(100);}
 throw new Error('Fixture did not finish');
}
await add('terminal_draft','terminal','Shell 草稿','尚未填写命令。用于检查配置校验、保存与启用流程。',{command:'',cwd:''},()=>{},'draft');
await add('http_draft','http','HTTP 草稿','尚未填写请求地址。用于检查必填字段和配置表单。',{url:''},d=>d.tools[0].fields=[],'draft');
await add('mcp_draft','mcp','MCP 草稿','尚未配置连接地址。用于检查连接方式切换和工具发现。',{transport:'streamable-http',url:''},()=>{},'draft');
const success=await add('terminal_success','terminal','Shell 成功','含默认外部参数和多行命令，可审查输入说明与标准输出。',{cwd:'',command:'printf "开始检查：%s\\n" "$PROJECT"\nprintf "[1/3] 读取配置\\n[2/3] 参数校验通过\\n[3/3] 检查完成\\n"'},d=>d.tools[0].fields=[field('PROJECT','Lumi','项目名称，仅用于打印，不访问项目文件')]);await run(success);
const failure=await add('terminal_failure','terminal','Shell 失败','返回退出码 2，包含标准输出和错误输出，可检查失败与重试。',{cwd:'',command:'printf "开始演示检查\\n"\nprintf "演示错误：缺少必要的配置项\\n" >&2\nexit 2'});await run(failure);
const heartbeat=nodeCommand('let n=0;console.log("演示任务已启动，可点击停止");const timer=setInterval(()=>{console.log(new Date().toISOString()+" · 运行中 #"+(++n));if(n>=360){clearInterval(timer);console.log("演示任务自动结束");}},10000);');
const running=await add('terminal_running','terminal','Shell 运行中','每 10 秒输出一次日志，最长运行 1 小时。可审查实时日志、停止和跟随输出。',{cwd:'',command:heartbeat},d=>d.tools[0].name='start');await run(running,'start',{},false,true);
const cancelled=await add('terminal_cancelled','terminal','Shell 已取消','已执行并手动停止；再次运行后可检查停止按钮和取消状态。',{cwd:'',command:heartbeat},d=>d.tools[0].name='start');await run(cancelled,'start',{},true);
const long=await add('terminal_long','terminal','Shell 长日志与截断提示','生成大量演示日志，可检查长内容滚动、输出截断和错误提示。',{cwd:'',command:nodeCommand('for(let i=0;i<5000;i++)console.log("检查条目 "+String(i+1).padStart(4,"0")+"：演示输出，配置检查通过。");')});await run(long);
await add('terminal_disabled','terminal','Shell 已停用','完整配置但已停用。可审查重新启用、编辑和授权状态筛选。',{cwd:'',command:'printf "此工具已重新启用\\n"'},()=>{},'disabled');
const json=await add('http_json','http','HTTP JSON 成功','POST 请求含请求头、默认参数和嵌套返回字段规则。连接本机演示服务。',{url:local+'/json',method:'POST'},d=>{d.runner.settings.fixedHeaders={'X-Review-Mode':'ui'};d.runner.settings.bodyMode='json';d.runner.settings.body={scenario:'review',count:3};d.runner.settings.responseFilter={message:'.*',source:'^localhost$',request:{method:'^POST$',input:{scenario:'.*',count:'^3$',message:'.*'}},items:[{name:'.*',state:'^ready$'}]};d.tools[0].fields=[field('message','你好，Lumi','随请求发送的演示文本','body')];});await run(json);
const form=await add('http_form','http','HTTP Form 参数','表单请求含两个默认参数，可审查 form/body 切换及参数说明。',{url:local+'/form',method:'POST'},d=>{d.runner.settings.bodyMode='form';d.tools[0].fields=[field('project','Lumi','项目名称','body'),field('action','preview','操作名称','body')];d.runner.settings.responseFilter={message:'.*',request:{method:'.*',input:{project:'.*',action:'.*'}}};});await run(form);
const httpFail=await add('http_failure','http','HTTP 服务错误','本机接口固定返回 503，可审查请求失败提示与重试。',{url:local+'/failure'},d=>d.tools[0].fields=[]);await run(httpFail);
const timeout=await add('http_timeout','http','HTTP 请求超时','本机接口延迟 2 秒响应，工具在 200 毫秒后超时，用于审查超时状态。',{url:local+'/slow',timeoutMs:200},d=>d.tools[0].fields=[]);await run(timeout);
await add('http_disabled','http','HTTP 已停用','已停用的 GET 请求，无需参数，可检查 HTTP 配置和授权审阅。',{url:local+'/json'},d=>{d.tools[0].fields=[];d.runner.settings.responseFilter={message:'.*',source:'.*'};},'disabled');
const mcp=await add('mcp_multi','mcp','MCP 多操作','含文本回显、状态读取和主动失败三个操作，可审查操作选择、参数表单与执行历史。',{transport:'streamable-http',url:local+'/mcp'});await run(mcp,'echo',{text:'你好，Lumi · MCP 审查'});await run(mcp,'fail');
await add('mcp_disabled','mcp','MCP 已停用','发现了三个操作后停用，可审查 MCP 连接配置与重新启用。',{transport:'streamable-http',url:local+'/mcp'},()=>{},'disabled');
persist();console.log(JSON.stringify({createdTools:manifest.tools.length,executions:manifest.tasks.length,localServicePort:server.port}));
