// SPDX-License-Identifier: MPL-2.0
import {setTimeout,clearTimeout} from 'node:timers';
// Local-only, deterministic HTTP/MCP fixtures for reviewing Lumi tools.
import fs from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath, URL, URLSearchParams} from 'node:url';
const require = createRequire('/Users/zj/Desktop/LumiP/LumiPlug/packages/core/package.json');
const {Server} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/server')).href);
const {NodeStreamableHTTPServerTransport} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/node')).href);
const outputSchema = {type:'object',properties:{message:{type:'string'},source:{type:'string'}},required:['message','source'],additionalProperties:false};
const tools = [
 {name:'echo',description:'返回输入文本，用于检查 MCP 参数与结果。',inputSchema:{type:'object',properties:{text:{type:'string',default:'你好，Lumi',description:'需要回显的文本'}},additionalProperties:false},outputSchema},
 {name:'status',description:'读取本机演示服务状态，无需参数。',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema},
 {name:'fail',description:'主动返回演示错误，方便审查失败反馈。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
];
const http = createServer(async (req,res) => {
 try {
  const url = new URL(req.url,'http://127.0.0.1');
  if(url.pathname === '/mcp') {
   const mcp = new Server({name:'lumi-ui-review',version:'1.0.0'},{capabilities:{tools:{}}});
   mcp.setRequestHandler('tools/list',async()=>({tools}));
   mcp.setRequestHandler('tools/call',async r=> {
    if(r.params.name==='fail') return {isError:true,content:[{type:'text',text:'演示错误：请求未完成，请检查配置后重试。'}]};
    const data = {message:r.params.name==='echo'?String(r.params.arguments?.text??'你好，Lumi'):'本机演示服务运行正常',source:'localhost'};
    return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
   });
   const transport = new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   res.once('close',()=>void mcp.close());
   await mcp.connect(transport);
   await transport.handleRequest(req,res);
   return;
  }
  let input=''; for await (const chunk of req) input+=chunk;
  if(url.pathname==='/slow') {
   const timer=setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({message:'延迟请求完成',source:'localhost'}));}},2000);
   res.once('close',()=>clearTimeout(timer));return;
  }
  if(url.pathname==='/failure'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({message:'演示服务暂不可用'}));return;}
  if(!['/json','/form'].includes(url.pathname)){res.writeHead(404);res.end();return;}
  const parsed = url.pathname==='/form'?Object.fromEntries(new URLSearchParams(input)):input?JSON.parse(input):{};
  const data={message:'请求成功',source:'localhost',request:{method:req.method,input:parsed},items:[{name:'Lumi',state:'ready'},{name:'工具示例',state:'ready'}],internal:'此字段不在允许返回字段中'};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
 } catch {if(!res.headersSent)res.writeHead(500);res.end();}
});
http.listen(0,'127.0.0.1',()=>fs.writeFileSync(fileURLToPath(new URL('./server.json',import.meta.url)),JSON.stringify({pid:process.pid,port:http.address().port,startedAt:new Date().toISOString()})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{http.closeAllConnections();http.close(()=>process.exit(0));});
