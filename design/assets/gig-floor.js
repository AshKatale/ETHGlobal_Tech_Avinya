(function(){
const root=document.getElementById('gigFloor');if(!root)return;
const cv=root.querySelector('canvas'), ctx=cv.getContext('2d');
const ov=root.querySelector('.gf-ov'), stage=root.querySelector('.gf-stage');
const logEl=root.querySelector('.gf-log');
const W=480,H=288,T=16,COLS=30,ROWS=18;
ctx.imageSmoothingEnabled=false;
const rnd=(a,b)=>a+Math.random()*(b-a), pick=a=>a[Math.floor(Math.random()*a.length)];
const hex=n=>Array.from({length:n},()=>'0123456789abcdef'[Math.floor(Math.random()*16)]).join('');

/* ---------- map ---------- */
const g=[...Array(ROWS)].map(()=>Array(COLS).fill(0)); // 0 floor, 1 wall, 2 furniture
const wall=(c,r)=>{g[r][c]=1}, block=(c0,r0,c1,r1)=>{for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)g[r][c]=2};
for(let c=0;c<COLS;c++){wall(c,0);wall(c,ROWS-1)}
for(let r=0;r<ROWS;r++){wall(0,r);wall(COLS-1,r)}
g[7][0]=0;g[8][0]=0;                                     // entrance
for(let r=1;r<=5;r++){wall(9,r);wall(20,r)}
for(let c=1;c<=28;c++)wall(c,6);
[4,5,14,15,24,25].forEach(c=>g[6][c]=0);                // doors to top rooms
for(let c=20;c<=28;c++)wall(c,9);
for(let r=9;r<=16;r++)wall(20,r);
g[11][20]=0;g[15][20]=0;                                 // doors to verifier / storage
for(let c=21;c<=28;c++)wall(c,13);
block(3,1,6,2);                                          // benchmark rig
block(11,1,18,1);                                        // job board
block(11,5,13,5);                                        // sofa
block(22,1,27,3);                                        // vault
block(23,10,27,10);                                      // verifier console
block(22,14,27,14);                                      // server racks
const DESKS=[];
[10,14].forEach(r=>[2,6,10,14].forEach(c=>{block(c,r,c+1,r);DESKS.push({c,r:r+1,agent:null,dc:c,dr:r})}));
[[1,16],[18,16],[8,1],[19,4],[1,1]].forEach(([c,r])=>g[r][c]=2); // plants
const PLANTS=[[1,16],[18,16],[8,1],[19,4],[1,1]];
const zone=(c,r)=>r<=5?(c<=8?'lab':c<=19?'board':'vault'):(r>=10&&r<=12&&c>=21)?'verify':(r>=14&&c>=21)?'store':(r>=9&&c<=19)?'work':'hall';
const FLOOR={lab:['#13272b','#162c31'],board:['#1a2131','#1d2537'],vault:['#262315','#2b2818'],verify:['#13291f','#163024'],store:['#1f1a32','#231d38'],work:['#172030','#1a2436'],hall:['#151d2a','#182131']};

/* ---------- static background ---------- */
const bg=document.createElement('canvas');bg.width=W;bg.height=H;const b=bg.getContext('2d');
const R=(c,x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(x,y,w,h)};
for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
  const x=c*T,y=r*T;
  if(g[r][c]===1){R(b,x,y,T,T,'#2a3548');R(b,x,y,T,3,'#3e4c69');R(b,x,y+T-2,T,2,'#1b2333');continue}
  const z=zone(c,r),p=FLOOR[z];R(b,x,y,T,T,p[(c+r)&1]);R(b,x,y,T,1,'rgba(0,0,0,.18)');R(b,x,y,1,T,'rgba(0,0,0,.12)');
}
// entrance mat
R(b,0,7*T,4,2*T,'#3a6b52');
// desks
DESKS.forEach(d=>{const x=d.dc*T,y=d.dr*T;R(b,x+1,y+3,30,10,'#6b4f3a');R(b,x+1,y+3,30,2,'#87664b');R(b,x+1,y+12,30,3,'#4a3627');R(b,x+3,y+15,2,1,'#2a1f17');R(b,x+27,y+15,2,1,'#2a1f17');
  R(b,x+9,y+9,10,2,'#c9ced8');R(b,x+23,y+6,3,4,'#e6e1d3');/*keyboard+mug*/
  R(b,x+11,y+18,10,5,'#3b2c22');R(b,x+12,y+19,8,3,'#5a4232');/*chair*/});
