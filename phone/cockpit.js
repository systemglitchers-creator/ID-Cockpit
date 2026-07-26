/* ID Cockpit — app logic. Shared by the installed PWA and the Mac server;
   the only difference between them is the storage backend (see Backend). */
const START_DATE=new Date(2026,5,22), DAY=864e5;
const WD=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FLEX_START=new Date(2026,6,18);
function isFlexDay(d){ return d.getDay()===6 && d>=FLEX_START; }
function dayDate(gi){ var d=new Date(START_DATE), n=gi||0;
  while(n>0){ d.setDate(d.getDate()+1); if(!isFlexDay(d)) n--; }
  return d; }
function studyIdx(when){ var t=new Date(when); t.setHours(0,0,0,0);
  var d=new Date(START_DATE), i=0;
  while(d<t){ d.setDate(d.getDate()+1); if(!isFlexDay(d)) i++; }
  return i; }
function fmtD(d){ return WD[d.getDay()]+" "+MO[d.getMonth()]+" "+d.getDate(); }
// var, not let: these are the app's observable state and the node tests reach
// them through the script's global object, which let-bindings never reach.
var STATUS={done:{},chapters:{}};
var META=null, activeSi=0;

/* ---- storage ---------------------------------------------------------------
   Progress lives on the device (IDStore) and reaches the other device through
   the gist (IDSync). There is no server: the app is static files. */
var Backend = {
  load: function(){ return Promise.resolve({done: IDStore.getState().sessions}); },
  setDone: function(id,done){
    var entry=IDStore.setEntry(id,done);
    IDSync.schedulePush();
    return Promise.resolve(entry);
  },
  setDoneMany: function(ids,done){
    ids.forEach(function(id){ IDStore.setEntry(id,done); });
    IDSync.schedulePush();   // one push for the whole chapter, not one per part
    return Promise.resolve(true);
  }
};
function chapNum(t){var m=/^\s*(?:Chapter\s+)?(\d+)/.exec(t||"");return m?m[1]:"";}
function cleanTitle(t){return String(t||"").replace(/\s+·.*$/,"").replace(/^\s*(?:Chapter\s+)?\d+\s*[—–-]\s*/,"").trim();}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function isDone(id){var e=STATUS.done[id];return !!(e&&e.done);}

// Dates re-flow: remaining sessions are dealt onto consecutive study days starting
// today, in curriculum order. Reading a chapter early (out of order) therefore pulls
// everything after it forward. Completed sessions keep the date they were read.
var EFF={};            // session id -> effective day index (incomplete sessions only)
function sameDay(iso,ref){
  if(!iso) return false;
  var d=new Date(iso);
  return d.getFullYear()===ref.getFullYear()&&d.getMonth()===ref.getMonth()&&d.getDate()===ref.getDate();
}
function doneDate(id){var e=STATUS.done[id];return e&&e.doneAt?new Date(e.doneAt):null;}
// One rendering of a session's date — shared by the sector panel and search results.
function dateHTML(r){
  if(isDone(r.id)){ var d=doneDate(r.id); return '<span class="dt read">✓ '+(d?fmtD(d):"read")+'</span>'; }
  var idx=EFF[r.id];
  if(idx==null) return '<span class="dt"></span>';
  var today=!META.flexToday&&idx===META.todayIdx;
  return '<span class="dt'+(today?' today':'')+'">'+(today?"Today · ":"")+fmtD(dayDate(idx))+'</span>';
}

