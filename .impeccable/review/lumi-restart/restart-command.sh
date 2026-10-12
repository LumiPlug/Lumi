'/opt/homebrew/Cellar/node/26.0.0/bin/node' -e '
const {execFileSync,spawn}=require('\''node:child_process'\'');
const executable="/Users/zj/Desktop/LumiP/LumiPlug/src-tauri/target/debug/bundle/macos/Lumi.app/Contents/MacOS/Lumi",app="/Users/zj/Desktop/LumiP/LumiPlug/src-tauri/target/debug/bundle/macos/Lumi.app";
const entries=execFileSync('\''/bin/ps'\'',['\''-axo'\'','\''pid=,command='\''],{encoding:'\''utf8'\''}).split('\''\n'\'');
const pids=entries.flatMap(line=>{const m=line.match(/^\s*(\d+)\s+(.+)$/);return m&&m[2]===executable?[Number(m[1])]:[];});
if(pids.length!==1)throw new Error('\''Expected exactly one running Lumi instance'\'');
const child=spawn(process.execPath,['\''-e'\'',"\nconst {execFileSync,spawnSync}=require('\''node:child_process'\'');\nconst fs=require('\''node:fs'\''),path=require('\''node:path'\''),os=require('\''node:os'\'');\nconst [pidText,executable,app]=process.argv.slice(1);\nconst pid=Number(pidText);\nconst log=path.join(os.homedir(),'\''Library/Logs/Lumi/restart.log'\'');\nconst sleep=ms=>new Promise(r=>setTimeout(r,ms));\nfunction record(text){fs.mkdirSync(path.dirname(log),{recursive:true});fs.appendFileSync(log,new Date().toISOString()+'\'' '\''+text+'\''\\n'\'');}\n(async()=>{\n await sleep(1500);\n const command=execFileSync('\''/bin/ps'\'',['\''-p'\'',String(pid),'\''-o'\'','\''command='\''],{encoding:'\''utf8'\''}).trim();\n if(command!==executable)throw new Error('\''Lumi process changed; restart cancelled'\'');\n process.kill(pid,'\''SIGTERM'\'');\n let closed=false;\n for(let i=0;i<100;i++){\n  try{process.kill(pid,0);}catch(e){if(e.code==='\''ESRCH'\''){closed=true;break;}throw e;}\n  await sleep(100);\n }\n if(!closed)throw new Error('\''Lumi did not close within 10 seconds; no second instance opened'\'');\n const result=spawnSync('\''/usr/bin/open'\'',[app],{stdio:'\''ignore'\''});\n if(result.error||result.status!==0)throw new Error('\''Lumi could not be reopened'\'');\n record('\''Reopen request succeeded'\'');\n})().catch(e=>{record(e.message);process.exitCode=1;});\n",String(pids[0]),executable,app],{
 detached:true,stdio:'\''ignore'\'',env:{PATH:process.env.PATH,HOME:process.env.HOME}
});
child.once('\''error'\'',e=>{console.error(e.message);process.exitCode=1;});
child.once('\''spawn'\'',()=>{child.unref();console.log('\''Lumi restart scheduled. Save your work before running this tool.'\'');});
'