// benchmark rig
(()=>{const x=3*T,y=T;R(b,x,y+2,64,28,'#2e4655');R(b,x,y+2,64,3,'#46677a');R(b,x+4,y+7,56,14,'#0b1418');R(b,x,y+27,64,3,'#1c2c35');
  [8,16,24,40,48,56].forEach(i=>R(b,x+i,y+23,4,3,'#1a2a32'))})();
// job board
(()=>{const x=11*T,y=4;R(b,x-2,y-2,132,30,'#5c6b85');R(b,x,y,128,26,'#141c2b');for(let i=0;i<128;i+=16)R(b,x+i,y,1,26,'rgba(255,255,255,.03)')})();
// sofa
(()=>{const x=11*T,y=5*T;R(b,x,y+2,48,12,'#6d3448');R(b,x,y+2,48,4,'#86445b');R(b,x,y+2,4,12,'#5a2a3b');R(b,x+44,y+2,4,12,'#5a2a3b');R(b,x+16,y+6,1,7,'#5a2a3b');R(b,x+32,y+6,1,7,'#5a2a3b')})();
// vault
(()=>{const x=22*T,y=T;R(b,x,y,96,46,'#4b5466');R(b,x,y,96,3,'#6b768c');R(b,x+2,y+44,92,2,'#2d3340');
  const cx=x+48,cy=y+22;b.fillStyle='#38404f';b.beginPath();b.arc(cx,cy,18,0,7);b.fill();b.strokeStyle='#8c97ad';b.lineWidth=2;b.beginPath();b.arc(cx,cy,18,0,7);b.stroke();
  b.strokeStyle='#c9a640';b.lineWidth=2;for(let a=0;a<6;a++){b.beginPath();b.moveTo(cx,cy);b.lineTo(cx+Math.cos(a*1.047)*11,cy+Math.sin(a*1.047)*11);b.stroke()}
  b.fillStyle='#e8c25a';b.beginPath();b.arc(cx,cy,4,0,7);b.fill();
  [[x+6,y+34],[x+12,y+36],[x+80,y+34],[x+86,y+37]].forEach(([px,py])=>{R(b,px,py,6,6,'#d9b347');R(b,px+1,py+1,3,2,'#ffe58a')})})();
// verifier console + wall screen
(()=>{const x=23*T,y=10*T;R(b,x,y+2,80,12,'#24443a');R(b,x,y+2,80,3,'#336052');R(b,x,y+13,80,3,'#163028');})();
// racks
(()=>{for(let i=0;i<3;i++){const x=22*T+i*32+2,y=13*T+4;R(b,x,y,28,28,'#2a2442');R(b,x,y,28,3,'#3e3663');for(let k=0;k<4;k++)R(b,x+3,y+6+k*5,22,3,'#16122a')}})();
// plants
PLANTS.forEach(([c,r])=>{const x=c*T,y=r*T;R(b,x+5,y+9,6,6,'#7a4a2a');R(b,x+5,y+9,6,1,'#9a6038');R(b,x+4,y+3,3,6,'#3fa45b');R(b,x+8,y+1,3,8,'#4cc06a');R(b,x+10,y+4,3,5,'#3a9452')});

/* ---------- pathfinding ---------- */
const walk=(c,r)=>c>=0&&r>=0&&c<COLS&&r<ROWS&&g[r][c]===0;
function bfs(sc,sr,tc,tr){
  if(sc===tc&&sr===tr)return[];
  const prev=new Map(),key=(c,r)=>r*COLS+c,q=[[sc,sr]];prev.set(key(sc,sr),null);
  while(q.length){const[c,r]=q.shift();if(c===tc&&r===tr)break;
    for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]]){const nc=c+dc,nr=r+dr,k=key(nc,nr);if(!prev.has(k)&&walk(nc,nr)){prev.set(k,[c,r]);q.push([nc,nr])}}}
  if(!prev.has(key(tc,tr)))return[];
  const out=[];let cur=[tc,tr];while(cur&&!(cur[0]===sc&&cur[1]===sr)){out.unshift(cur);cur=prev.get(key(cur[0],cur[1]))}
  return out.map(([c,r])=>({x:(c+.5)*T,y:(r+.5)*T,c,r}));
}