function compute(){
  var gTot=0,gDone=0,pTot=0,pDone=0,completed=0,nextQuest=null;
  var now=new Date(), todayIdx=studyIdx(Date.now()), flexToday=isFlexDay(now);
  // If anything was read today, today's slot is spent, so the queue resumes tomorrow.
  // The shift is capped at one day: reading several chapters in one day must actually
  // buy time back, not just push the whole tail along with it.
  var readToday=false, planEndIdx=0;
  SECTIONS.forEach(function(s){s.rows.forEach(function(r){
    if(r.gi!=null&&r.gi>planEndIdx) planEndIdx=r.gi;
    if(isDone(r.id)&&sameDay((STATUS.done[r.id]||{}).doneAt,now)) readToday=true;
  });});
  EFF={};
  var k=todayIdx+(readToday?1:0), remaining=0;
  var secs=SECTIONS.map(function(s,si){
    var tot=s.rows.length,dn=0,ppd=0,pp=0;
    s.rows.forEach(function(r){
      var w=r.pp||0; pp+=w; gTot++; pTot+=w;
      if(isDone(r.id)){dn++;gDone++;ppd+=w;pDone+=w;}
      else{ if(!nextQuest) nextQuest={si:si,r:r}; EFF[r.id]=k++; remaining++; }
    });
    var complete=tot>0&&dn===tot; if(complete) completed++;
    return {si:si,s:s,tot:tot,dn:dn,pp:pp,ppd:ppd,complete:complete,frac:tot?dn/tot:0};
  });
  activeSi = nextQuest?nextQuest.si:secs.length-1;
  secs.forEach(function(x){
    if(x.complete) x.state="complete";
    else if(x.si===activeSi) x.state="active";
    else if(x.dn>0) x.state="started";
    else if(x.si<activeSi) x.state="available";
    else x.state="locked";
  });
  // drift: projected finish vs the plan's original end date, in whole days
  var drift=0;
  if(remaining>0){
    var proj=dayDate(k-1), planEnd=dayDate(planEndIdx);
    drift=Math.round((proj-planEnd)/DAY);
  }
  return {secs:secs,gTot:gTot,gDone:gDone,pTot:pTot,pDone:pDone,completed:completed,
          nextQuest:nextQuest,todayIdx:todayIdx,flexToday:flexToday,remaining:remaining,drift:drift};
}

var W=720, CX=360, AMP=176, TOP=70, GAP=124, ORB=92, HALF=75;
function nodeX(i){return CX + AMP*Math.sin(i*0.66);}
function nodeY(i){return TOP + i*GAP;}

function ringDash(frac){var C=2*Math.PI*43; return {C:C.toFixed(1), off:(C*(1-frac)).toFixed(1)};}

