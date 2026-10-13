import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { APP, prismaDatabaseUrl, prismaFailure, prismaRowsToTsv, queryReleaseLedger,
  prismaMigrationRead, prismaChildSource, migrationState, targetProcessEvidence, pm2DaemonEvidence } from './strict-readonly-preflight.mjs'

const release=APP+'/releases/fixture', envFile=APP+'/shared/.env'
const syntheticUrl='mysql'+ '://fixture:synthetic@db.example.invalid/ecfc'
const raw='DATABASE_URL="'+syntheticUrl+'"'
const manifest=Array.from({length:171},(_,i)=>({name:String(20261001000000+i)+'_fixture',checksum:i.toString(16).padStart(64,'0')}))
const rows=manifest.map(r=>({migration_name:r.name,checksum:r.checksum,finished:1n,rolled_back:0n,started:1n}))
function fixture() {
  const calls=[], opts={raw,version:'6.19.3',rows,envMode:0o100600,queryError:null}
  const io={uid:1000,home:'/home/reader',
    stat(p){calls.push(['stat',p]);return {uid:1000,mode:p===envFile?opts.envMode:0o100755,size:100,isFile:()=>true,isDirectory:()=>true,isSymbolicLink:()=>false,isSocket:()=>true}},
    real(p){calls.push(['real',p]);return p===release+'/.env'?envFile:p},
    read(p){calls.push(['read',p]);return p===envFile?opts.raw:JSON.stringify({name:'@prisma/client',version:opts.version})},
  }
  const load=p=>{calls.push(['load',p]);return {Prisma:{prismaVersion:{client:opts.version,engine:'c2990dca591cba766e3b7ef5d9e8a84796e47ab7'}},PrismaClient:class {
    constructor(options){calls.push(['constructor',options])}
    async $queryRaw(strings,...values){calls.push(['query',strings.join(''),values]);if(opts.queryError)throw opts.queryError;return opts.rows}
    async $disconnect(){calls.push(['disconnect'])}
  }}}
  return {io,load,calls,opts}
}
test('existing Client runs only fixed SELECT, no interpolation, then disconnects',async()=>{
  const f=fixture(),result=await queryReleaseLedger(release,f.io,f.load)
  assert.equal(result.status,'READ');assert.equal(migrationState(manifest,result.tsv).status,'UP_TO_DATE')
  const q=f.calls.find(c=>c[0]==='query');assert.equal(q[2].length,0)
  assert.match(q[1],/^SELECT migration_name, checksum,.*LIMIT 5001$/)
  assert.doesNotMatch(q[1],/\b(?:INSERT|UPDATE|DELETE|SET|CREATE|DROP|ALTER|CALL|OUTFILE|GET_LOCK)\b/i)
  assert.equal(f.calls.filter(c=>c[0]==='query').length,1)
  assert.equal(f.calls.at(-1)[0],'disconnect')
  const ctor=f.calls.find(c=>c[0]==='constructor')[1];assert.deepEqual(ctor.log,[])
  assert.match(ctor.datasources.db.url,/sslaccept=strict/);assert.match(ctor.datasources.db.url,/prefer_socket=false/)
  assert.doesNotMatch(JSON.stringify(result),/synthetic|db\.example/)
})
for(const option of ['', '?sslaccept=accept_invalid_certs', '?sslaccept=strict','?connection_limit=99&socket_timeout=0']) {
  test('TLS strict + bounded connection policy in memory: '+option,()=>{
    const v=prismaDatabaseUrl(raw.replace(syntheticUrl,syntheticUrl+option))
    const u=new URL(v.url);assert.equal(u.searchParams.get('sslaccept'),'strict');assert.equal(u.searchParams.get('connection_limit'),'1')
    assert.equal(u.searchParams.get('socket_timeout'),'10');assert.equal(u.searchParams.get('prefer_socket'),'false')
  })
}
for(const option of ['socket=/tmp/mysql.sock','sslidentity=/tmp/key','sslpassword=synthetic','unknown=value','sslaccept=strict&sslaccept=strict','sslcert=/tmp/unapproved.pem','pool_timeout=bad']) {
  test('unsafe or unreviewed connection option blocked: '+option,()=>assert.throws(()=>prismaDatabaseUrl(raw.replace(syntheticUrl,syntheticUrl+'?'+option))))
}
for(const mode of [0o100644,0o100660,0o100777]) test('unsafe existing env permissions stop before credential read: '+mode,async()=>{
  const f=fixture();f.opts.envMode=mode;assert.equal((await queryReleaseLedger(release,f.io,f.load)).status,'UNKNOWN')
  assert.equal(f.calls.some(c=>c[0]==='read'),false);assert.equal(f.calls.some(c=>c[0]==='load'),false)
})
for(const scenario of ['parentSymlink','parentWritable','parentOwner','envOutside','clientOutside','clientVersion','malformedConfig','caSymlink']) {
  test('metadata/config guard prevents client construction: '+scenario,async()=>{
    const f=fixture(),stat=f.io.stat,real=f.io.real
    f.io.stat=p=>{const s=stat(p);if(p===APP+'/shared'){
      if(scenario==='parentSymlink')s.isSymbolicLink=()=>true
      if(scenario==='parentWritable')s.mode=0o40777
      if(scenario==='parentOwner')s.uid=4444
    } return s}
    f.io.real=p=>scenario==='envOutside'&&p.endsWith('/.env')?'/tmp/outside':scenario==='clientOutside'&&p.endsWith('/package.json')?'/tmp/client':scenario==='caSymlink'&&p==='/etc/ssl/certs/ca-certificates.crt'?'/tmp/ca':real(p)
    if(scenario==='clientVersion')f.opts.version='7.0.0'
    if(scenario==='malformedConfig')f.opts.raw='DATABASE_URL=invalid'
    if(scenario==='caSymlink')f.opts.raw=raw.replace(syntheticUrl,syntheticUrl+'?sslcert=/etc/ssl/certs/ca-certificates.crt')
    assert.equal((await queryReleaseLedger(release,f.io,f.load)).status,'UNKNOWN')
    assert.equal(f.calls.some(c=>c[0]==='constructor'),false)
  })
}
for(const code of ['P1000','P1001','P1002','P1011','P2010','P2024','secret-error']) test('query exceptions sanitized and disconnected: '+code,async()=>{
  const f=fixture();f.opts.queryError=Object.assign(Error(syntheticUrl),{code,meta:{password:'synthetic'}})
  const result=await queryReleaseLedger(release,f.io,f.load)
  assert.equal(result.status,'UNKNOWN');assert.match(result.reason,/^PRISMA_[A-Z_]+$/)
  assert.doesNotMatch(JSON.stringify(result),/synthetic|mysql:\/\/|password/)
  assert.equal(f.calls.at(-1)[0],'disconnect')
})
for(const kind of ['badName','badChecksum','badFlag','oversize']) test('ledger response validation: '+kind,()=>{
  const r=structuredClone(rows)
  if(kind==='badName')r[0].migration_name='../outside'
  if(kind==='badChecksum')r[0].checksum='bad'
  if(kind==='badFlag')r[0].finished='1'
  if(kind==='oversize')r.push(...Array(5001).fill(r[0]))
  assert.throws(()=>prismaRowsToTsv(r))
})
for(const [kind,mutate,status] of [
  ['checksum',r=>r[0].checksum='f'.repeat(64),'DIVERGENCE'],['duplicate',r=>r.push({...r[0]}),'DIVERGENCE'],
  ['failed',r=>r[0].finished=0,'FAILED'],['unfinished',r=>r[0].started=0,'FAILED'],['pending',r=>r.pop(),'PENDING']]) {
  test('real ledger semantics detect '+kind,()=>{const r=structuredClone(rows);mutate(r);assert.equal(migrationState(manifest,prismaRowsToTsv(r)).status,status)})
}
test('child clean environment, bounded timeout; argv/stdout contain no credentials',()=>{
  let invocation
  const io={home:'/home/reader',run(...args){invocation=args;return {status:0,stdout:'PRISMA_LEDGER='+JSON.stringify({status:'READ',tsv:prismaRowsToTsv(rows),backend:'EXISTING_PRISMA_CLIENT',tls:'STRICT_CERT_AND_DOMAIN'})+'\n',stderr:syntheticUrl}}}
  assert.equal(prismaMigrationRead(release,manifest,io).status,'UP_TO_DATE')
  assert.equal(invocation[0],'/usr/bin/node');assert.equal(invocation[2].timeout,25000)
  assert.equal(invocation[2].shell,false);assert.doesNotMatch(JSON.stringify(invocation[1]),/synthetic/)
  assert.doesNotMatch(JSON.stringify(invocation[2].env),/DATABASE_URL|DEBUG|NODE_OPTIONS|COMPILE_CACHE|COVERAGE/)
})
for(const result of [{status:0,stdout:'noise\nPRISMA_LEDGER={}'},{status:0,stdout:'PRISMA_LEDGER={bad'},
  {status:1,stdout:syntheticUrl,stderr:syntheticUrl},{status:null,error:{code:'ETIMEDOUT'}},
  {status:0,stdout:'PRISMA_LEDGER='+JSON.stringify({status:'UNKNOWN',reason:syntheticUrl})}]) {
  test('child failure/malformed output is fail-closed and sanitized',()=>{
    const r=prismaMigrationRead(release,manifest,{home:'/home/reader',run:()=>result})
    assert.equal(r.status,'UNKNOWN');assert.doesNotMatch(JSON.stringify(r),/synthetic|mysql:\/\//)
  })
}
test('child AST is syntax-valid and has only read filesystem operations + one fixed query',()=>{
  const require=createRequire(import.meta.url),parserRoot=process.env.PREFLIGHT_PARSER_ROOT
  const {parse}=require(path.join(parserRoot,'acorn'));const child=prismaChildSource()
  const ast=parse(child,{ecmaVersion:'latest',sourceType:'module'}),allowed=new Set(['lstatSync','realpathSync','readFileSync'])
  function visit(n){if(!n||typeof n!=='object')return
    if(n.type==='MemberExpression'&&n.object?.name==='fs')assert.ok(allowed.has(n.property.name))
    for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v)
  }visit(ast)
  assert.equal((child.match(/db\.\$queryRaw`/g)||[]).length,1)
  assert.doesNotMatch(child,/\$executeRaw|\$transaction|migrate|dotenv|pm2|\.env\./)
})
test('target endpoint evidence never overrides global coverage or PM2 UNKNOWN',()=>{
  const row={name:'easonfansclub',pid:12,startTicks:'123',cwd:release,identityStable:true,deleted:false}
  const a={processes:{rows:[row],inaccessible:145}},b=structuredClone(a)
  const result=targetProcessEvidence(a,b);assert.equal(result.easonfansclub.state,'TARGET_ENDPOINTS_MATCH')
  assert.equal(result['instagram-sync-worker'].state,'UNKNOWN');assert.equal(result.easonfansclub.atomic,false)
  b.processes.rows[0].startTicks='456';assert.equal(targetProcessEvidence(a,b).easonfansclub.state,'UNSTABLE')
})
test('PM2 daemon metadata is never PM2 ONLINE, never daemon start or RPC',()=>{
  const f=fixture();assert.equal(pm2DaemonEvidence(f.io).applicationStatus,'UNKNOWN')
  assert.equal(pm2DaemonEvidence(f.io).rpcAttempted,false)
  const source=fs.readFileSync(new URL('./strict-readonly-preflight.mjs',import.meta.url),'utf8')
  assert.doesNotMatch(source,/import.+(?:pm2|axon|net)|pm2\.(?:connect|list)|pm2 jlist/)
})
