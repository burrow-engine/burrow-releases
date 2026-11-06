(function(){
"use strict";
var d=document.documentElement,root=document.body.getAttribute("data-root")||"./";
var btn=document.getElementById("theme-toggle");
function current(){var t=d.getAttribute("data-theme");if(t)return t;return window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}
function label(){if(btn){var dark=current()==="dark";btn.setAttribute("aria-pressed",dark?"true":"false");btn.textContent=dark?btn.getAttribute("data-light"):btn.getAttribute("data-dark")}}
if(btn){label();btn.addEventListener("click",function(){var n=current()==="dark"?"light":"dark";d.setAttribute("data-theme",n);try{localStorage.setItem("burrow-theme",n)}catch(e){}label()})}
(function(){
var vs=document.querySelectorAll("video.clip");if(!vs.length)return;
var rm=window.matchMedia?matchMedia("(prefers-reduced-motion: reduce)"):{matches:false};
var seen=[];
function sync(v,b){var p=v.paused;if(b){b.classList.toggle("paused",p);var t=p?b.getAttribute("data-play"):b.getAttribute("data-pause");b.setAttribute("aria-label",t);b.setAttribute("title",t)}}
function play(v){var r=v.play();if(r&&r.catch)r.catch(function(){})}
Array.prototype.forEach.call(vs,function(v){
 v.removeAttribute("controls");v.muted=true;
 var b=v.parentNode.querySelector(".vctl");
 v.setAttribute("data-auto",v.hasAttribute("autoplay")?"1":"0");
 if(rm.matches){v.pause();v.removeAttribute("autoplay")}
 sync(v,b);
 v.addEventListener("play",function(){sync(v,b)});v.addEventListener("pause",function(){sync(v,b)});
 if(b)b.addEventListener("click",function(){if(v.paused){v.setAttribute("data-user","play");play(v)}else{v.setAttribute("data-user","pause");v.pause()}});
});
if("IntersectionObserver" in window){
 var io=new IntersectionObserver(function(es){es.forEach(function(e){var v=e.target;
  if(e.isIntersecting){if(!rm.matches&&v.getAttribute("data-user")!=="pause")play(v)}
  else if(!v.paused){v.pause()}})},{threshold:.35});
 Array.prototype.forEach.call(vs,function(v){io.observe(v)});
}else if(!rm.matches){Array.prototype.forEach.call(vs,play)}
if(rm.addEventListener)rm.addEventListener("change",function(){if(rm.matches)Array.prototype.forEach.call(vs,function(v){v.pause()})});
})();
(function(){
var cp=navigator.clipboard;if(!cp||!cp.writeText||!window.isSecureContext)return;
var lab=document.body.getAttribute("data-copy"),done=document.body.getAttribute("data-copied"),aria=document.body.getAttribute("data-copyaria");
if(!lab)return;
Array.prototype.forEach.call(document.querySelectorAll("pre>code"),function(c){
 var pre=c.parentNode,w=document.createElement("div"),b=document.createElement("button"),t;
 w.className="codewrap";pre.parentNode.insertBefore(w,pre);w.appendChild(pre);
 b.type="button";b.className="copy";b.textContent=lab;b.setAttribute("aria-label",aria||lab);w.appendChild(b);
 b.addEventListener("click",function(){cp.writeText(c.textContent).then(function(){b.textContent=done;clearTimeout(t);t=setTimeout(function(){b.textContent=lab},1600)},function(){})});
});
})();
(function(){
var ua=navigator.userAgent||"",pl=(navigator.userAgentData&&navigator.userAgentData.platform)||"",os="";
if(/Android|iPhone|iPad|iPod|CrOS/i.test(ua)||/Android|iOS/i.test(pl))os="";
else if(/^Windows/i.test(pl)||/Windows/.test(ua))os="windows";
else if(/^macOS/i.test(pl)||/Macintosh|Mac OS X/.test(ua))os="macos";
else if(/^Linux/i.test(pl)||/Linux|X11/.test(ua))os="linux";
if(!os)return;
var hero=document.getElementById("hero-dl");
if(hero){var t=hero.getAttribute("data-dl-"+os),b=hero.getAttribute("data-base");if(t){hero.textContent=t;if(b)hero.setAttribute("href",b+"#dl-"+os)}}
var secs=document.querySelectorAll(".osdl[data-os]");
Array.prototype.forEach.call(secs,function(s){if(s.getAttribute("data-os")===os){s.classList.add("current");var y=s.querySelector(".osyou");if(y)y.hidden=false;if(s.parentNode&&s.parentNode.firstChild!==s)s.parentNode.insertBefore(s,s.parentNode.firstChild)}});
})();
var side=document.querySelector("details.side");
if(side&&window.matchMedia&&matchMedia("(max-width: 48rem)").matches){side.removeAttribute("open")}
var q=document.getElementById("q"),box=document.getElementById("results"),idx=null,loading=false;
if(!q||!box)return;
var form=q.form;if(form)form.addEventListener("submit",function(e){e.preventDefault()});
function load(cb){if(idx){cb();return}if(loading)return;loading=true;
 fetch(root+"search-index.json").then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){idx=j;cb()}).catch(function(){loading=false;box.innerHTML="";var p=document.createElement("p");p.textContent=q.getAttribute("data-offline")||"Search needs the site to be served over http.";box.appendChild(p);box.className="open"})}
function terms(s){return s.toLowerCase().split(/[^a-z0-9À-ɏ_.+-]+/).filter(function(x){return x.length>1})}
function count(h,t){var c=0,i=-1;while((i=h.indexOf(t,i+1))>=0&&c<50)c++;return c}
function run(){var ts=terms(q.value);if(!ts.length){box.className="";return}
 var res=[];idx.forEach(function(p){var s=0,ti=p.t.toLowerCase(),hd=p.h.join(" ").toLowerCase(),x=p.x.toLowerCase();
  for(var k=0;k<ts.length;k++){var t=ts[k],a=ti.indexOf(t)>=0?10:0,b=hd.indexOf(t)>=0?5:0,c=count(x,t);if(!a&&!b&&!c){s=0;break}s+=a+b+Math.min(c,20)}
  if(s>0)res.push([s,p,x,ts])});
 res.sort(function(a,b){return b[0]-a[0]||(a[1].u<b[1].u?-1:1)});
 box.innerHTML="";
 if(!res.length){var p=document.createElement("p");p.textContent=q.getAttribute("data-none")||"No result";box.appendChild(p)}
 res.slice(0,12).forEach(function(r){var a=document.createElement("a");a.href=root+r[1].u;var b=document.createElement("b");b.textContent=r[1].t;var sm=document.createElement("small");
  var at=r[2].indexOf(r[3][0]),from=Math.max(0,at-60);sm.textContent=at>=0?(from>0?"…":"")+r[1].x.substr(from,150)+"…":r[1].x.substr(0,150)+"…";a.appendChild(b);a.appendChild(sm);box.appendChild(a)});
 box.className="open"}
q.addEventListener("input",function(){load(run)});
q.addEventListener("focus",function(){load(function(){if(q.value)run()})});
document.addEventListener("keydown",function(e){if(e.key==="/"&&document.activeElement!==q&&!/^(input|textarea|select)$/i.test(document.activeElement.tagName)){e.preventDefault();q.focus()}else if(e.key==="Escape"){box.className="";q.blur()}});
document.addEventListener("click",function(e){if(!box.contains(e.target)&&e.target!==q)box.className=""});
})();