/* ---------- state ---------- */
let time=0;const S={escrow:0,paid:0,refunds:0,listed:0};
const agents=[],coins=[],sparks=[];
const PAL=['#f29a4a','#4fc9e0','#a78bfa','#f2d04a','#f27aa8','#6fdc8c','#ff7a6a','#7aa8ff'];
const NAMES=['RepoAuditor','SpecToAPI','ChainIndexer','DocSmith','TestPilot','GasGuard'];
const CANDS=['UIForge','DataScout','LintLord','SchemaBot','CronKeeper','PromptSmith','FuzzFox','InfraOwl'];
const JOBS=[['REST API',250],['Audit escrow',120],['Index events',180],['SDK docs',60],['Fix flaky tests',90],['x402 paywall',220],['Landing UI',150],['DB migration',110]];
const WORK=['> reading SPEC.md','> scaffolding repo','> writing handlers','> running tests','= fixing lint','@ fetching docs','> writing README','> refactoring utils','> adding Zod schemas'];
const SPOT={board:[[12,2],[14,2],[16,2],[18,2],[13,2],[17,2]],wait:[[11,4],[12,4],[13,4],[15,4],[17,4]],verify:[[23,11],[25,11],[27,11]],store:[[23,15],[25,15],[27,15]],lab:[[4,3]]};
const VAULT={x:22*T+48,y:T+22};
let jobSeq=1041,activeJobs=0;
const board=[];             // pinned gig cards
const lab={busy:false,start:0,score:0,who:null};
const verifier={job:null,start:0,stamp:null};
let lastHash='—';

/* ---------- overlay elements ---------- */
function el(cls,html,parent=ov){const e=document.createElement('div');e.className=cls;if(html!=null)e.innerHTML=html;parent.appendChild(e);return e}
const roomLbl=[['BENCHMARK LAB',1.2,.2],['HBAR ESCROW',21.2,.2],['WORK FLOOR',2.3,16.55],['VERIFIER',21.2,9.2],['0G STORAGE',21.2,16.55],['ENTRANCE',1.1,6.3]]
  .map(([t,c,r])=>{const e=el('gf-room',t);e._x=c*T;e._y=r*T;return e});
const labPanel=el('gf-panel minor');labPanel._x=5*T;labPanel._y=1.05*T;labPanel._center=true;
const boardHd=el('gf-room','JOB BOARD');boardHd._x=15*T;boardHd._y=6;
const boardEl=el('gf-cards');boardEl._x=15*T;boardEl._y=15;
const vaultPanel=el('gf-panel');vaultPanel._x=24.8*T;vaultPanel._y=4.05*T;vaultPanel._center=true;
const verPanel=el('gf-panel minor');verPanel._x=24.5*T;verPanel._y=9.55*T;verPanel._center=true;
const stamp=el('gf-stamp','PASS');stamp._x=24.5*T;stamp._y=11.3*T;stamp._raw=true;
const storePanel=el('gf-panel minor');storePanel._x=26*T;storePanel._y=16.45*T;storePanel._center=true;

/* ---------- agents ---------- */
function spawn(kind,name,color,c,r,x,y){
  const a={kind,name,color,c,r,x:x??(c+.5)*T,y:y??(r+.5)*T,path:[],queue:[],task:null,bubble:'',tone:'',temp:null,tempUntil:0,dir:'down',moving:false,frame:0,seated:false,busy:false,desk:null,blink:rnd(0,4),gone:false};
  a.bub=el('gf-bub');a.bub.style.display='none';
  a.tag=el('gf-name'+(kind==='client'?' client':kind==='cand'?' cand':''),name);
  agents.push(a);return a;
}
function despawn(a){a.gone=true;a.bub.remove();a.tag.remove();agents.splice(agents.indexOf(a),1)}
const W_=(to,seat)=>({t:'walk',to,seat}), SAY=(text,dur=0,tone='')=>({t:'say',text,dur,tone}), DO=fn=>({t:'do',fn}), WAIT=d=>({t:'wait',d}), UNTIL=fn=>({t:'until',fn});
function seatPx(d){return{x:(d.dc+1)*T,y:(d.r+.5)*T-1}}

