(function(){
if(!window.mermaid)return;
var d=document.documentElement,t=d.getAttribute("data-theme");
var dark=t==="dark"||(t!=="light"&&window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);
mermaid.initialize({startOnLoad:true,securityLevel:"strict",theme:dark?"dark":"default",fontFamily:"Inter,system-ui,sans-serif"});
})();
