const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const home = require('node:os').homedir();
const install = process.env.PI_NODE_MODULES || path.join(home, '.pi/agent/install/releases/1.4.0/node_modules');
const pkg = process.env.PI_PERMISSION_PACKAGE || path.join(home, '.pi/agent/npm/node_modules/@gotgenes/pi-permission-system');
const configPath = process.argv[2] || path.resolve(__dirname, '../config.json');
const root = path.resolve(__dirname, '../.test-artifacts/fixtures');
const cwd = path.join(root, 'project').replaceAll('\\','/');
const outside = path.join(root, 'project-sibling').replaceAll('\\','/');
const { createJiti } = require(install + '/jiti');
const jiti = createJiti(__filename, {fsCache:false,moduleCache:true,alias:{
  '@earendil-works/pi-coding-agent':install+'/@earendil-works/pi-coding-agent/dist/index.js',
  '@earendil-works/pi-tui':install+'/@earendil-works/pi-tui/dist/index.js'
}});
const results=[], observations=[], setup=[];
function put(relative,content='SYNTHETIC TEST FIXTURE ONLY\n') {
  const target=path.resolve(root,relative);
  if(!target.toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep))throw Error('Fixture escaped audit root');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,content);
}
function digestTree(dir) {
  const out={};
  for(const name of fs.readdirSync(dir)) {
    const f=path.join(dir,name),st=fs.lstatSync(f);
    if(st.isSymbolicLink())out[f]='LINK:'+fs.readlinkSync(f);
    else if(st.isDirectory())Object.assign(out,digestTree(f));
    else out[f]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  }
  return out;
}
(async()=>{
  const mod=async p=>jiti.import(pkg+'/src/'+p+'.ts');
  const {unifiedConfigSchema}=await mod('config/config-schema');
  const configText=fs.readFileSync(configPath,'utf8'), policy=unifiedConfigSchema.parse(JSON.parse(configText));
  const configHash=crypto.createHash('sha256').update(configText).digest('hex');
  if(policy.yoloMode!==false || policy.authorizerChain.length)throw Error('Audit expects manual approvals, YOLO off');
  const {getParser}=await mod('access-intent/bash/parser'); await getParser();
  const {PermissionManager}=await mod('policy/permission-manager');
  const {PermissionResolver}=await mod('policy/permission-resolver');
  const {SessionRules}=await mod('session/session-rules');
  const {PathNormalizer}=await mod('path/path-normalizer');
  const {win32PathFlavor}=await mod('path/path-flavor');
  const {foldDeclaredCommandEffects,NO_DECLARED_COMMAND_EFFECTS}=await mod('config/command-effects-config');
  const {ToolCallGatePipeline}=await mod('handlers/gates/tool-call-gate-pipeline');
  const {GateRunner}=await mod('handlers/gates/runner');
  const {validateUnifiedConfig}=await mod('config/config-loader');
  const normalFiles=['src/example.ts','src/name with spaces.txt','src/naïve-文.txt','src/a.txt','new/nested/output.txt','output','src/environment.ts'];
  for(const f of normalFiles)put('project/'+f);
  put('project-sibling/outside.txt');put('project-sibling/.env');
  fs.mkdirSync(cwd+'/hw2',{recursive:true});
  const secretFiles=['.env','.env.local','.env.production','.env.example','src/.env','src/.env.test','src/normal.env.txt','config/service.env','certs/server.pem','certs/server.key','certs/server.crt','certs/server.cer','certs/server.der','certs/bundle.p12','certs/bundle.pfx','certs/bundle.p7b','certs/bundle.p7c','certs/trust.jks','certs/trust.keystore','.ssh/id_rsa','.ssh/id_ed25519','.ssh/config','.aws/credentials','.azure/token.json','.gnupg/keys.txt','.kube/config','.npmrc','.netrc','_netrc','.pypirc','.git-credentials','.docker/config.json','.config/gh/hosts.yml','GitHub CLI/hosts.yml','credentials.json','service-account-test.json'];
  for(const f of secretFiles)put('project/'+f);
  put('project-read-ask.json',JSON.stringify({permission:{read:'ask'}}));
  put('project-invalid.json',JSON.stringify({permission:{path_wrote:'deny'}}));
  put('project-write-allow.json',JSON.stringify({permission:{path_write:{'*':'allow'}}}));
  const links=[['outside-link',outside],['secret-link',cwd+'/certs']];
  for(const [name,target]of links)try{if(!fs.existsSync(cwd+'/'+name))fs.symlinkSync(target,cwd+'/'+name,'junction');setup.push({link:name,status:'created'});}catch(e){setup.push({link:name,status:'unavailable',reason:e.message});}
  const fixtureBefore=digestTree(root);
  const effects=foldDeclaredCommandEffects(NO_DECLARED_COMMAND_EFFECTS,policy.commandEffects,'global');
  function engine(options={}) {
    const workingDir=options.cwd||cwd;
    const sessionRules=new SessionRules();
    const manager=new PermissionManager({globalConfigPath:configPath,agentsDir:root+'/absent-agents',projectGlobalConfigPath:options.projectConfig,projectAgentsDir:root+'/absent-project-agents',mcpServerNames:['test'],flavor:win32PathFlavor});
    const resolver=new PermissionResolver(manager,sessionRules);
    const pipeline=new ToolCallGatePipeline(resolver,{
      getActiveSkillEntries:()=>[], getInfrastructureReadScope:()=>({dirs:options.infra||[],excludedDirs:[]}),
      getToolPreviewLimits:()=>({toolInputPreviewMaxLength:1000,toolTextSummaryMaxLength:120}),
      getPathNormalizer:()=>new PathNormalizer(win32PathFlavor,workingDir),getShellToolAliases:()=>undefined,getCommandEffects:()=>effects
    });
    return {sessionRules,manager,resolver,pipeline,workingDir};
  }
  const shared=engine();
  async function evaluate(tool,input,{e=shared,decision='approve',grant=false}={}) {
    const prompts=[],events=[],logs=[];
    const runner=new GateRunner(e.resolver,e.sessionRules,{async escalate(details){
      prompts.push({surface:details.payload?.request?.surface||details.payload?.facts?.surface,details});
      return {approved:decision==='approve',state:decision==='approve'?(grant?'approved_for_session':'approved'):'denied',decidedBy:{kind:'user',via:'dialog'}};
    }},{writeReviewLog:(event,data)=>logs.push({event,...data}),emitDecision:data=>events.push(data)},()=>false);
    const outcome=await e.pipeline.evaluate({toolName:tool,input,toolCallId:'audit-'+(results.length+observations.length),cwd:e.workingDir,agentName:null},runner);
    const hardDenied=events.some(v=>v.resolution==='policy_deny'||(v.decidedBy?.kind==='rule'&&v.action==='deny'))||logs.some(v=>v.resolution==='policy_deny'||v.event==='permission_request.policy_denied');
    const state=outcome.action==='block'?(prompts.length?'ask-denied':'deny'):(prompts.length?'ask':'allow');
    return {state,promptCount:prompts.length,outcome:outcome.action,checks:events.map(v=>({surface:v.surface,resolution:v.resolution,pattern:v.matchedPattern})),hardDenied};
  }
  async function test(category,name,tool,input,expect,options={}) {
    try {
      const got=await evaluate(tool,input,options);
      const pass=(expect.state==='not-allow'?got.state!=='allow':got.state===expect.state)&&
        (expect.prompts===undefined||got.promptCount===expect.prompts)&&
        (expect.maxPrompts===undefined||got.promptCount<=expect.maxPrompts);
      results.push({category,name,tool,input,expected:expect,...got,pass});
    }catch(e){results.push({category,name,tool,input,expected:expect,pass:false,error:e.stack});}
  }
  async function probe(name,tool,input){try{observations.push({name,tool,input,...await evaluate(tool,input)});}catch(e){observations.push({name,error:e.message});}}
  function spellings(relative) {
    const abs=cwd+'/'+relative;
    return [relative,'./'+relative,abs,abs.replaceAll('/','\\'),abs.toUpperCase(),'file:///'+abs.split('/').map((s,i)=>i===0?s:encodeURIComponent(s)).join('/'),'/c/'+abs.slice(3),'/mnt/c/'+abs.slice(3),'src/../'+relative];
  }
  for(const f of normalFiles)for(const [n,p]of spellings(f).entries())for(const tool of ['read','grep','find','ls','write','edit']){
    await test('file paths',`${tool}: ${f} spelling ${n}`,tool,{path:p,content:'proposed',oldText:'SYNTHETIC',newText:'REVISED',pattern:'TEST'}, {state:['write','edit'].includes(tool)?'ask':'allow',prompts:['write','edit'].includes(tool)?1:0});
  }
  console.log('Normal path matrix complete:',results.length);
  for(const f of secretFiles)for(const [n,p]of spellings(f).entries())for(const tool of ['read','grep','write','edit']){
    await test('secret paths',`${tool}: ${f} spelling ${n}`,tool,{path:p,content:'proposed',oldText:'x',newText:'y',pattern:'TEST'}, {state:'deny',prompts:0});
  }
  for(const f of ['.env','certs/server.pem','certs/server.crt','.npmrc','credentials.json'])for(const suffix of [':$DATA','::$DATA',':extra'])for(const tool of ['read','write','edit'])await test('Windows stream aliases',tool+' '+f+suffix,tool,{path:f+suffix,content:'x',oldText:'x',newText:'y'},{state:tool==='read'?'allow':'ask',prompts:tool==='read'?0:1});
  console.log('Secret path matrix complete:',results.length);
  for(const p of [outside+'/outside.txt','../project-sibling/outside.txt',outside.toUpperCase()+'/outside.txt',outside.replaceAll('/','\\')+'\\outside.txt','/c/'+outside.slice(3)+'/outside.txt'])for(const tool of ['read','grep','ls','write','edit']){
    await test('outside boundary',tool+' '+p,tool,{path:p,content:'x',oldText:'x',newText:'y'}, {state:'ask'});
  }
  for(const [name]of links.filter(l=>setup.some(s=>s.link===l[0]&&s.status==='created'))){
    for(const tool of ['read','write','edit'])await test('junctions',tool+' '+name,tool,{path:name+(name==='outside-link'?'/outside.txt':'/server.pem'),content:'x',oldText:'x',newText:'y'}, {state:name==='secret-link'?'deny':'ask'});
  }
  const readers=['pwd','ls','ls -la .','ls -la hw2','cat src/a.txt','head -n 2 src/a.txt','tail -n 2 src/a.txt','wc -l src/a.txt','stat src/a.txt','rg -n TEST src/','grep -n TEST src/a.txt','diff src/a.txt src/example.ts','sort src/a.txt','uniq','cut -d : -f 1 src/a.txt','tr a b','echo','echo "---"','echo "generic text 123"','echo -e "one\\ntwo"','git status','git status --short','git diff -- src/a.txt','git log --oneline -3','git show HEAD:src/a.txt','git ls-files','git branch --show-current'];
  for(const command of readers)await test('read-only bash',command,'bash',{command},{state:'allow',prompts:0});
  for(const prefix of ['echo hello','cat src/a.txt','git status --short'])for(const target of ['new.txt','out','"name with spaces.txt"',cwd+'/new.txt'])for(const op of ['>','>>','>|','2>','2>>','&>','&>>']){
    const command=prefix+' '+op+' '+target;
    await test('shell output writes',command,'bash',{command},{state:'ask'});
  }
  for(const command of ['echo hi >/dev/null','cat src/a.txt 2>/dev/null','echo hi >/dev/stdout','echo hi 2>/dev/stderr','echo hi 2>&1','echo hi >&2','cat < src/a.txt','cat src/a.txt | head -n 1','ls -la hw2; echo "---"; git status --short; echo "---"; git log --oneline -3'])await test('formatting and descriptors',command,'bash',{command},{state:'allow',prompts:0});
  for(const mutation of ['rm src/a.txt','rm -rf src','mkdir created','touch created','cp src/a.txt copied.txt','mv src/a.txt moved.txt','chmod 777 src/a.txt','git add src/a.txt','git commit -m test','git push origin main','git reset --hard HEAD','npm install lodash','npm test','pip install requests','python -c "print(1)"','node -e "console.log(1)"','bash -c "ls src"','sh -c "ls src"','eval "ls src"','sudo ls src','printf "%s" hello','sed -i s/A/B/g src/a.txt','awk \'BEGIN {print "x" > "created"}\'','find src -delete','find src -exec rm {} +','rg --pre python TEST src','rg --hostname-bin python TEST src','sort -o out','tree -o out','uniq src/a.txt output.txt','git diff --output=out','git log --output out','git diff --ext-diff','git diff --textconv']){
    await test('mutating or unproven bash',mutation,'bash',{command:mutation},{state:'not-allow'});
    for(const combine of [x=>'ls src && '+x,x=>'ls src; '+x,x=>'echo "$('+x+')"',x=>'('+x+')',x=>'{ '+x+'; }'])await test('compound bash',combine(mutation),'bash',{command:combine(mutation)},{state:'not-allow'});
  }
  for(const secret of ['.env','src/.env.test','certs/server.pem','certs/server.crt','.ssh/id_rsa','.aws/credentials'])for(const command of [`cat ${secret}`,`head -n 1 ${secret}`,`cat < ${secret}`,`echo x > ${secret}`,`echo "$(cat ${secret})"`,`ls src; cat ${secret}`,`cat "${cwd}/${secret}"`])await test('bash explicit secrets',command,'bash',{command},{state:'deny',prompts:0});
  for(const command of ['cat > created <<\'EOF\'\nhello\nEOF','cat src/a.txt; echo x >> new.txt','for f in src/a.txt; do rm "$f"; done','if [ -f src/a.txt ]; then rm src/a.txt; fi','echo "`rm src/a.txt`"','cat <(rm src/a.txt)','ls src && python <<\'PY\'\nprint(1)\nPY','cat src/a.txt > "$OUTPUT"','cat src/a.txt > $(echo out)','cat $(( > out.txt','echo "unterminated'])await test('complex shell',command,'bash',{command},{state:'not-allow'});
  for(const tool of ['powershell','mcp__test__read','mcp__test__write','custom_tool']){
    await test('other tools',tool,tool,{command:'Get-Content src/a.txt',value:'x'},{state:'ask'});
    await test('other tools secret',tool,tool,{path:'.env',command:'Get-Content .env'},{state:'deny',prompts:0});
  }
  await test('other tools','MCP proxy secret','mcp',{server:'test',tool:'read',arguments:{path:'.env'}},{state:'deny',prompts:0});
  const computedTargets=['$OUTPUT','"$OUTPUT"','${OUTPUT}','"${OUTPUT:-out}"','$(echo out)','"$(echo out)"','`echo out`','out-"$OUTPUT"','$((1 + 1))','>(cat)'];
  for(const prefix of ['cat src/a.txt','echo hello','git status --short'])for(const op of ['>','>>','>|','2>','2>>','&>','&>>','>&'])for(const target of computedTargets){
    const command=prefix+' '+op+' '+target;
    await test('computed redirect regression',command,'bash',{command},{state:'ask'});
  }
  for(const target of ['$OUTPUT','"$OUTPUT"','$(echo out)'])for(const command of [
    '> '+target+' cat src/a.txt', 'cat > '+target+' src/a.txt',
    'ls src; cat src/a.txt > '+target, '(cat src/a.txt) > '+target,
    '{ cat src/a.txt; } > '+target, 'cat src/a.txt | cat > '+target,
    'cat src/a.txt > '+target+' 2>/dev/null', 'cat src/a.txt >/dev/null 2> '+target,
    'echo "$(cat src/a.txt > '+target+')"'
  ])await test('computed redirect placement',command,'bash',{command},{state:'ask'});
  for(const prefix of ['cat src/a.txt','echo hello','git status --short'])for(const op of ['>','>>','>|','2>','2>>','&>','&>>','>&'])for(const target of ['/dev/null','"/dev/null"',"'/dev/null'"]){
    const command=prefix+' '+op+' '+target;
    await test('discard redirect regression',command,'bash',{command},{state:'allow',prompts:0});
  }
  for(const command of ['echo \'literal > "$OUTPUT"\'', 'echo \'literal $(echo out)\'', 'echo hello # > "$OUTPUT"', 'echo "$OUTPUT"', 'cat < "$INPUT"'])await test('redirect false positives',command,'bash',{command},{state:'allow',prompts:0});
  await test('computed redirect user denial','deny unresolved output','bash',{command:'cat src/a.txt > "$OUTPUT"'},{state:'ask-denied',prompts:1},{decision:'deny'});

  const denied=engine();await test('user decisions','user denies project write','write',{path:'new.txt',content:'x'},{state:'ask-denied',prompts:1},{e:denied,decision:'deny'});
  const once=engine();for(let i=0;i<2;i++)await test('user decisions','approve once asks again '+i,'write',{path:'new.txt',content:'x'},{state:'ask',prompts:1},{e:once});
  const session=engine();await test('session approvals','first write session approval','write',{path:'src/new.txt',content:'x'},{state:'ask',prompts:1},{e:session,grant:true});
  await test('session approvals','same directory write uses session grant','write',{path:'src/another.txt',content:'x'},{state:'allow',prompts:0},{e:session});
  await test('session approvals','intended session grant supersedes secret deny','write',{path:'src/.env',content:'x'},{state:'allow',prompts:0},{e:session});
  session.sessionRules.clear();await test('session approvals','cleared grants ask again','write',{path:'src/new.txt',content:'x'},{state:'ask',prompts:1},{e:session});
  const infra=engine({infra:[cwd]});await test('infrastructure','infra secret still denied','read',{path:'.env'},{state:'deny',prompts:0},{e:infra});
  const tightened=engine({projectConfig:root+'/project-read-ask.json'});await test('project composition','project read ask overrides global allow','read',{path:'src/a.txt'},{state:'ask',prompts:1},{e:tightened});
  const invalid=engine({projectConfig:root+'/project-invalid.json'});await test('project composition','invalid project config floors read to ask','read',{path:'src/a.txt'},{state:'ask'},{e:invalid});await test('project composition','invalid project keeps secret deny','read',{path:'.env'},{state:'deny',prompts:0},{e:invalid});
  const broadened=engine({projectConfig:root+'/project-write-allow.json'});await test('project composition','explicit project write allow overrides global ask','write',{path:'src/a.txt',content:'x'},{state:'allow',prompts:0},{e:broadened});await test('project composition','merged project wildcard retains secret-specific deny','write',{path:'.env',content:'x'},{state:'deny',prompts:0},{e:broadened});
  const newCwd=engine({cwd:outside});await test('CWD changes','new cwd is automatically readable','read',{path:'outside.txt'},{state:'allow',prompts:0},{e:newCwd});await test('CWD changes','old cwd is now outside','read',{path:cwd+'/src/a.txt'},{state:'ask',prompts:1},{e:newCwd});
  for(const bad of [{permission:{path_wrote:'ask'}},{permission:{read:'maybe'}},{permission:{path_write:12}},{yoloMode:'false'},{authorizerChain:'auto'}]){
    const valid=validateUnifiedConfig(bad);results.push({category:'schema rejection',name:JSON.stringify(bad),pass:valid.issues.length>0,issues:valid.issues});
  }
  for(const [name,tool,input]of [
    ['recursive content search may visit secrets','bash',{command:'grep -R TEST .'}],
    ['hidden recursive search may visit secrets','bash',{command:'rg --hidden --no-ignore TEST .'}],
    ['variable-built read has no resolved file','bash',{command:'cat "$FILE"'}],
    ['variable set to secret then read','bash',{command:'FILE=.env; cat "$FILE"'}],
    ['Bash glob can select secret names','bash',{command:'cat certs/server.p?m'}],
    ['shell variable environment output','bash',{command:'echo "$OPENAI_API_KEY"'}],
    ['PowerShell command does not use Bash path extraction','powershell',{command:'Get-Content .env'}],
    ['malformed write input validated by Pi tool schema, not policy','write',{}],
    ['quoted harmless path text can cause extra ask','bash',{command:'echo "/tmp/this is only text"'}],
    ['alternate Bash tool name defaults to ask','exec_command',{cmd:'cat .env'}]
  ])await probe(name,tool,input);
  const fixtureAfter=digestTree(root);
  const fixtureUnchanged=JSON.stringify(fixtureBefore)===JSON.stringify(fixtureAfter);
  const sourceConfigUnchanged=fs.readFileSync(configPath,'utf8')===configText;
  const byCategory={};for(const r of results){const c=byCategory[r.category]||={total:0,passed:0,failed:0};c.total++;c[r.pass?'passed':'failed']++;}
  const report={generatedAt:new Date().toISOString(),version:'41.0.0',piVersion:'1.4.0',platform:process.platform,configPath,configHash,tests:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,fixtureUnchanged,sourceConfigUnchanged,byCategory,setup,failures:results.filter(r=>!r.pass),observations,results};
  const outDir=path.resolve(__dirname,'../.test-artifacts');fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(outDir+'/pi-permission-audit.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({tests:report.tests,passed:report.passed,failed:report.failed,fixtureUnchanged,sourceConfigUnchanged,byCategory,setup,failures:report.failures.map(r=>({name:r.name,expected:r.expected,state:r.state,prompts:r.promptCount})),observations:observations.map(o=>({name:o.name,state:o.state,prompts:o.promptCount}))},null,2));
  if(report.failed||!fixtureUnchanged||!sourceConfigUnchanged)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