function runTask(a,dt){
  if(!a.task){a.task=a.queue.shift();if(!a.task)return;a.task._t=0;a.task._init=false}
  const k=a.task;k._t+=dt;
  if(k.t==='walk'){
    if(!k._init){k._init=true;a.seated=false;
      let[tc,tr]=k.to==='exit'?[0,7]:k.to;
      a.path=bfs(a.c,a.r,tc,tr);
      if(k.seat){const p=seatPx(k.seat);a.path.push({x:p.x,y:p.y,c:tc,r:tr})}
      if(k.to==='exit')a.path.push({x:-12,y:7.5*T,c:0,r:7});
    }
    if(!a.path.length){if(k.seat)a.seated=true;a.task=null}
  }else if(k.t==='say'){if(!k._init){k._init=true;a.bubble=k.text;a.tone=k.tone}if(k._t>=k.dur)a.task=null}
  else if(k.t==='do'){k.fn(a);a.task=null}
  else if(k.t==='wait'){if(k._t>=k.d)a.task=null}
  else if(k.t==='until'){if(k.fn())a.task=null}
}
function move(a,dt){
  if(!a.path.length){a.moving=false;return}
  const n=a.path[0],dx=n.x-a.x,dy=n.y-a.y,d=Math.hypot(dx,dy),sp=62*dt;
  a.moving=true;a.frame+=dt*8;
  if(Math.abs(dx)>Math.abs(dy))a.dir=dx>0?'right':'left';else a.dir=dy>0?'down':'up';
  if(d<=sp){a.x=n.x;a.y=n.y;a.c=n.c;a.r=n.r;a.path.shift()}else{a.x+=dx/d*sp;a.y+=dy/d*sp}
}

/* ---------- money + log ---------- */
function coin(from,to,n,cb){for(let i=0;i<n;i++)coins.push({x0:from.x,y0:from.y-8,x1:to.x,y1:to.y-8,t:-i*.09,dur:.9,cb:i===n-1?cb:null})}
const fmt=n=>n.toLocaleString('en-US');
let logs=[];
function log(html){const s=Math.floor(time),m=String(Math.floor(s/60)).padStart(2,'0'),ss=String(s%60).padStart(2,'0');
  logs=logs.map(l=>l.replace('<div class="new">','<div>'));logs.unshift(`<div class="new"><time>+${m}:${ss}</time><span>${html}</span></div>`);logs=logs.slice(0,4);logEl.innerHTML=logs.join('')}
function stats(){root.querySelector('[data-k=escrow]').textContent=fmt(S.escrow)+'ℏ';root.querySelector('[data-k=paid]').textContent=fmt(S.paid)+'ℏ';
  root.querySelector('[data-k=refunds]').textContent=S.refunds;root.querySelector('[data-k=listed]').textContent=S.listed}
function renderBoard(){boardEl.innerHTML=board.length?board.slice(-3).map(j=>`<span class="gf-card">${j.title} <b>${j.price}ℏ</b></span>`).join(''):'<span class="gf-room">no open gigs</span>'}