function render(){
  META=compute();
  var m=META, secs=m.secs;
  // HUD
  document.getElementById("lvlBadge").textContent="LVL "+(m.completed+1);
  var ranks=["Initiate","Apprentice","Journeyman","Adept","Clinician","Fellow","Specialist","Consultant","Master","Diplomate"];
  document.getElementById("rankName").textContent=ranks[Math.min(m.completed,ranks.length-1)];
  document.getElementById("rankSub").textContent=m.completed+" / "+secs.length+" sectors cleared";
  document.getElementById("xpNow").textContent=m.pDone;
  document.getElementById("xpFill").style.width=(m.pTot?m.pDone/m.pTot*100:0)+"%";
  document.getElementById("sPct").textContent=Math.round(m.gTot?m.gDone/m.gTot*100:0)+"%";
  document.getElementById("sSess").textContent=m.gDone+" / "+m.gTot;
  var dEl=document.getElementById("sOver");
  dEl.textContent = m.remaining===0 ? "done" : (m.drift>0?"+"+m.drift+"d":(m.drift<0?"−"+Math.abs(m.drift)+"d":"on plan"));
  dEl.className = "v" + (m.drift>0?" warn":"");
  dEl.style.color = m.drift<0 ? "var(--cyan)" : "";
  dEl.style.fontSize = Math.abs(m.drift)>0 ? "" : "15px";
  // quest
  var q=document.getElementById("quest");
  if(m.nextQuest){
    var r=m.nextQuest.r, sec=SECTIONS[m.nextQuest.si];
    q.innerHTML='<div><div class="qk">▸ Next quest</div>'
      +'<div class="qt">'+esc(cleanTitle(r.r)||r.r)+'</div>'
      +'<div class="qm">'+(r.ps?'pp. '+r.ps+(r.pe&&r.pe!==r.ps?'–'+r.pe:''):'')+' · sector <b>'+esc(sec.title)+'</b></div></div>'
      +'<div class="qacts"><button class="qbtn go" id="qOpen">Open sector →</button></div>';
    document.getElementById("qOpen").onclick=function(){openPanel(m.nextQuest.si);};
  } else { q.innerHTML='<div><div class="qk">✦ Curriculum complete</div><div class="qt">Every sector cleared — onward to the exam.</div></div>'; }
  // tree
  var tree=document.getElementById("tree");
  var height=TOP + (secs.length-1)*GAP + ORB + 120;
  tree.style.height=height+"px";
  var edges="";
  for(var i=0;i<secs.length-1;i++){
    var x1=nodeX(i),y1=nodeY(i)+ORB/2, x2=nodeX(i+1),y2=nodeY(i+1)+ORB/2;
    var mx=(x1+x2)/2, my=(y1+y2)/2, cx1=x1, cy1=my, cx2=x2, cy2=my;
    var lit = secs[i].state==="complete";
    var reach = secs[i].state==="complete"||secs[i].state==="active"||secs[i].state==="started";
    var col = lit?"var(--gold)":(reach?"var(--cyan)":"var(--line)");
    var op = reach?"1":".6";
    var glow = lit||secs[i].state==="active";
    edges+='<path d="M'+x1+' '+y1+' C '+cx1+' '+cy1+' '+cx2+' '+cy2+' '+x2+' '+y2+'" fill="none" stroke="'+col+'" stroke-width="'+(reach?3:2)+'" opacity="'+op+'"'+(glow?' style="filter:drop-shadow(0 0 6px '+col+')"':'')+'/>';
  }
  var nodes="";
  secs.forEach(function(x,i){
    var d=ringDash(x.frac);
    var glyph = x.state==="complete"?'<span class="glyph">✓</span>':(x.state==="locked"?'<span class="glyph">◈</span>':'');
    nodes+='<button class="node '+x.state+'" data-si="'+i+'" style="left:'+(nodeX(i)-HALF)+'px;top:'+nodeY(i)+'px">'
      +'<div class="orb"><svg class="ring" viewBox="0 0 92 92"><circle class="rbg" cx="46" cy="46" r="43"/><circle class="rfg" cx="46" cy="46" r="43" stroke-dasharray="'+d.C+'" stroke-dashoffset="'+d.off+'"/></svg>'
      +'<span class="ix">'+String(i+1).padStart(2,"0")+'</span>'+glyph+'</div>'
      +'<div class="ntitle">'+esc(x.s.title.replace(/\s*—.*$/,""))+'</div>'
      +'<div class="nmeta">'+x.dn+' / '+x.tot+'</div></button>';
  });
  // act dividers + terminals
  var y1start=secs.findIndex(function(x){return x.s.year===1;});
  var y2start=secs.findIndex(function(x){return x.s.year===2;});
  var acts="";
  acts+='<div class="term" style="top:18px;font-size:12px;color:var(--vio2)">▸ The journey begins</div>';
  if(y2start>0){ acts+='<div class="act" style="top:'+(nodeY(y2start)-GAP/2-6)+'px"><b>Act II</b> · Consolidation &amp; Exam Prep</div>'; }
  acts+='<div class="term" style="top:'+(height-70)+'px;font-size:15px;color:var(--gold);text-shadow:0 0 20px rgba(255,206,92,.4)">◆ The Royal College Examination</div>';
  tree.innerHTML='<svg class="edges" viewBox="0 0 '+W+' '+height+'" preserveAspectRatio="none">'+edges+'</svg>'+acts+nodes;
  Array.prototype.forEach.call(tree.querySelectorAll(".node"),function(n){n.onclick=function(){openPanel(+n.dataset.si);};});
}

