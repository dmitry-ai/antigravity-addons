const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {childEnvironment,prepareProfile}=require('./launcher');
const {readProfiles}=require('./profiles');
const {bootstrap}=require('./main-bootstrap');
const fixture=context=>{const parent=os.tmpdir(),root=fs.mkdtempSync(path.join(parent,'antigravity-accounts-'));context.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(parent)+path.sep));fs.rmSync(root,{recursive:true,force:true});});return root;};
test('Account environment isolates Electron/Go home without changing the real user or inherited tools paths',()=>{
	const original={USERPROFILE:'real',APPDATA:'roaming',LOCALAPPDATA:'local',Path:'tools',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require unwanted'};
	const result=childEnvironment({homeDir:'isolated',id:'A6'},original);
	assert.equal(original.USERPROFILE,'real');assert.equal(result.USERPROFILE,'isolated');assert.equal(result.ANTIGRAVITY_ORIGINAL_USERPROFILE,'real');assert.equal(result.APPDATA,'roaming');assert.equal(result.LOCALAPPDATA,'local');assert.equal(result.Path,'tools');assert.equal(result.ELECTRON_RUN_AS_NODE,undefined);assert.equal(result.NODE_OPTIONS,undefined);
});
test('Shared skills stay at their source; existing account state and skill entries are preserved',context=>{
	const root=fixture(context),skillsRoot=path.join(root,'skills'),homeDir=path.join(root,'account/home');fs.mkdirSync(path.join(skillsRoot,'upwork-init'),{recursive:true});fs.writeFileSync(path.join(skillsRoot,'upwork-init/SKILL.md'),'---\nname: upwork-init\ndescription: test\n---\n');
	const profile={id:'A6',skillsRoot,homeDir,userDataDir:path.dirname(homeDir)},config=path.join(homeDir,'.gemini/config');prepareProfile(profile);
	const filename=path.join(config,'skills.json');assert.deepEqual(JSON.parse(fs.readFileSync(filename)),{entries:[{path:skillsRoot}]});
	fs.writeFileSync(path.join(config,'auth-sentinel'),'do not copy or overwrite');prepareProfile(profile);
	assert.equal(JSON.parse(fs.readFileSync(filename)).entries.length,1);assert.equal(fs.readFileSync(path.join(config,'auth-sentinel'),'utf8'),'do not copy or overwrite');assert.equal(fs.existsSync(path.join(config,'skills/upwork-init')),false);
	assert.throws(()=>prepareProfile({...profile,id:'A0'}),/original A0/);
});
test('Unsafe and overlapping profile directories are rejected before launching',context=>{
	const root=fixture(context),filename=path.join(root,'profiles.json');const base={schemaVersion:1,skillsRoot:root,profiles:[{id:'A0',userData:'Antigravity'},{id:'A6',userData:'Antigravity-A6',email:'admin6@mage2.pro',chromeShortcut:'6'}]};
	fs.writeFileSync(filename,JSON.stringify(base));assert.equal(readProfiles({roaming:root,filename}).length,2);
	base.profiles[1].userData='../Antigravity';fs.writeFileSync(filename,JSON.stringify(base));assert.throws(()=>readProfiles({roaming:root,filename}),/profile/);
	base.profiles[1].userData='antigravity';fs.writeFileSync(filename,JSON.stringify(base));assert.throws(()=>readProfiles({roaming:root,filename}),/profile/);
});
test('Browser routing preserves the OAuth state and callback while selecting the configured Chrome identity',async context=>{
	const root=fixture(context),events={},opened=[],native=[],paths={};const app={setPath:(key,value)=>{paths[key]=value;},getPath:key=>paths[key],setAppUserModelId:id=>{paths.appId=id;},setAsDefaultProtocolClient:()=>true,on:(event,handler)=>{events[event]=handler;}};
	const shell={openExternal:async url=>{native.push(url);}};
	const processes={spawn:(executable,args,options)=>{opened.push({executable,args,options});const child={pid:12345,on:()=>child,once:(event,callback)=>{if(event==='spawn')queueMicrotask(callback);return child;},unref:()=>{}};return child;}};
	const fakeRequire=name=>name==='electron'?{app,shell}:name==='node:os'?{homedir:()=>root}:name==='node:child_process'?processes:name===path.join(__dirname,'oauth-bridge.js')?{OAuthBridge:class{}}:name===path.join(__dirname,'window-identity.js')?{installWindowIdentity:()=>{}}:require(name);
	bootstrap(fakeRequire,{id:'A6',email:'admin6@mage2.pro',homeDir:root,userDataDir:root,codeRoot:__dirname,chrome:{executable:'chrome.exe',arguments:['--profile-directory=Profile 8']},browserEnvironment:{USERPROFILE:'real'}});
	await shell.openExternal('https://accounts.google.com/o/oauth2/auth?state=exact-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback');
	const url=new URL(opened[0].args.at(-1));assert.equal(url.searchParams.get('state'),'exact-state');assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:1234/callback');assert.equal(url.searchParams.get('login_hint'),'admin6@mage2.pro');assert.equal(opened[0].options.env.USERPROFILE,'real');assert.equal(paths.appId,'Google.Antigravity.A6');assert.equal(app.setAsDefaultProtocolClient('antigravity'),false);
	await shell.openExternal('mailto:example@example.org');assert.deepEqual(native,['mailto:example@example.org']);delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
	processes.spawn('C:/installed/language_server.exe',['--standalone','--https_server_port','0'],{env:{Path:'tools'}});
	assert.ok(opened[1].args.includes('--headless'));assert.ok(opened[1].args.includes('--gemini_dir='+path.join(root,'.gemini')));assert.equal(opened[1].options.env.USERPROFILE,root);assert.equal(opened[1].options.env.ANTIGRAVITY_VSCODE_HOST,'1');
	delete globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__;delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
});

test('The native terminal OAuth bridge accepts only the matching state at the official callback and keeps stdin open',async()=>{
	const {EventEmitter}=require('node:events'),{OAuthBridge,callbackCode}=require('./oauth-bridge');
	const child=new EventEmitter(),written=[],opened=[];child.stdin={end:()=>{throw Error('would close the auth pipe');},write:value=>written.push(value)};child.stderr=new EventEmitter();child.stdout=new EventEmitter();
	const pending={redirect:new URL('https://antigravity.google/oauth-callback'),state:'exact-pending-state'};
	const targets=[{type:'page',url:'https://antigravity.google/oauth-callback?state=wrong&code=unrelated'},{type:'page',url:'https://other.example/oauth-callback?state=exact-pending-state&code=unrelated'}];
	assert.equal(callbackCode(targets,pending),null);
	targets.push({type:'page',url:'https://antigravity.google/oauth-callback?state=exact-pending-state&code=one-time-code'});
	assert.deepEqual(callbackCode(targets,pending),{code:'one-time-code'});
	const bridge=new OAuthBridge({child,chromePort:9222,open:async url=>opened.push(url),request:async()=>Response.json(targets)});
	child.stdin.end();assert.deepEqual(written,[]);
	child.stdout.emit('data','Please visit:\n\x1b[34mhttps://accounts.google.com/o/oauth2/auth?state=exact-pending-state&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback');
	assert.deepEqual(opened,[]);child.stdout.emit('data','\x1b[0m\n');await new Promise(resolve=>setImmediate(resolve));
	assert.equal(opened.length,1);assert.deepEqual(written,['one-time-code\n']);assert.equal(bridge.pending,null);bridge.dispose();
});

test('The official callback can clear its address bar; the original navigation still must match A6 OAuth state',async context=>{
	const {EventEmitter}=require('node:events'),{OAuthBridge}=require('./oauth-bridge'),{CDP}=require('../../tools/Upgrade/code/cdp-client');
	const child=new EventEmitter(),written=[];child.stdin={end:()=>{},write:value=>written.push(value)};child.stderr=new EventEmitter();
	let closed=0;context.mock.method(CDP,'open',async url=>{assert.equal(url,'ws://127.0.0.1:9222/own-callback');return{evaluate:async()=> 'https://antigravity.google/oauth-callback?state=own-state&code=matching-code',close:()=>{closed++;}};});
	const bridge=new OAuthBridge({child,chromePort:9222,open:async()=>{},request:async()=>Response.json([{type:'page',url:'https://antigravity.google/oauth-callback',webSocketDebuggerUrl:'ws://127.0.0.1:9222/own-callback'}])});context.after(()=>bridge.dispose());
	await bridge.start(new URL('https://accounts.google.com/o/oauth2/auth?state=own-state&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback'));await new Promise(resolve=>setImmediate(resolve));
	assert.deepEqual(written,['matching-code\n']);assert.equal(closed,1);
});

test('Post-login recovery refuses A0 and never reloads an app or a draft',async context=>{
	const {refreshInitialPage}=require('./oauth-bridge'),{CDP}=require('../../tools/Upgrade/code/cdp-client'),vm=require('node:vm');
	await assert.rejects(refreshInitialPage({id:'A0',userDataDir:'unused'}),/secondary profile/);
	const root=fixture(context);fs.writeFileSync(path.join(root,'DevToolsActivePort'),'10006');const calls=[];
	context.mock.method(globalThis,'fetch',async url=>{assert.match(url,/^http:\/\/127\.0\.0\.1:10006\//);return Response.json(url.endsWith('/json/version')?{'User-Agent':'Antigravity/2.27.0'}:['blank','app','draft'].map(id=>({id,type:'page',url:'https://127.0.0.1:20006/',webSocketDebuggerUrl:'ws://127.0.0.1:10006/'+id})));});
	context.mock.method(CDP,'open',async url=>{const id=url.split('/').at(-1);return{evaluate:async expression=>vm.runInNewContext(expression,{window:{__APP_CONFIG__:id==='app'?{}:undefined},document:{readyState:'complete',body:{innerText:''},querySelectorAll:()=>id==='draft'?[{value:'user draft'}]:[]}}),call:async method=>calls.push({id,method}),close:()=>{}};});
	await refreshInitialPage({id:'A6',userDataDir:root});assert.deepEqual(calls,[{id:'blank',method:'Page.reload'}]);
});