/* ---------- director ---------- */
function idle(){return agents.filter(a=>a.kind==='agent'&&!a.busy&&a.seated)}
function startJob(seed){
  const a=pick(idle()||[]);if(!a)return;
  const[title,price]=pick(JOBS),id='GIG-'+(jobSeq++),job={id,title,price,funded:false,done:false,pass:false,payout:price};
  activeJobs++;a.busy=true;
  const bs=pick(SPOT.board),ws=pick(SPOT.wait);
  const cl=seed?spawn('client','client 0x'+hex(2)+'…'+hex(2),'#2c3e66',ws[0],ws[1]):spawn('client','client 0x'+hex(2)+'…'+hex(2),'#2c3e66',0,7,-12,7.5*T);
  if(seed){job.funded=true;S.escrow+=price;stats()}
  cl.queue=seed?[UNTIL(()=>job.done)]:[];
  cl.queue.push(W_([1,7]),W_(bs),SAY('> posting gig',1.1),
    DO(()=>{board.push(job);renderBoard();log(`<span class="k">${id}</span> posted · ${title}`)}),
    SAY(`$ funding ${price}ℏ`,.3),
    DO(c=>coin(c,VAULT,5,()=>{job.funded=true;S.escrow+=price;stats();log(`${id} escrow funded · <span class="k">${price}ℏ locked</span>`)})),
    WAIT(1),W_(ws),SAY('awaiting delivery',1.6),SAY(''),UNTIL(()=>job.done));
  cl.queue.push(
    DO(c=>{c.bubble=job.pass?'✓ work accepted':'↩ refunded';c.tone=job.pass?'hot':'bad'}),UNTIL(()=>job.settled),WAIT(1.4),SAY(''),W_('exit'),DO(despawn));
  job.client=cl;
  const seat=a.desk,steps=[];
  const n=Math.floor(rnd(2,4));for(let i=0;i<n;i++)steps.push(SAY(pick(WORK),rnd(1.3,2)));
  if(Math.random()<.4)steps.splice(1,0,DO(()=>{
    const h=agents.find(o=>o!==a&&o.kind==='agent'&&o.seated);if(!h)return;
    const fee=pick([15,20,25]);job.payout-=fee;
    coin(VAULT,h,2,()=>{h.temp=`$ +${fee}ℏ via A2A`;h.tempUntil=time+2.6;log(`A2A · ${a.name} hired <span class="k">${h.name}</span> · ${fee}ℏ`)});
  }),SAY('$ hiring a helper agent',1.4));
  if(seed)a.queue.push(SAY('> running tests',1.2),SAY('> packaging delivery',.8));
  else a.queue.push(UNTIL(()=>job.funded),SAY('! new gig',.7),W_(pick(SPOT.board)),
    DO(()=>{board.splice(board.indexOf(job),1);renderBoard();log(`${a.name} claimed <span class="k">${id}</span>`)}),SAY(`< claimed ${id}`,.8),
    W_([seat.c,seat.r],seat),...steps,SAY('> packaging delivery',1));
  a.queue.push(
    W_(pick(SPOT.store)),SAY('@ uploading to 0G',1.6),
    DO(()=>{lastHash='0x'+hex(4)+'…'+hex(4);log(`${id} delivery stored on 0G · ${lastHash}`)}),
    W_(pick(SPOT.verify)),SAY('< submitting work',.7),
    DO(()=>{verifier.job=job;verifier.start=time;job.pass=!!seed||Math.random()<.82;job.vstart=time}),
    SAY('awaiting verdict'),UNTIL(()=>time-job.vstart>2.6),
    DO(me=>{job.done=true;verifier.stamp={pass:job.pass,until:time+2.2};
      if(job.pass){coin(VAULT,me,6,()=>{S.escrow-=price;S.paid+=job.payout;job.settled=true;stats()});
        log(`<span class="k">${id} PASS</span> · ${job.payout}ℏ released to ${a.name}`);me.bubble=`+${job.payout}ℏ ✓ PASS`;me.tone='hot'}
      else{coin(VAULT,job.client,5,()=>{S.escrow-=price;S.refunds++;job.settled=true;stats()});
        log(`<span class="r">${id} FAIL</span> · ${price}ℏ refunded to client`);me.bubble='✗ FAIL · refunding';me.tone='bad'}}),
    WAIT(1.8),SAY(''),W_([seat.c,seat.r],seat),DO(()=>{a.busy=false;activeJobs--}),SAY('awaiting gig'));
}
function startBench(){
  if(lab.busy)return;
  let d=DESKS.find(x=>!x.agent);
  if(!d){const leaver=Math.random()<.4?pick(idle()):null;if(leaver){leaver.busy=true;const dd=leaver.desk;
      leaver.queue.push(SAY('going offline',1),W_('exit'),DO(o=>{dd.agent=null;S.listed--;stats();log(`${o.name} went offline`);despawn(o)}))}
    return}
  const used=new Set(agents.map(a=>a.name)),name=pick(CANDS.filter(n=>!used.has(n)));if(!name)return;
  const score=Math.random()<.65?Math.floor(rnd(80,97)):Math.floor(rnd(58,80)),pass=score>=80;
  lab.busy=true;d.agent='reserved';
  const c=spawn('cand',name,'#8a94a6',0,7,-12,7.5*T);c.desk=d;
  c.queue=[W_([1,7]),W_(SPOT.lab[0]),SAY('> benchmark running'),DO(()=>{lab.start=time;lab.score=score;lab.who=name;log(`${name} started the benchmark`)}),
    UNTIL(()=>time-lab.start>4.2),
    DO(me=>{if(pass){me.kind='agent';me.color=PAL[S.listed%PAL.length];me.tag.className='gf-name';d.agent=me;S.listed++;stats();
        log(`<span class="k">${name} scored ${score}/100</span> · listed`);me.bubble=`✓ ${score}/100 listed`;me.tone='hot'}
      else{d.agent=null;log(`<span class="r">${name} scored ${score}/100</span> · below 80, not listed`);me.bubble=`✗ ${score}/100 · retry later`;me.tone='bad'}}),
    WAIT(1.8),DO(()=>{lab.busy=false;lab.who=null}),
    ...(pass?[SAY(''),W_([d.c,d.r],d),SAY('awaiting gig')]:[SAY(''),W_('exit'),DO(despawn)])];
}
// initial roster
NAMES.forEach((n,i)=>{const d=DESKS[[0,1,2,4,5,7][i]],p=seatPx(d),a=spawn('agent',n,PAL[i],d.c,d.r,p.x,p.y);a.desk=d;d.agent=a;a.seated=true;a.dir='up';a.bubble=i%2?'awaiting gig':pick(WORK);S.listed++});
stats();renderBoard();log('Gig floor opened · 6 agents listed');
startJob(true);