var openSi=null;
// Freeze the page behind overlays. iOS ignores overflow:hidden on body, so we
// pin it with position:fixed and restore the scroll offset on close.
var _lockY=0,_locked=false;
function lockScroll(on){
  if(on){
    if(_locked) return;
    _lockY=window.scrollY||window.pageYOffset||0;
    document.body.style.top=(-_lockY)+"px";
    document.body.classList.add("locked");
    _locked=true;
  }else{
    if(!_locked) return;
    document.body.classList.remove("locked");
    document.body.style.top="";
    window.scrollTo(0,_lockY);
    _locked=false;
  }
}
function openPanel(si){
  openSi=si;
  var x=META.secs[si], s=x.s;
  document.getElementById("pk").textContent="Sector "+String(si+1).padStart(2,"0")+" · "+(s.year===1?"Act I":"Act II");
  document.getElementById("pt").textContent=s.title;
  document.getElementById("psub").textContent=x.dn+" / "+x.tot+" sessions · "+x.ppd+" / "+x.pp+" pp · "+Math.round(x.frac*100)+"%";
  document.getElementById("pbar").style.width=(x.frac*100)+"%";
  var body=document.getElementById("pbody"), html="", lastWk=null;
  s.rows.forEach(function(r){
    var dn=isDone(r.id);
    if(r.wk!==lastWk){ html+='<div class="pwk">Week '+r.wk+'</div>'; lastWk=r.wk; }
    html+='<div class="q'+(dn?' done':'')+'" data-id="'+r.id+'">'
      +'<div class="chk" data-toggle="'+r.id+'"></div>'
      +'<div class="qmid"><div class="qttl">'+esc(r.r)+'</div>'
      +'<div class="qsub">'+dateHTML(r)+(r.ps?'<span class="pg">pp. '+r.ps+(r.pe&&r.pe!==r.ps?'–'+r.pe:'')+'</span>':'')+'</div>'
      +'</div></div>';
  });
  body.innerHTML=html;
  Array.prototype.forEach.call(body.querySelectorAll(".chk"),function(el){el.onclick=function(){toggle(el.dataset.toggle);};});
  document.getElementById("panel").classList.add("open");
  document.getElementById("scrim").classList.add("on");
  lockScroll(true);
}
function closePanel(){document.getElementById("panel").classList.remove("open");document.getElementById("scrim").classList.remove("on");lockScroll(false);openSi=null;}

function rowById(id){for(var i=0;i<SECTIONS.length;i++){var r=SECTIONS[i].rows.find(function(x){return x.id===id;});if(r)return r;}return null;}

// Optimistic local echo, so the tree redraws before the write lands.
function echo(ids,done){
  var iso=new Date().toISOString();
  ids.forEach(function(id){
    STATUS.done[id]={done:done,doneAt:done?iso:null,updatedAt:iso};
  });
}
function repaint(){
  render();
  if(openSi!==null) openPanel(openSi);
  if(searchOpen) renderSearch();
}

// Mark a whole chapter at once: one re-render and one sync push, not N of each.
function markMany(ids,done){
  if(!ids.length) return;
  echo(ids,done);
  repaint();
  Backend.setDoneMany(ids,done).catch(function(){toastMsg("Not saved — will retry on reload");});
}

function toggle(id){
  var now=!isDone(id);
  echo([id],now);
  repaint();
  Backend.setDone(id,now).catch(function(){toastMsg("Not saved — will retry on reload");});
}


var toastT=null;
function toastMsg(t){var el=document.getElementById("toast");el.textContent=t;el.classList.add("show");clearTimeout(toastT);toastT=setTimeout(function(){el.classList.remove("show");},2600);}

function warpToActive(){
  var n=document.querySelector('.node.active')||document.querySelector('.node');
  if(n) n.scrollIntoView({behavior:"smooth",block:"center"});
}

document.getElementById("pclose").onclick=closePanel;
document.getElementById("scrim").onclick=closePanel;
document.getElementById("jump").onclick=warpToActive;
document.addEventListener("keydown",function(e){if(e.key==="Escape"){ if(searchOpen) closeSearch(); else closePanel(); }});

// Called after a sync pull brings in changes made on the other device.
function refreshFromStore(){
  Backend.load().then(function(s){ STATUS=s; repaint(); }).catch(function(){});
}
function applyTreeZoom(){
  var t=document.getElementById("tree"); if(!t) return;
  var vw=document.documentElement.clientWidth;
  if(vw<=640){ t.style.zoom=Math.max(0.4, Math.min(1,(vw-16)/720)); }
  else { t.style.zoom=""; }
}
window.addEventListener("resize", applyTreeZoom);
/* ---- find a chapter -------------------------------------------------------
   Ad-hoc reading: a ward case or talk sends Tyler into a chapter that may sit
   months away in the plan. Search finds it, and "mark all parts" credits the
   whole chapter in one tap — the schedule re-flows around it. */
