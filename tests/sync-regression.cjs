const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname,'..');
const source = name => fs.readFileSync(path.join(root,name),'utf8');
const engine = vm.runInNewContext(source('sync-state.js')+';syncState');
const plain = value => JSON.parse(JSON.stringify(value));
const seed = (id, at, cards = {}, days = {}, reset = 0) => ({id,at,kind:'seed',cards,days,reset});
const edit = (id, at, cards = {}, days = {}, reset = 0) => ({id,at,kind:'patch',cards,days,reset});

function storage(initial = {}) {
  const data = {...initial};
  const control = {failWrites:false, failKey:null};
  Object.defineProperties(data,{
    getItem:{value:key => data[key] ?? null},
    setItem:{value:(key,value) => {
      if (control.failWrites || control.failKey===key) throw Error('QuotaExceededError');
      data[key] = value;
    }},
    removeItem:{value:key => {delete data[key];}},
  });
  return {data,control};
}
function dom() {
  const nodes = new Map(), banners = [];
  const element = () => ({textContent:'',hidden:false,children:[],
    setAttribute(){},append(...children){this.children.push(...children);},click(){this.onclick?.();}});
  return {banners,nodes,document:{
    createElement:element,
    getElementById(id){if(!nodes.has(id)) nodes.set(id,element());return nodes.get(id);},
    querySelector(){return {prepend:node => banners.push(node)};},
  }};
}
const settle = () => new Promise(resolve => setTimeout(resolve,0));
async function cloudFixture() {
  const disk = storage({'unit:cloud:owner':'u'}), view = dom(), listeners = new Map(), writes = [];
  const window = {
    FLASHCARDS_FIREBASE:{},
    addEventListener(type,callback){listeners.set(type,callback);},
    dispatchEvent(event){listeners.get(event.type)?.(event);},
  };
  const context = {
    window,document:view.document,localStorage:disk.data,navigator:{onLine:true},
    location:{protocol:'https:'},KEY:'unit',settings:{resetAt:0},
    progress:{1:{state:'review',last:100,reps:1}},stats:{},undoStack:[{id:1}],
    current:null,dayKey:()=>'today',refreshAll(){},scheduleWrite(){},
    crypto:{randomUUID:require('node:crypto').randomUUID},
    fakeModules:{
      app:{initializeApp:()=>({})},
      auth:{getAuth:()=>({}),GoogleAuthProvider:function(){},
        onAuthStateChanged:(_,callback)=>callback({uid:'u',email:'test@example.test'})},
      firestore:{
        getFirestore:()=>({}),collection:()=>({}),doc:(_,id)=>id,
        onSnapshot:(_,options,callback)=>context.receive=callback,
        setDoc:(id,event)=>new Promise((resolve,reject)=>writes.push({id,event,resolve,reject})),
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source('sync-state.js')+source('progress-storage.js'),context);
  context.saveLocal = () => {
    context.localSaved = vm.runInContext("progressStorage.write({unit:progress,'unit:stats':stats})",context);
    window.dispatchEvent({type:'progress-saved'});
  };
  vm.runInContext(source('cloud-sync.js').replace("import(base+'firebase-'+n+'.js')","Promise.resolve(fakeModules[n])"),context);
  await settle();
  context.snapshot = events => context.receive({
    metadata:{fromCache:false,hasPendingWrites:false},
    docs:events.map(event=>({id:event.id,data:()=>event})),
  });
  return {context,disk,view,writes};
}

async function run() {
  const empty = seed('empty',10);
  const answer = edit('answer',100,{1:{last:100,reps:1}},{today:{reviews:1}});
  const sameBackup = seed('backup',200,{1:{last:100,reps:1}},{today:{reviews:1}});
  assert.equal(engine.replay([empty,answer,sameBackup]).days.today.reviews,1);
  const newerBackup = seed('newer',300,{1:{last:300,reps:2}},{today:{reviews:2}});
  assert.equal(engine.replay([empty,answer,newerBackup]).cards[1].reps,2);
  assert.equal(engine.replay([empty,answer,newerBackup]).days.today.reviews,2);
  assert.equal(engine.replay([empty,answer,answer]).days.today.reviews,1);
  const offline = edit('offline',400,{2:{last:400,reps:1}},{today:{reviews:1}});
  assert.equal(engine.replay([offline,newerBackup,answer,empty]).days.today.reviews,3);
  assert.equal(engine.replay([empty,answer,edit('undo',200,{1:null},{today:{reviews:-1}})]).cards[1],undefined);
  assert.equal(engine.replay([empty,answer,edit('delete',200,{1:null}),sameBackup]).cards[1],undefined);
  const reset = {id:'reset',at:500,kind:'reset',reset:500,cards:{},days:{}};
  assert.deepEqual(plain(engine.replay([empty,answer,reset,{...sameBackup,at:600},edit('old-offline',700,{2:{last:200}}, {},0)])),{cards:{},days:{},reset:500});
  const independent = engine.replay([empty,answer,edit('second',200,{2:{last:200}},{today:{reviews:1}})]);
  assert.equal(independent.days.today.reviews,2);
  assert.equal(engine.equal({a:1,nested:{a:2,b:3}},{nested:{b:3,a:2},a:1}),true);
  assert.equal(engine.patch({cards:{1:{a:1,b:2}},days:{},reset:0},{cards:{1:{b:2,a:1}},days:{},reset:0}),undefined);

  const disk = storage({a:'old-a',b:'old-b'}), view = dom();
  const context = vm.createContext({localStorage:disk.data,document:view.document});
  vm.runInContext(source('progress-storage.js'),context);
  disk.control.failKey = 'b';
  assert.equal(vm.runInContext("progressStorage.write({a:'new-a',b:'new-b'})",context),false);
  assert.equal(disk.data.getItem('a'),'old-a');
  assert.equal(disk.data.getItem('b'),'old-b');
  assert.equal(view.banners[0].hidden,false);
  disk.control.failKey = null;
  assert.equal(vm.runInContext("progressStorage.write({a:'new-a',b:'new-b'})",context),true);
  assert.equal(view.banners[0].hidden,true);

  const echo = await cloudFixture();
  const server = seed('server',50,{1:{last:100,reps:1,state:'review'}});
  echo.context.snapshot([server]);
  assert.equal(echo.context.undoStack.length,1,'own acknowledgement must preserve undo');
  echo.context.snapshot([server,edit('other',200,{2:{last:200,reps:1}})]);
  assert.equal(echo.context.undoStack.length,1,'another card must preserve undo');
  echo.context.snapshot([server,edit('same-card',300,{1:{last:300,reps:2}})]);
  assert.equal(echo.context.undoStack.length,0,'conflicting remote changes invalidate undo');

  const failure = await cloudFixture();
  failure.disk.control.failWrites = true;
  failure.context.progress = {1:{last:200,reps:2,state:'review'}};
  failure.context.stats = {today:{reviews:1}};
  failure.context.saveLocal();
  assert.equal(failure.context.localSaved,false);
  assert.equal(failure.writes.length,1);
  assert.equal(failure.view.banners[0].hidden,false);
  failure.context.snapshot([server]);
  assert.equal(failure.context.progress[1].reps,2,'remote snapshot must retain memory-only pending answers');
  failure.writes[0].reject(Error('offline'));
  await settle();
  failure.disk.control.failWrites = false;
  failure.context.saveLocal();
  assert.equal(failure.context.localSaved,true);
  assert.equal(failure.writes.length,2);
  assert.equal(failure.writes[0].id,failure.writes[1].id,'retry must reuse event identity');
  assert.ok(failure.disk.data.getItem('unit:cloud:event:'+failure.writes[1].id));
  failure.writes[1].resolve();
  await settle();
  assert.equal(failure.disk.data.getItem('unit:cloud:event:'+failure.writes[1].id),null);
  assert.equal(failure.view.banners[0].hidden,true);
  failure.context.snapshot([server,failure.writes[1].event]);
  assert.equal(failure.context.progress[1].reps,2);
  console.log('PASS: snapshot overlap, newer progress, independent answers, deduplication, undo, resets, field order, atomic storage, quota warning, retry and cloud pending durability');
}
module.exports = run;
if (require.main===module) run().catch(error => {console.error(error);process.exitCode=1;});