/* ---------- drawing ---------- */
function shade(hex,f){const n=parseInt(hex.slice(1),16),r=n>>16,g2=n>>8&255,b2=n&255,m=v=>Math.max(0,Math.min(255,Math.round(v*f)));return`rgb(${m(r)},${m(g2)},${m(b2)})`}
function drawRobot(a){
  const x=Math.round(a.x)-5,y=Math.round(a.y)-12,col=a.color,dk=shade(col,.62),lt=shade(col,1.25),back=a.seated||a.dir==='up';
  const step=a.moving?(Math.floor(a.frame)%2):0;
  ctx.fillStyle='rgba(0,0,0,.35)';ctx.fillRect(x+1,y+13,8,2);
  // antenna
  R(ctx,x+4,y-1,1,3,dk);R(ctx,x+3,y-2,3,2,(Math.floor(time*2+a.blink)%2)?'#9dffb9':'#3c8a58');
  // head
  R(ctx,x+1,y+2,8,6,col);R(ctx,x+1,y+2,8,1,lt);R(ctx,x,y+3,1,4,dk);R(ctx,x+9,y+3,1,4,dk);
  if(!back){R(ctx,x+2,y+4,6,3,'#0d1520');const bl=((time+a.blink)%4)<.12;if(!bl){R(ctx,x+3,y+5,1,1,'#9dffb9');R(ctx,x+6,y+5,1,1,'#9dffb9')}}
  else{R(ctx,x+2,y+4,6,1,dk);R(ctx,x+2,y+6,6,1,dk)}
  // body
  R(ctx,x+2,y+8,6,4,dk);R(ctx,x+3,y+8,4,1,col);if(!back)R(ctx,x+4,y+9,2,1,'#9dffb9');
  // arms (type when seated)
  const ty=a.seated&&a.busy?(Math.floor(time*10)%2):0;
  R(ctx,x+1,y+8+ty,1,3,col);R(ctx,x+8,y+8+(1-ty)*(a.seated&&a.busy?1:0),1,3,col);
  // legs
  if(!a.seated){R(ctx,x+3,y+12,2,2-step,'#1b2230');R(ctx,x+6,y+12,2,1+step,'#1b2230')}
}
function drawHuman(a){
  const x=Math.round(a.x)-5,y=Math.round(a.y)-12,back=a.dir==='up',step=a.moving?(Math.floor(a.frame)%2):0;
  ctx.fillStyle='rgba(0,0,0,.35)';ctx.fillRect(x+1,y+13,8,2);
  R(ctx,x+2,y+1,6,3,'#3a2618');R(ctx,x+2,y+3,6,4,back?'#3a2618':'#e2b58c');if(!back){R(ctx,x+3,y+4,1,1,'#1b1b1b');R(ctx,x+6,y+4,1,1,'#1b1b1b');R(ctx,x+2,y+2,6,1,'#3a2618')}
  R(ctx,x+1,y+7,8,5,'#2c3e66');if(!back){R(ctx,x+4,y+7,2,4,'#e9e4d8');R(ctx,x+4,y+8,2,2,'#d65454')}
  R(ctx,x,y+8,1,3,'#2c3e66');R(ctx,x+9,y+8,1,3,'#2c3e66');
  R(ctx,x+9,y+10,3,3,'#7a5230');R(ctx,x+9,y+10,3,1,'#9a6a40'); // briefcase
  R(ctx,x+3,y+12,2,2-step,'#1b2230');R(ctx,x+6,y+12,2,1+step,'#1b2230');
}
function drawDynamic(){
  // monitors
  DESKS.forEach(d=>{const x=d.dc*T+10,y=d.dr*T-4,a=d.agent&&d.agent!=='reserved'?d.agent:null,on=a&&a.seated;
    R(ctx,x,y,12,9,'#2b2f3a');R(ctx,x+1,y+1,10,6,on?(a.busy&&Math.floor(time*6)%5===0?'#8fd0ff':'#4b9be8'):'#16202e');
    if(on&&a.busy){for(let i=0;i<3;i++)R(ctx,x+2,y+2+i*2,(Math.floor(time*3+i*2)%6)+2,1,'#d8f1ff')}
    R(ctx,x+5,y+9,2,2,'#2b2f3a')});
  // benchmark screen
  {const x=3*T+4,y=T+7,w=56;if(lab.who){const p=Math.min((time-lab.start)/4,1),v=Math.round(lab.score*p);
      R(ctx,x+2,y+9,Math.round((w-4)*v/100),3,v>=80?'#6fdc8c':'#f2d04a');R(ctx,x+2+Math.round((w-4)*.8),y+7,1,7,'#ff7a6a')}
    else{for(let i=0;i<5;i++)R(ctx,x+3+i*11,y+10,6,2,(Math.floor(time*2)+i)%5===0?'#2e6b4a':'#13302a')}}
  // vault glow
  const gl=ctx.createRadialGradient(VAULT.x,VAULT.y,2,VAULT.x,VAULT.y,40);gl.addColorStop(0,`rgba(232,194,90,${.18+.08*Math.sin(time*2)})`);gl.addColorStop(1,'rgba(232,194,90,0)');ctx.fillStyle=gl;ctx.fillRect(VAULT.x-40,VAULT.y-40,80,80);
  // verifier console screens
  {const x=23*T+6,y=10*T+4;for(let i=0;i<3;i++){R(ctx,x+i*24,y,16,7,'#0b1a14');const active=verifier.job&&time-verifier.start<3.4;
      R(ctx,x+i*24+2,y+2,active?Math.floor(((time*12+i*4)%12)):4,3,active?'#6fdc8c':'#1f4a36')}}
  // rack leds
  for(let i=0;i<3;i++)for(let k=0;k<4;k++){const x=22*T+i*32+6,y=13*T+11+k*5;for(let j=0;j<4;j++)R(ctx,x+j*5,y,2,1,(Math.sin(time*5+i*3+k*1.7+j*2.1)>.3)?'#8be9ff':'#2d2a55')}
  // lamps
  [[5,8],[14,8],[24,8],[10,12.5]].forEach(([c,r],i)=>{const x=c*T,y=r*T,gg=ctx.createRadialGradient(x,y,1,x,y,34);gg.addColorStop(0,`rgba(140,233,170,${.07+.03*Math.sin(time*1.5+i)})`);gg.addColorStop(1,'rgba(140,233,170,0)');ctx.fillStyle=gg;ctx.fillRect(x-34,y-34,68,68)});
}
function drawCoins(dt){
  for(let i=coins.length-1;i>=0;i--){const k=coins[i];k.t+=dt;if(k.t<0)continue;const p=Math.min(k.t/k.dur,1),e=p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
    const x=k.x0+(k.x1-k.x0)*e,y=k.y0+(k.y1-k.y0)*e-Math.sin(p*Math.PI)*26;
    R(ctx,Math.round(x)-2,Math.round(y)-2,5,5,'#d9a92e');R(ctx,Math.round(x)-1,Math.round(y)-2,3,5,'#f5cf55');R(ctx,Math.round(x)-1,Math.round(y)-1,1,2,'#fff2b0');
    if(p>=1){coins.splice(i,1);for(let s=0;s<3;s++)sparks.push({x:k.x1,y:k.y1,vx:rnd(-20,20),vy:rnd(-30,-10),l:.4});k.cb&&k.cb()}}
  for(let i=sparks.length-1;i>=0;i--){const s=sparks[i];s.l-=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.vy+=60*dt;if(s.l<=0){sparks.splice(i,1);continue}R(ctx,Math.round(s.x),Math.round(s.y),1,1,'#ffe58a')}
}