var searchOpen=false, SEARCH_ROWS=null;
function searchRows(){
  if(SEARCH_ROWS) return SEARCH_ROWS;
  SEARCH_ROWS=[];
  SECTIONS.forEach(function(s,si){ s.rows.forEach(function(r){
    SEARCH_ROWS.push({r:r,si:si,sec:s.title,hay:((r.r||"")+" "+(s.title||"")+" "+(r.g||"")).toLowerCase()});
  });});
  return SEARCH_ROWS;
}
function chapKey(r){var m=/^(ch\d+)/.exec(r.id||"");return m?m[1]:(r.id||"");}
function chapLabel(r){return String(r.r||"").replace(/\s*·\s*Part\s+\d+\s+of\s+\d+\s*$/i,"").trim();}
function partLabel(r){var m=/·\s*(Part\s+\d+\s+of\s+\d+)\s*$/i.exec(r.r||"");return m?m[1]:cleanTitle(r.r)||r.id;}
function matchItem(it,q){
  if(/^\d+$/.test(q)) return new RegExp("^ch"+q+"(-|$)").test(it.r.id||"")||it.hay.indexOf("chapter "+q+" ")>=0;
  return q.split(/\s+/).filter(Boolean).every(function(t){return it.hay.indexOf(t)>=0;});
}
// The chapter actually named in the query beats chapters that merely share its
// sector — searching "endocarditis" should surface Chapter 82, not its neighbours.
function titleMatch(it,q){
  var t=(it.r.r||"").toLowerCase();
  if(/^\d+$/.test(q)) return new RegExp("^ch"+q+"(-|$)").test(it.r.id||"");
  return q.split(/\s+/).filter(Boolean).every(function(tok){return t.indexOf(tok)>=0;});
}
function renderSearch(){
  var q=(document.getElementById("findInput").value||"").trim().toLowerCase();
  var body=document.getElementById("findBody");
  if(!q){ body.innerHTML='<div class="find-hint">Search by topic or chapter number.<br>e.g. <b>salmonella</b> · <b>endocarditis</b> · <b>44</b><br><br>Marking a chapter read credits it wherever<br>it sits in the plan — the rest re-flows.</div>'; return; }
  var hits=searchRows().filter(function(it){return matchItem(it,q);});
  if(!hits.length){ body.innerHTML='<div class="find-hint">No match for “'+esc(q)+'”.</div>'; return; }
  var order=[],groups={};
  hits.forEach(function(it){
    var k=chapKey(it.r);
    if(!groups[k]){groups[k]={items:[],sec:it.sec,direct:false};order.push(k);}
    groups[k].items.push(it);
    if(titleMatch(it,q)) groups[k].direct=true;
  });
  order.sort(function(a,b){return (groups[b].direct?1:0)-(groups[a].direct?1:0);});
  var html="";
  order.slice(0,40).forEach(function(k){
    var g=groups[k], rows=g.items, first=rows[0].r;
    var allDone=rows.every(function(it){return isDone(it.r.id);});
    var ids=rows.map(function(it){return it.r.id;}).join(",");
    var ps=Math.min.apply(null,rows.map(function(it){return it.r.ps||1e9;}));
    var pe=Math.max.apply(null,rows.map(function(it){return it.r.pe||it.r.ps||0;}));
    html+='<div class="sgrp"><div class="sgt">'+esc(chapLabel(first))+'</div>'
      +'<div class="sgm">'+esc(g.sec.replace(/\s*—.*$/,""))+(ps<1e9?' · pp. '+ps+(pe&&pe!==ps?'–'+pe:''):'')+' · '+rows.length+' part'+(rows.length>1?'s':'')+'</div>'
      +'<button class="sgall'+(allDone?' undo':'')+'" data-ids="'+ids+'" data-done="'+(allDone?"0":"1")+'">'
      +(allDone?'Unmark all '+rows.length:'Mark all '+rows.length+' read')+'</button>';
    rows.forEach(function(it){
      var r=it.r,dn=isDone(r.id);
      html+='<div class="srow'+(dn?' done':'')+'"><div class="chk" data-toggle="'+r.id+'"></div>'
        +'<div class="stxt"><div class="sp">'+esc(partLabel(r))+'</div>'
        +'<div class="ssub">'+dateHTML(r)+'</div></div></div>';
    });
    html+='</div>';
  });
  if(order.length>40) html+='<div class="find-hint">'+(order.length-40)+' more — refine your search.</div>';
  body.innerHTML=html;
}
function openSearch(){
  searchOpen=true;
  document.getElementById("findPane").classList.add("open");
  lockScroll(true);
  renderSearch();
  setTimeout(function(){document.getElementById("findInput").focus();},60);
}
function closeSearch(){
  searchOpen=false;
  document.getElementById("findPane").classList.remove("open");
  lockScroll(false);
}
(function setupSearch(){
  document.getElementById("findBtn").onclick=openSearch;
  document.getElementById("findClose").onclick=closeSearch;
  document.getElementById("findInput").addEventListener("input",renderSearch);
  document.getElementById("findBody").addEventListener("click",function(e){
    var all=e.target.closest(".sgall");
    if(all){ markMany(all.dataset.ids.split(","),all.dataset.done==="1"); return; }
    var chk=e.target.closest(".chk");
    if(chk){ markMany([chk.dataset.toggle],!isDone(chk.dataset.toggle)); }
  });
})();

