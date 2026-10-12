import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
const command = fs.readFileSync(fileURLToPath(new URL('./mysql-client-metadata-check.sh', import.meta.url)), 'utf8')
const node = process.execPath
// Linux uses native Bash; Windows local reviewers explicitly select Git Bash.
const bash = process.env.METADATA_TEST_BASH || 'bash'
const blocks = Object.fromEntries(['CHECK_PIN','REMOTE_NODE','FILTER_OUTPUT'].map(tag =>
  [tag, command.split("<<'" + tag + "'\n")[1].split('\n' + tag)[0]]))
const reports = []

{

function runVM(code, context) {
  const logs=[], proc=context.process||{env:{},getuid:()=>1000};
  vm.runInNewContext(code.replace(/^import .+$/gm,''),{...context,process:proc,console:{log:v=>logs.push(String(v))}}, {timeout:1000});
  return {logs,exit:proc.exitCode||0};
}
const candidates=['/usr/bin/mysql','/usr/local/bin/mysql','/bin/mysql'];
const parents=['/','/usr','/usr/bin','/usr/local','/usr/local/bin','/bin'];
const home='/home/audit-fixture';
function stat(kind='FILE', overrides={}) {
  return {uid:0,gid:0,dev:2049,ino:77,mode:kind==='DIRECTORY'?0o40755:kind==='SYMLINK'?0o120777:0o100755,
    isFile:()=>kind==='FILE',isDirectory:()=>kind==='DIRECTORY',isSymbolicLink:()=>kind==='SYMLINK',...overrides};
}
function fixture() {
  const entries=new Map(parents.map(p=>[p,stat('DIRECTORY')]));entries.set('/home',stat('DIRECTORY'));
  candidates.forEach(p=>entries.set(p,stat()));
  entries.set(home,stat('DIRECTORY',{uid:1000,gid:1000,mode:0o40700}));
  entries.set(home+'/.mylogin.cnf',stat('FILE',{uid:1000,gid:1000,mode:0o100600}));
  const links=new Map(), denied=new Map(), calls=[];
  const io=new Proxy({
    constants:{X_OK:1},
    lstatSync(p){calls.push(['lstat',p]);if(denied.has(p))throw Object.assign(new Error('CANARY_PRIVATE_DATA'),{code:denied.get(p)});if(!entries.has(p))throw Object.assign(new Error('CANARY_PRIVATE_DATA'),{code:'ENOENT'});return entries.get(p);},
    readlinkSync(p){calls.push(['readlink',p]);if(!links.has(p))throw Object.assign(new Error('CANARY_PRIVATE_DATA'),{code:'EINVAL'});return links.get(p);},
    realpathSync(p){calls.push(['realpath',p]);return links.get(p)||p;},
    accessSync(p){calls.push(['access',p]);const err=denied.get('access:'+p);if(err)throw Object.assign(new Error('CANARY_PRIVATE_DATA'),{code:err});},
  },{get(t,k){if(k in t)return t[k];calls.push(['FORBIDDEN',String(k)]);throw Error('FORBIDDEN_FS_API');}});
  const proc={env:{HOME:home},getuid:()=>1000};
  return {entries,links,denied,calls,io,proc};
}
function inspectMock(f=fixture()) {
  const r=runVM(blocks.REMOTE_NODE,{fs:f.io,path:path.posix,process:f.proc});
  return {...r,data:JSON.parse(r.logs[0]),fixture:f};
}
function filter(raw) {return runVM(blocks.FILTER_OUTPUT,{process:{env:{METADATA_RESULT:raw}}});}
const tests=[];
function check(name, body) {try{body();tests.push({name,pass:true});}catch{tests.push({name,pass:false});}}
for(const [name,src]of Object.entries(blocks))check('syntax '+name,()=>assert.equal(spawnSync(node,['--input-type=module','--check'],{input:src,encoding:'utf8',timeout:10000}).status,0));
check('Bash syntax only',()=>assert.equal(spawnSync(bash,['--noprofile','--norc','-n'],{input:command,encoding:'utf8',timeout:10000}).status,0));
check('fixed candidates and parents',()=>{const r=inspectMock();assert.deepEqual(r.data.candidates.map(x=>x.path),candidates);assert.deepEqual(r.data.parents.map(x=>x.path),parents);});
check('all metadata never asserts version connection or GO',()=>{const r=inspectMock();assert.equal(r.data.clientVersion,'NOT_CHECKED');assert.equal(r.data.databaseConnection,'NOT_CHECKED');assert.equal(r.data.releaseDecision,'NO_GO');assert.equal(r.data.login.namedLoginPath,'NOT_CHECKED');assert.equal(r.data.login.databasePrivileges,'NOT_CHECKED');});
check('no remote content reads writes client execution or network APIs',()=>{const r=inspectMock();assert.ok(r.fixture.calls.every(c=>['lstat','readlink','realpath','access'].includes(c[0])));assert.ok(r.fixture.calls.filter(c=>c[0]==='realpath').every(c=>c[1]===home));});
for(const p of candidates)check('missing candidate '+p,()=>{const f=fixture();f.entries.delete(p);const r=inspectMock(f).data.candidates.find(x=>x.path===p);assert.equal(r.state,'UNKNOWN');assert.equal(r.reason,'NOT_FOUND');});
for(const code of ['EACCES','EPERM','EIO'])check('sanitized candidate exception '+code,()=>{const f=fixture();f.denied.set(candidates[0],code);const r=inspectMock(f);assert.equal(r.data.candidates[0].reason,code==='EIO'?'IO_ERROR':'ACCESS_DENIED');assert.ok(!r.logs.join('').includes('CANARY_PRIVATE_DATA'));});
check('usrmerge bin symlink resolution remains within listed paths',()=>{const f=fixture();f.entries.set('/bin',stat('SYMLINK'));f.links.set('/bin','usr/bin');const r=inspectMock(f);assert.equal(r.data.candidates[2].realPath,'/usr/bin/mysql');});
check('candidate symlink to approved alternate path',()=>{const f=fixture();f.entries.set(candidates[0],stat('SYMLINK'));f.links.set(candidates[0],'/usr/local/bin/mysql');assert.equal(inspectMock(f).data.candidates[0].realPath,'/usr/local/bin/mysql');});
check('final client link outside scope is not followed',()=>{const f=fixture();f.entries.set(candidates[0],stat('SYMLINK'));f.links.set(candidates[0],'/unapproved/client');const r=inspectMock(f);assert.equal(r.data.candidates[0].reason,'OUTSIDE_SCOPE');assert.ok(!f.calls.some(c=>c[1]==='/unapproved/client'));assert.ok(!r.logs.join('').includes('/unapproved/client'));});
check('outside parent link is reported without exposing destination',()=>{const f=fixture();f.entries.set('/usr',stat('SYMLINK'));f.links.set('/usr','/unapproved');const r=inspectMock(f);assert.equal(r.data.candidates[0].reason,'OUTSIDE_SCOPE');assert.ok(!r.logs.join('').includes('/unapproved'));});
check('symlink cycle has bounded metadata calls',()=>{const f=fixture();f.entries.set(candidates[0],stat('SYMLINK'));f.links.set(candidates[0],'/usr/bin/mysql');const r=inspectMock(f);assert.equal(r.data.candidates[0].reason,'SYMLINK_LIMIT');assert.ok(f.calls.length<200);});
check('no executable check for a directory masquerading as client',()=>{const f=fixture();f.entries.set(candidates[0],stat('DIRECTORY'));const r=inspectMock(f);assert.equal(r.data.candidates[0].target.type,'DIRECTORY');assert.equal(r.data.candidates[0].executableBySshUser,'NOT_APPLICABLE');assert.ok(!f.calls.some(c=>c[0]==='access'&&c[1]===candidates[0]));});
for(const [label,s]of [['nonroot',stat('FILE',{uid:1000})],['writable',stat('FILE',{mode:0o100777})]])check('unsafe client metadata '+label,()=>{const f=fixture();f.entries.set(candidates[0],s);assert.equal(inspectMock(f).data.candidates[0].rootOwnedNotGroupOrOtherWritable,false);});
check('access denied is not executable',()=>{const f=fixture();f.denied.set('access:'+candidates[0],'EACCES');assert.equal(inspectMock(f).data.candidates[0].executableBySshUser,'UNKNOWN');assert.equal(inspectMock(f).data.candidates[0].execution.classification,'ACCESS_DENIED');});
check('login metadata private owner and mode only',()=>{const r=inspectMock();assert.equal(r.data.login.state,'PRESENT');assert.equal(r.data.login.ownerMatchesSshUser,true);assert.equal(r.data.login.privateMode,true);assert.equal(r.data.login.ownerReadWriteBits,true);assert.ok(r.fixture.calls.filter(c=>c[1]===home+'/.mylogin.cnf').every(c=>c[0]==='lstat'));assert.ok(!r.logs.join('').includes(home));});
for(const code of ['ENOENT','EACCES','EPERM','EIO'])check('login metadata failure '+code,()=>{const f=fixture();f.denied.set(home+'/.mylogin.cnf',code);const r=inspectMock(f);assert.equal(r.data.login.state,'UNKNOWN');assert.equal(r.data.login.reason,code==='ENOENT'?'NOT_FOUND':code==='EIO'?'IO_ERROR':'ACCESS_DENIED');assert.ok(!r.logs.join('').includes('CANARY_PRIVATE_DATA'));});
check('login symlink not dereferenced or read',()=>{const f=fixture();f.entries.set(home+'/.mylogin.cnf',stat('SYMLINK',{uid:1000}));f.links.set(home+'/.mylogin.cnf','/private/credentials');const r=inspectMock(f);assert.equal(r.data.login.file.type,'SYMLINK');assert.ok(!f.calls.some(c=>c[0]!=='lstat'&&c[1]===home+'/.mylogin.cnf'));assert.ok(!r.logs.join('').includes('/private'));});
check('wrong login owner and public permissions are flagged',()=>{const f=fixture();f.entries.set(home+'/.mylogin.cnf',stat('FILE',{uid:0,mode:0o100644}));const r=inspectMock(f).data.login;assert.equal(r.ownerMatchesSshUser,false);assert.equal(r.privateMode,false);});
for(const h of ['','/','/home/../private','/home/has space'])check('unsafe HOME rejected without login lookup '+JSON.stringify(h),()=>{const f=fixture();f.proc.env.HOME=h;const r=inspectMock(f);assert.equal(r.data.login.reason,'HOME_UNVERIFIED');assert.ok(!f.calls.some(c=>String(c[1]).endsWith('/.mylogin.cnf')));});
check('HOME symlink rejects login lookup',()=>{const f=fixture();f.entries.set(home,stat('SYMLINK',{uid:1000}));f.links.set(home,'/other/home');const r=inspectMock(f);assert.equal(r.data.login.reason,'HOME_UNVERIFIED');assert.ok(!f.calls.some(c=>c[1]===home+'/.mylogin.cnf'));});
check('noncanonical HOME real path rejects login lookup',()=>{const f=fixture();f.entries.set('/home',stat('SYMLINK'));f.links.set('/home','/other/home');const r=inspectMock(f);assert.equal(r.data.login.reason,'HOME_UNVERIFIED');assert.ok(!f.calls.some(c=>c[1]===home+'/.mylogin.cnf'));});
const goodRaw=JSON.stringify(inspectMock().data);
check('output filter accepts complete sanitized metadata',()=>{const r=filter(goodRaw);assert.equal(r.exit,0);assert.equal(JSON.parse(r.logs[0]).releaseDecision,'NO_GO');});
for(const [name,raw]of [
 ['invalid JSON','startup CANARY_PRIVATE_DATA'],
 ['extra startup output','CANARY_PRIVATE_DATA\n'+goodRaw],
 ['oversize','x'.repeat(65537)],
 ['credential field',JSON.stringify({...JSON.parse(goodRaw),password:'CANARY_PRIVATE_DATA'})],
 ['credential-shaped path',goodRaw.replace('/usr/bin/mysql','/private/CANARY_PRIVATE_DATA')],
 ['raw error field',JSON.stringify({...JSON.parse(goodRaw),reason:'CANARY_PRIVATE_DATA'})],
 ['GO',goodRaw.replace('"NO_GO"','"GO"')],
])check('output filter rejects '+name,()=>{const r=filter(raw);assert.equal(r.exit,1);assert.deepEqual(JSON.parse(r.logs[0]),{status:'FAIL',result:'FAIL_CLOSED',reason:'OUTPUT_SCHEMA_INVALID',releaseDecision:'NO_GO'});});
const pinBase={SSH_HOST:'fixture.example.invalid',SSH_PORT:'22',KEY_FILE:'/runner/key',HOSTS_FILE:'/runner/hosts'};
function pinFixture({hosts='fixture.example.invalid ssh-ed25519 QUJD',fileMeta={},env={}}={}){
 const calls=[],proc={env:{...pinBase,...env},getuid:()=>1000};
 const pinFs={lstatSync:p=>stat('FILE',{uid:1000,mode:0o100600,...fileMeta}),
 readFileSync(p){calls.push(p);assert.equal(p,'/runner/hosts');return hosts;}};
 return {...runVM(blocks.CHECK_PIN,{fs:pinFs,process:proc}),calls};
}
check('pinned public host file is accepted, private key is never read',()=>{const r=pinFixture();assert.equal(r.exit,0);assert.deepEqual(r.calls,['/runner/hosts']);});
check('nondefault port must match bracketed pin',()=>assert.equal(pinFixture({hosts:'[fixture.example.invalid]:2222 ssh-ed25519 QUJD',env:{SSH_PORT:'2222'}}).exit,0));
for(const [label,hosts]of [
 ['wrongHost','other.invalid ssh-ed25519 QUJD'],['wrongPort','[fixture.example.invalid]:2222 ssh-ed25519 QUJD'],
 ['wildcard','*.invalid ssh-ed25519 QUJD'],['extraKey','fixture.example.invalid ssh-ed25519 QUJD\nother.invalid ssh-ed25519 QUJD'],
 ['CA','@cert-authority fixture.example.invalid ssh-ed25519 QUJD'],['badType','fixture.example.invalid bogus QUJD'],
 ['badEncoding','fixture.example.invalid ssh-ed25519 ?'],
])check('pinned host rejects '+label,()=>assert.equal(pinFixture({hosts}).exit,1));
for(const [label,fileMeta]of [
 ['wrongOwner',{uid:0}],['publicMode',{mode:0o100644}],['symlink',{isSymbolicLink:()=>true}],['nonFile',{isFile:()=>false}],
])check('local credential metadata rejects '+label,()=>assert.equal(pinFixture({fileMeta}).exit,1));

// Requirements intentionally checked adversarially, not asserted PASS by assumption.
check('scope: parent symlink blocked BEFORE descendant lstat',()=>{
 const f=fixture();f.entries.set('/usr',stat('SYMLINK'));f.links.set('/usr','/unapproved');
 const r=inspectMock(f);const parentRead=f.calls.findIndex(c=>c[0]==='readlink'&&c[1]==='/usr');
 const descendant=f.calls.findIndex(c=>c[0]==='lstat'&&c[1]==='/usr/bin/mysql');
 assert.ok(parentRead>=0);assert.equal(descendant,-1);
});
check('uncertain access failure remains UNKNOWN, not permission denial',()=>{
 const f=fixture();f.denied.set('access:'+candidates[0],'EIO');
 assert.equal(inspectMock(f).data.candidates[0].executableBySshUser,'UNKNOWN');
});
check('output filter rejects success envelope missing candidates parents login',()=>{
 const r=filter(JSON.stringify({check:'MYSQL_CLIENT_METADATA_ONLY_V2',releaseDecision:'NO_GO'}));assert.equal(r.exit,1);
});
reports.push({suite:'legacy-metadata-59',tests:tests.length,pass:tests.filter(t=>t.pass).length,fail:tests.filter(t=>!t.pass).length,failures:tests.filter(t=>!t.pass).map(t=>t.name),productionConnectionAttempted:false,testFixtureFilesCreated:0});

const legacyCount = tests.length
function filteredData(f = fixture()) {
  const observed = inspectMock(f)
  const checked = filter(JSON.stringify(observed.data))
  return { observed, checked, output: JSON.parse(checked.logs[0]) }
}
function invalidOutput(mutate) {
  const data = JSON.parse(goodRaw); mutate(data)
  const checked = filter(JSON.stringify(data))
  assert.equal(checked.exit, 1)
  const out = JSON.parse(checked.logs[0])
  assert.equal(out.result, 'FAIL_CLOSED')
  assert.equal(out.status, 'FAIL')
  assert.equal(out.reason, 'OUTPUT_SCHEMA_INVALID')
}
for (const parent of parents) {
  for (const [scenario, value] of [
    ['owner', stat('DIRECTORY', { uid: 1001 })],
    ['writable', stat('DIRECTORY', { mode: 0o40777 })],
    ['not-directory', stat('FILE')],
  ]) {
    check('regression unsafe parent stops descendants: ' + parent + ' ' + scenario, () => {
      const f = fixture(); f.entries.set(parent, value)
      const r = inspectMock(f)
      const affected = candidates.filter(p => parent === '/' || p.startsWith(parent + '/'))
      for (const p of affected) {
        assert.equal(r.data.candidates.find(x => x.path === p).status, 'UNKNOWN')
        assert.ok(!f.calls.some(c => c[0] === 'lstat' && c[1] === p))
      }
      const checked = filter(JSON.stringify(r.data))
      assert.equal(checked.exit, 1)
      assert.notEqual(JSON.parse(checked.logs[0]).overallStatus, 'PASS')
    })
  }
}
for (const code of ['ENOENT','EACCES','EPERM','EIO','ENOTDIR']) {
  check('regression parent error never probes descendant: ' + code, () => {
    const f=fixture(); f.denied.set('/usr/bin',code)
    const r=inspectMock(f)
    assert.equal(r.data.candidates[0].status,'UNKNOWN')
    assert.equal(r.data.candidates[0].phase,'SKIPPED')
    assert.ok(!f.calls.some(c=>c[0]==='lstat'&&c[1]===candidates[0]))
  })
}
check('regression all candidates have checked ancestors before their first metadata operation',()=>{
 const f=fixture();inspectMock(f)
 for(const p of candidates){
  const parts=p.split('/').filter(Boolean);const expected=['/'];for(let i=1;i<parts.length;i++)expected.push('/'+parts.slice(0,i).join('/'))
  const first=f.calls.findIndex(c=>c[0]==='lstat'&&c[1]===p)
  assert.ok(first>=0)
  for(const parent of expected)assert.ok(f.calls.findIndex(c=>c[0]==='lstat'&&c[1]===parent)<first)
 }
})
check('regression observed parent change stops before client metadata',()=>{
 const f=fixture(),read=f.io.lstatSync;let reads=0
 f.io.lstatSync=(p,...args)=>{const s=read(p,...args);return p==='/usr/bin'&&++reads===2?{...s,ino:88}:s}
 const r=inspectMock(f);assert.equal(r.data.candidates[0].reason,'PARENT_CHANGED')
 assert.ok(!f.calls.some(c=>c[0]==='lstat'&&c[1]===candidates[0]))
 assert.notEqual(r.data.parents.find(x=>x.path==='/usr/bin').status,'PASS')
})
check('regression changed parent link is not followed',()=>{
 const f=fixture();f.entries.set('/bin',stat('SYMLINK'));f.links.set('/bin','/usr/bin')
 const link=f.io.readlinkSync;let reads=0
 f.io.readlinkSync=p=>p==='/bin'&&++reads===2?'/unapproved/destination':link(p)
 const r=inspectMock(f);assert.equal(r.data.candidates[2].reason,'PARENT_CHANGED')
 assert.ok(!f.calls.some(c=>c[1]==='/unapproved/destination'))
 assert.ok(!r.logs.join('').includes('/unapproved/destination'))
})
check('regression user-owned parent link is not read or followed',()=>{
 const f=fixture();f.entries.set('/bin',stat('SYMLINK',{uid:1000}));f.links.set('/bin','/usr/bin')
 const r=inspectMock(f);assert.equal(r.data.parents.find(x=>x.path==='/bin').status,'FAIL')
 assert.ok(!f.calls.some(c=>c[0]==='readlink'&&c[1]==='/bin'))
 assert.equal(r.data.candidates[2].phase,'SKIPPED')
})
for(const [code,expected]of [
 ['EACCES','ACCESS_DENIED'],['EPERM','ACCESS_DENIED'],['EIO','IO_ERROR'],
 ['ENOENT','NOT_FOUND'],['ENOTDIR','METADATA_UNAVAILABLE'],['UNRECOGNIZED','METADATA_UNAVAILABLE'],
])check('regression executable I/O uncertainty: '+code,()=>{
 const f=fixture();f.denied.set('access:'+candidates[0],code)
 const {observed,checked,output}=filteredData(f);const row=observed.data.candidates[0]
 assert.equal(row.executableBySshUser,'UNKNOWN')
 assert.equal(row.execution.status,'UNKNOWN');assert.equal(row.execution.classification,expected)
 assert.equal(row.status,'UNKNOWN');assert.equal(checked.exit,1)
 assert.equal(output.validationResult,'FAIL_CLOSED');assert.equal(output.overallStatus,'UNKNOWN')
 assert.ok(!checked.logs.join('').includes('CANARY_PRIVATE_DATA'))
})
check('regression NOT_EXECUTABLE only when all execute bits are demonstrably absent',()=>{
 const f=fixture();f.entries.set(candidates[0],stat('FILE',{mode:0o100644}))
 const {observed,checked,output}=filteredData(f);const r=observed.data.candidates[0]
 assert.equal(r.execution.classification,'NOT_EXECUTABLE');assert.equal(r.execution.status,'FAIL')
 assert.equal(r.executableBySshUser,false);assert.equal(r.status,'FAIL')
 assert.ok(!f.calls.some(c=>c[0]==='access'&&c[1]===candidates[0]))
 assert.equal(checked.exit,1);assert.equal(output.overallStatus,'FAIL')
})
check('regression changed target after X_OK remains UNKNOWN',()=>{
 const f=fixture(),read=f.io.lstatSync;let reads=0
 f.io.lstatSync=(p,...args)=>{const s=read(p,...args);return p===candidates[0]&&++reads===2?{...s,ino:88}:s}
 const {observed,checked,output}=filteredData(f)
 assert.equal(observed.data.candidates[0].reason,'PATH_CHANGED');assert.equal(checked.exit,1)
 assert.equal(output.overallStatus,'UNKNOWN')
})
for(const p of candidates){
 check('regression filter rejects missing candidate '+p,()=>invalidOutput(r=>{r.candidates=r.candidates.filter(x=>x.path!==p)}))
 check('regression filter rejects duplicated candidate '+p,()=>invalidOutput(r=>{r.candidates[1]=structuredClone(r.candidates.find(x=>x.path===p));if(p===candidates[1])r.candidates[0]=structuredClone(r.candidates[1])}))
}
for(const p of parents){
 check('regression filter rejects missing parent '+p,()=>invalidOutput(r=>{r.parents=r.parents.filter(x=>x.path!==p)}))
 check('regression filter rejects duplicated parent '+p,()=>invalidOutput(r=>{r.parents[1]=structuredClone(r.parents.find(x=>x.path===p));if(p===parents[1])r.parents[0]=structuredClone(r.parents[1])}))
}
for(const p of ['SSH_HOME_BASE','SSH_HOME']){
 check('regression filter rejects missing login parent '+p,()=>invalidOutput(r=>{r.login.parentChecks=r.login.parentChecks.filter(x=>x.path!==p)}))
 check('regression filter rejects duplicate login parent '+p,()=>invalidOutput(r=>{r.login.parentChecks[1]=structuredClone(r.login.parentChecks.find(x=>x.path===p));if(p==='SSH_HOME')r.login.parentChecks[0]=structuredClone(r.login.parentChecks[1])}))
}
for(const key of Object.keys(JSON.parse(goodRaw)))check('regression filter rejects missing envelope field '+key,()=>invalidOutput(r=>{delete r[key]}))
for(const [name,mutate]of [
 ['record null',r=>{r.candidates[0]=null}],
 ['unapproved path',r=>{r.candidates[0].path='/private/CANARY_PRIVATE_DATA'}],
 ['metadata missing',r=>{delete r.candidates[0].mode}],
 ['target metadata missing',r=>{r.candidates[0].target=null}],
 ['invalid mode',r=>{r.candidates[0].mode='CANARY_PRIVATE_DATA'}],
 ['invalid inode',r=>{r.candidates[0].identity.ino='0'}],
 ['invalid owner',r=>{r.candidates[0].uid=-1}],
 ['extra credential key',r=>{r.candidates[0].password='CANARY_PRIVATE_DATA'}],
 ['raw error',r=>{r.candidates[0].reason='CANARY_PRIVATE_DATA'}],
 ['unrequested version PASS',r=>{r.excludedChecks.clientVersion='PASS'}],
 ['mandatory N/A',r=>{r.candidates[0].status='NOT_APPLICABLE'}],
 ['unexecuted falsely PASS',r=>{r.candidates[0].phase='SKIPPED'}],
 ['invalid stage',r=>{r.login.phase='NOT_RUN'}],
 ['client parent reference missing',r=>{r.candidates[0].parentChecks=[]}],
 ['directory parent reference missing',r=>{r.parents.find(x=>x.path==='/usr/bin').parentChecks=[]}],
 ['directory chain missing',r=>{r.parents.find(x=>x.path==='/usr/bin').chain=[]}],
 ['unsafe parent falsely PASS',r=>{const p=r.parents.find(x=>x.path==='/usr');p.mode=p.target.mode='0777'}],
 ['wrong target owner falsely PASS',r=>{r.candidates[0].target.uid=1001}],
 ['fake negative executable',r=>{r.candidates[0].executableBySshUser=false;r.candidates[0].execution={status:'FAIL',classification:'NOT_EXECUTABLE'}}],
 ['login file missing',r=>{r.login.file=null}],
 ['login owner mismatch',r=>{r.login.file.uid=1001}],
 ['login permission mismatch',r=>{r.login.file.mode='0644'}],
 ['login actual review assertion',r=>{r.login.namedLoginPath='PASS'}],
 ['atomic claim',r=>{r.snapshotAtomic=true}],
 ['GO claim',r=>{r.releaseDecision='GO'}],
])check('regression strict output schema '+name,()=>invalidOutput(mutate))
for(const code of ['ENOENT','EACCES','EIO'])check('regression missing or unreadable required metadata is FAIL_CLOSED '+code,()=>{
 const f=fixture();f.denied.set(home+'/.mylogin.cnf',code)
 const {checked,output}=filteredData(f)
 assert.equal(checked.exit,1);assert.equal(output.validationResult,'FAIL_CLOSED')
 assert.equal(output.overallStatus,'UNKNOWN');assert.equal(output.login.phase,'EXECUTED')
})
check('regression skipped downstream stage cannot produce overall PASS',()=>{
 const f=fixture();f.entries.set('/usr',stat('DIRECTORY',{uid:1001}))
 const {checked,output}=filteredData(f)
 assert.equal(checked.exit,1);assert.equal(output.validationResult,'FAIL_CLOSED')
 assert.notEqual(output.overallStatus,'PASS')
 assert.ok(output.candidates.some(x=>x.phase==='SKIPPED'))
})
check('regression complete metadata PASS still excludes every credential and DB check',()=>{
 const {checked,output}=filteredData()
 assert.equal(checked.exit,0);assert.equal(output.validationResult,'PASS');assert.equal(output.overallStatus,'PASS')
 assert.equal(output.snapshotAtomic,false);assert.equal(output.scope,'METADATA_ONLY_NON_CONTINUOUS')
 assert.equal(output.releaseDecision,'NO_GO')
 assert.ok(Object.values(output.excludedChecks).every(x=>x==='NOT_APPLICABLE'))
 assert.equal(output.login.namedLoginPath,'NOT_CHECKED')
})
check('regression home symlink is stopped before login file metadata',()=>{
 const f=fixture();f.entries.set(home,stat('SYMLINK',{uid:1000}))
 const {observed,checked,output}=filteredData(f)
 assert.ok(!f.calls.some(c=>c[1]===home+'/.mylogin.cnf'))
 assert.equal(observed.data.login.phase,'SKIPPED');assert.equal(checked.exit,1)
 assert.equal(output.validationResult,'FAIL_CLOSED')
})
check('regression non-file login is not treated as usable configuration',()=>{
 const f=fixture();f.entries.set(home+'/.mylogin.cnf',stat('DIRECTORY',{uid:1000,mode:0o40700}))
 const {observed,checked,output}=filteredData(f)
 assert.equal(observed.data.login.status,'FAIL');assert.equal(checked.exit,1)
 assert.equal(output.overallStatus,'FAIL')
})
check('regression owner read-only login mode is not loosened into PASS',()=>{
 const f=fixture();f.entries.set(home+'/.mylogin.cnf',stat('FILE',{uid:1000,mode:0o100400}))
 const {observed,checked,output}=filteredData(f)
 assert.equal(observed.data.login.ownerReadWriteBits,false);assert.equal(checked.exit,1)
 assert.equal(output.overallStatus,'FAIL')
})

check('regression parent recheck happens before every child directory metadata read',()=>{
 const f=fixture(),read=f.io.lstatSync;let reads=0
 f.io.lstatSync=(p,...args)=>{const s=read(p,...args);return p==='/usr'&&++reads===2?{...s,ino:88}:s}
 const r=inspectMock(f)
 assert.ok(!f.calls.some(c=>c[0]==='lstat'&&c[1]==='/usr/bin'))
 assert.ok(!f.calls.some(c=>c[0]==='lstat'&&c[1]===candidates[0]))
 assert.notEqual(r.data.parents.find(x=>x.path==='/usr').status,'PASS')
})
check('regression advertised type matches filesystem method shape or remains UNKNOWN',()=>{
 const f=fixture();f.entries.set('/usr',stat('OTHER'))
 const {observed,checked,output}=filteredData(f)
 assert.equal(observed.data.parents.find(x=>x.path==='/usr').status,'FAIL')
 assert.equal(checked.exit,1);assert.notEqual(output.overallStatus,'PASS')
})
check('regression root-user HOME still stays within that users metadata-only scope',()=>{
 const f=fixture();f.proc.getuid=()=>0;f.proc.env.HOME='/root'
 f.entries.set('/root',stat('DIRECTORY',{uid:0,mode:0o40700}))
 f.entries.set('/root/.mylogin.cnf',stat('FILE',{uid:0,mode:0o100600}))
 const {observed,checked,output}=filteredData(f)
 assert.equal(observed.data.login.status,'PASS');assert.equal(checked.exit,0)
 assert.equal(output.login.file.uid,0)
 assert.ok(!f.calls.some(c=>c[1]===home||c[1]===home+'/.mylogin.cnf'))
 assert.ok(f.calls.filter(c=>c[1]==='/root/.mylogin.cnf').every(c=>c[0]==='lstat'))
})


for(const p of parents.filter(p=>p!=='/'))check('regression no filesystem probe follows outside directory alias '+p,()=>{
 const f=fixture();f.entries.set(p,stat('SYMLINK'));f.links.set(p,'/unapproved/CANARY_PRIVATE_DATA')
 const r=inspectMock(f)
 const permitted=new Set([...parents,...candidates,'/home',home,home+'/.mylogin.cnf'])
 assert.ok(f.calls.every(c=>permitted.has(c[1])))
 assert.ok(!r.logs.join('').includes('CANARY_PRIVATE_DATA'))
 assert.notEqual(r.data.parents.find(x=>x.path===p).status,'PASS')
})
check('regression literal legacy test suite count is retained',()=>{
 assert.equal(legacyCount,59)
})


check('regression parent alias with complete link evidence is accepted only as metadata',()=>{
 const f=fixture();f.entries.set('/bin',stat('SYMLINK'));f.links.set('/bin','/usr/bin')
 const {checked,output}=filteredData(f);assert.equal(checked.exit,0)
 assert.equal(output.overallStatus,'PASS');assert.equal(output.releaseDecision,'NO_GO')
})
check('regression client alias with complete link evidence is accepted only as metadata',()=>{
 const f=fixture();f.entries.set(candidates[0],stat('SYMLINK'));f.links.set(candidates[0],candidates[1])
 const {checked,output}=filteredData(f);assert.equal(checked.exit,0)
 assert.equal(output.candidates[0].status,'PASS');assert.equal(output.clientVersion,'NOT_CHECKED')
})
check('regression parent link target omission cannot be a complete PASS',()=>{
 const f=fixture();f.entries.set('/bin',stat('SYMLINK'));f.links.set('/bin','/usr/bin')
 const r=inspectMock(f).data;r.parents.find(x=>x.path==='/bin').linkTarget=null
 const checked=filter(JSON.stringify(r));assert.equal(checked.exit,1)
 assert.equal(JSON.parse(checked.logs[0]).result,'FAIL_CLOSED')
})
check('regression client link target omission cannot be a complete PASS',()=>{
 const f=fixture();f.entries.set(candidates[0],stat('SYMLINK'));f.links.set(candidates[0],candidates[1])
 const r=inspectMock(f).data;r.candidates[0].linkTarget=null
 const checked=filter(JSON.stringify(r));assert.equal(checked.exit,1)
 assert.equal(JSON.parse(checked.logs[0]).result,'FAIL_CLOSED')
})
for(const [name,mutate]of [
 ['outer writable client contradiction',r=>{r.candidates[0].mode='0777'}],
 ['outer writable parent contradiction',r=>{r.parents[0].mode='0777'}],
 ['client resolution chain absent',r=>{r.candidates[0].chain=[]}],
 ['client resolution chain wrong first node',r=>{r.candidates[0].chain=[candidates[1],candidates[0]]}],
 ['HOME record contradiction',r=>{r.login.home.identity.ino='88'}],
])check('regression consistent record evidence '+name,()=>invalidOutput(mutate))
check('regression canonical metadata record key order cannot create a false PASS',()=>{
 const data=JSON.parse(goodRaw)
 data.candidates[0].target=Object.fromEntries(Object.entries(data.candidates[0].target).reverse())
 const r=filter(JSON.stringify(data))
 assert.equal(r.exit,0);assert.equal(JSON.parse(r.logs[0]).overallStatus,'PASS');assert.equal(JSON.parse(r.logs[0]).releaseDecision,'NO_GO')
})

reports.push({suite:'added-boundary-regression',tests:tests.length-legacyCount,
 pass:tests.slice(legacyCount).filter(t=>t.pass).length,fail:tests.slice(legacyCount).filter(t=>!t.pass).length,
 failures:tests.slice(legacyCount).filter(t=>!t.pass).map(t=>t.name),realSshUsed:false})

if(tests.some(t=>!t.pass))process.exitCode=1;

}
{

const tests=[];function check(name,body){try{body();tests.push({name,pass:true});}catch{tests.push({name,pass:false});}}
const shellMocks=String.raw`
cat() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do printf '%s\n' "$line"; done
}
awk() {
  local bits fingerprint rest
  IFS=' ' read -r bits fingerprint rest || return 1
  printf '%s\n' "$fingerprint"
}
node() {
  local src
  src="$(cat)"
  if [[ "$src" == *"const keys = new Set("* ]]; then
    [[ "$METADATA_RESULT" == LOCAL_SSH_OUTPUT ]] || return 92
    [[ "__DOLLAR_CURLY__SIM_FILTER_EXIT:-0}" == 0 ]] || { printf '%s\n' '{"status":"FAIL","result":"FAIL_CLOSED","reason":"OUTPUT_SCHEMA_INVALID","releaseDecision":"NO_GO"}'; return 1; }
    printf '%s\n' LOCAL_FILTER_OK
  else
    return "__DOLLAR_CURLY__SIM_PIN_EXIT:-0}"
  fi
}
ssh-keygen() {
  [[ "$1" == -lf && "$2" == /runner/hosts && "$3" == -E && "$4" == sha256 ]] || return 93
  [[ "__DOLLAR_CURLY__SIM_KEYGEN_EXIT:-0}" == 0 ]] || return 1
  printf '256 %s fixture (ED25519)\n' "__DOLLAR_CURLY__SIM_KEYGEN_FINGERPRINT:-SHA256:QUJD}"
}
timeout() {
  [[ "$1" == --foreground && "$2" == --signal=TERM && "$3" == --kill-after=5s && "$4" == 45s ]] || return 94
  [[ "__DOLLAR_CURLY__SIM_TIMEOUT_EXIT:-0}" == 0 ]] || return 124
  shift 4
  "$@"
}
ssh() {
  local src args last
  src="$(cat)"
  [[ "$src" == "$SIM_REMOTE_SOURCE" ]] || return 95
  args="$*"
  for required in \
    "-F /dev/null" "-T" "-i /runner/key" \
    "BatchMode=yes" "IdentitiesOnly=yes" "IdentityAgent=none" \
    "PasswordAuthentication=no" "KbdInteractiveAuthentication=no" \
    "StrictHostKeyChecking=yes" "UserKnownHostsFile=/runner/hosts" \
    "GlobalKnownHostsFile=/dev/null" "UpdateHostKeys=no" \
    "ControlMaster=no" "ControlPath=none" "ControlPersist=no" \
    "ForwardAgent=no" "ClearAllForwardings=yes"; do
    [[ "$args" == *"$required"* ]] || return 96
  done
  [[ "$args" == *"fixtureUser@fixture.example.invalid"* ]] || return 97
  last="__DOLLAR_CURLY__!#}"
  [[ "$last" == *'exec /usr/bin/env -i PATH=/usr/bin:/bin HOME="$HOME" LANG=C /usr/bin/node --input-type=module -'* ]] || return 98
  [[ "$last" != *mysql* && "$last" != *SELECT* && "$last" != *pm2* && "$last" != *migrate* ]] || return 99
  [[ "__DOLLAR_CURLY__SIM_SSH_EXIT:-0}" == 0 ]] || return 42
  printf '%s\n' LOCAL_SSH_OUTPUT
}
`.replaceAll('__DOLLAR_CURLY__','$'+'{');
function shellRun(extra={}){
 const env={PATH:process.env.PATH,...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot}:{}),
 SSH_HOST:'fixture.example.invalid',SSH_USER:'fixtureUser',SSH_PORT:'22',KEY_FILE:'/runner/key',
 HOSTS_FILE:'/runner/hosts',PINNED_FINGERPRINT:'SHA256:QUJD',SIM_REMOTE_SOURCE:blocks.REMOTE_NODE,...extra};
 return spawnSync(bash,['--noprofile','--norc','-s'],{input:shellMocks+'\n'+command,env,encoding:'utf8',timeout:10000});
}
check('complete mock SSH uses exact stdin script and all transport safeguards',()=>{const r=shellRun();assert.equal(r.status,0);assert.equal(r.stdout.trim(),'LOCAL_FILTER_OK');});
for(const [name,extra,expected]of [
 ['missing host',{SSH_HOST:''},'CONFIG_UNAVAILABLE'],['invalid user',{SSH_USER:'bad user'},'CONFIG_UNAVAILABLE'],
 ['zero port',{SSH_PORT:'0'},'CONFIG_UNAVAILABLE'],['overflow port',{SSH_PORT:'65536'},'CONFIG_UNAVAILABLE'],
 ['leading-zero port',{SSH_PORT:'022'},'CONFIG_UNAVAILABLE'],['missing key path',{KEY_FILE:''},'CONFIG_UNAVAILABLE'],
 ['missing hosts path',{HOSTS_FILE:''},'CONFIG_UNAVAILABLE'],['bad fingerprint syntax',{PINNED_FINGERPRINT:'INVALID'},'CONFIG_UNAVAILABLE'],
 ['pin metadata rejected',{SIM_PIN_EXIT:'1'},'LOCAL_CREDENTIAL_OR_HOST_PIN_INVALID'],
 ['key format unavailable',{SIM_KEYGEN_EXIT:'1'},'HOST_PIN_UNAVAILABLE'],
 ['fingerprint mismatch',{SIM_KEYGEN_FINGERPRINT:'SHA256:REVG'},'HOST_PIN_MISMATCH'],
 ['SSH failure',{SIM_SSH_EXIT:'1'},'SSH_METADATA_CHECK_FAILED'],
 ['timeout',{SIM_TIMEOUT_EXIT:'1'},'SSH_METADATA_CHECK_FAILED'],
 ['output rejection',{SIM_FILTER_EXIT:'1'},'{"status":"FAIL","result":"FAIL_CLOSED","reason":"OUTPUT_SCHEMA_INVALID","releaseDecision":"NO_GO"}'],
])check('Bash mock fails closed: '+name,()=>{const r=shellRun(extra);assert.equal(r.status,1);const output=expected.startsWith('{')?expected:JSON.stringify({status:'FAIL',result:'FAIL_CLOSED',reason:expected,releaseDecision:'NO_GO'});assert.equal(r.stdout.trim(),output);assert.ok(!r.stdout.includes('LOCAL_FILTER_OK'));});
const require=(await import('node:module')).createRequire(import.meta.url);
const {parse}=require(process.env.PREFLIGHT_PARSER_ROOT?path.join(process.env.PREFLIGHT_PARSER_ROOT,'acorn'):'acorn');
check('AST remote imports and filesystem operations are metadata-only',()=>{
 const ast=parse(blocks.REMOTE_NODE,{ecmaVersion:'latest',sourceType:'module'});const imports=[];const calls=[];
 function visit(v){if(!v||typeof v!=='object')return;
 if(v.type==='ImportDeclaration')imports.push(v.source.value);
 if(v.type==='MemberExpression'&&v.object?.name==='fs'&&v.property?.name!=='constants')calls.push(v.property?.name);
 for(const x of Object.values(v))if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==='object')visit(x);}
 visit(ast);assert.deepEqual(imports,['node:fs','node:path']);assert.ok(calls.every(c=>['lstatSync','accessSync','readlinkSync','realpathSync'].includes(c)));
});
check('remote has no DB URL config content or process management operations',()=>{
 assert.ok(!/DATABASE_URL|mysql_config_editor|Prisma|spawn|execSync|fetch|readFile|writeFile|mkdir|unlink|chmod|pm2|SELECT/.test(blocks.REMOTE_NODE));
});
check('source sensitive scan finds no credential value or private key',()=>{
 assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|AKID)[A-Za-z0-9]{20,}|mysql:\/\/[^\s'"]+:[^\s'"]+@/.test(command));
});
reports.push({suite:'legacy-ssh-18',tests:tests.length,pass:tests.filter(t=>t.pass).length,fail:tests.filter(t=>!t.pass).length,failures:tests.filter(t=>!t.pass).map(t=>t.name),realSshUsed:false,testFixtureFilesCreated:0});
if(tests.some(t=>!t.pass))process.exitCode=1;

}
console.log(JSON.stringify({suites:reports,tests:reports.reduce((n,r)=>n+r.tests,0),pass:reports.reduce((n,r)=>n+r.pass,0),fail:reports.reduce((n,r)=>n+r.fail,0),realSshExecuted:false}));