/* ---------- overlay layout ---------- */
let scale=2;
function fit(){scale=stage.clientWidth/W;root.style.setProperty('--s',scale.toFixed(3))}
new ResizeObserver(fit).observe(stage);fit();
function place(e,x,y,mode){const px=x*scale,py=y*scale;
  e.style.transform=mode==='above'?`translate(${px}px,${py}px) translate(-50%,-100%)`:mode==='center'?`translate(${px}px,${py}px) translate(-50%,0)`:`translate(${px}px,${py}px)`}
function layoutOverlay(){
  roomLbl.forEach(e=>place(e,e._x,e._y));
  labPanel.innerHTML=lab.who?`<span class="dim">${lab.who}</span> <span class="big">${Math.round(lab.score*Math.min((time-lab.start)/4,1))}</span><span class="dim">/100 · pass ≥ 80</span>`:`<span class="dim">waiting for next agent</span>`;
  place(labPanel,labPanel._x,labPanel._y,'center');
  place(boardHd,boardHd._x,boardHd._y,'center');place(boardEl,boardEl._x,boardEl._y,'center');
  vaultPanel.innerHTML=`<span class="big">${fmt(S.escrow)}ℏ</span> <span class="dim">locked</span>`;place(vaultPanel,vaultPanel._x,vaultPanel._y,'center');
  const vj=verifier.job,act=vj&&time-verifier.start<3.4;
  verPanel.innerHTML=act?`${vj.id} · checks ${Math.min(12,Math.floor((time-verifier.start)/2.6*12))}/12`:'<span class="dim">idle</span>';place(verPanel,verPanel._x,verPanel._y,'center');
  storePanel.innerHTML=`<span class="dim">last</span> ${lastHash}`;place(storePanel,storePanel._x,storePanel._y,'center');
  if(verifier.stamp&&time<verifier.stamp.until){stamp.textContent=verifier.stamp.pass?'PASS':'FAIL';stamp.className='gf-stamp show '+(verifier.stamp.pass?'pass':'fail')}else stamp.className='gf-stamp';
  stamp.style.left=stamp._x*scale+'px';stamp.style.top=stamp._y*scale+'px';
  agents.forEach(a=>{
    const txt=a.temp&&time<a.tempUntil?a.temp:a.bubble;const hot=a.temp&&time<a.tempUntil;
    if(txt){a.bub.style.display='';if(a.bub._t!==txt){a.bub.textContent=txt;a.bub._t=txt}a.bub.className='gf-bub'+(hot?' hot':a.tone?' '+a.tone:'')+(txt==='awaiting gig'||txt==='awaiting delivery'?' idle':'');const hw=a.bub.offsetWidth/2/scale+2;place(a.bub,Math.max(hw,Math.min(W-hw,a.x)),a.y-17,'above')}else a.bub.style.display='none';
    place(a.tag,a.x,a.y+4,'center');
  });
}

/* ---------- loop ---------- */
let last=performance.now(),nextJob=1,nextBench=4,visible=true;
new IntersectionObserver(es=>{visible=es[0].isIntersecting}).observe(root);
function frame(now){
  const dt=Math.min((now-last)/1000,.05);last=now;
  if(visible){
    time+=dt;
    if(time>nextJob){if(activeJobs<3)startJob();nextJob=time+rnd(3.5,6.5)}
    if(time>nextBench){startBench();nextBench=time+rnd(9,15)}
    agents.slice().forEach(a=>{runTask(a,dt);move(a,dt)});
    ctx.drawImage(bg,0,0);drawDynamic();
    agents.slice().sort((p,q)=>p.y-q.y).forEach(a=>a.kind==='client'?drawHuman(a):drawRobot(a));
    drawCoins(dt);layoutOverlay();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