(function setupSettings(){
  var scrim=document.getElementById("cfgScrim"), modal=document.getElementById("cfgModal");
  var status=document.getElementById("cfgStatus");
  function open(){
    var c=IDSync.cfg();
    document.getElementById("cfgToken").value=c.token||"";
    document.getElementById("cfgGist").value=c.gistId||"";
    status.textContent=IDSync.configured()?"Sync configured.":"Not configured — progress stays on this device.";
    scrim.classList.add("on"); modal.classList.add("open"); lockScroll(true);
  }
  function close(){ scrim.classList.remove("on"); modal.classList.remove("open"); lockScroll(false); }
  document.getElementById("cfgBtn").onclick=open;
  document.getElementById("cfgClose").onclick=close;
  scrim.onclick=close;
  document.getElementById("cfgSave").onclick=function(){
    IDSync.setCfg({token:document.getElementById("cfgToken").value.trim(), gistId:document.getElementById("cfgGist").value.trim()});
    status.textContent="Saved. Syncing…";
    IDSync.syncNow().then(function(ok){ status.textContent=ok?"Synced ✓":"Saved (sync unavailable)."; })
      .catch(function(){ status.textContent="Saved, but sync failed — check token/gist."; });
  };
  document.getElementById("cfgSync").onclick=function(){
    status.textContent="Syncing…";
    IDSync.syncNow().then(function(ok){ status.textContent=ok?"Synced ✓":"Nothing to sync."; })
      .catch(function(){ status.textContent="Sync failed — check token/gist."; });
  };
  document.getElementById("cfgExport").onclick=function(){
    var blob=new Blob([JSON.stringify(IDStore.getState(),null,2)],{type:"application/json"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download="id-cockpit-state.json"; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
  };
  document.getElementById("cfgImport").onclick=function(){ document.getElementById("cfgFile").click(); };
  document.getElementById("cfgFile").onchange=function(e){
    var f=e.target.files[0]; if(!f) return;
    var rd=new FileReader();
    rd.onload=function(){
      try{
        var data=JSON.parse(rd.result);
        if(!data||typeof data.sessions!=="object") throw new Error("bad");
        IDStore.mergeRemote(data.sessions);
        refreshFromStore(); IDSync.schedulePush();
        status.textContent="Imported ✓";
      }catch(err){ status.textContent="Import failed — not a valid state file."; }
    };
    rd.readAsText(f); e.target.value="";
  };
})();
function boot(){
  Backend.load().then(function(s){STATUS=s;}).catch(function(){STATUS={done:{}};})
    .then(function(){
      document.body.classList.remove("loading");
      render();
      applyTreeZoom();
      setTimeout(warpToActive,500);
      if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(function(){}); }
      IDSync.start(refreshFromStore);
    });
}
boot();
