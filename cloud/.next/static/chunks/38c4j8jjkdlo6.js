(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,77539,e=>{"use strict";var r=e.i(43476),a=e.i(71645);let t=["system","light","dark"],o="prsa-theme";function i(e){let r=document.documentElement;r.setAttribute("data-prsa-mode",e),r.setAttribute("data-prsa-theme","system"!==e?e:window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light")}let n=`
:root{
  --bg:#f8fafc; --card:#ffffff; --card-border:#e2e8f0; --accent:#4f46e5;
  --tx:#0f172a; --tx-2:#64748b; --hover:rgba(15,23,42,.05);
}
:root[data-prsa-theme="dark"]{
  --bg:#09090b; --card:#18181b; --card-border:#27272a; --accent:#6366f1;
  --tx:#fafafa; --tx-2:#a1a1aa; --hover:rgba(255,255,255,.07);
}
/* Pre-JS fallback: honor the OS unless the owner has explicitly chosen light. */
@media (prefers-color-scheme:dark){
  :root:not([data-prsa-theme="light"]){
    --bg:#09090b; --card:#18181b; --card-border:#27272a; --accent:#6366f1;
    --tx:#fafafa; --tx-2:#a1a1aa; --hover:rgba(255,255,255,.07);
  }
}
.prsa-login{position:fixed;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--tx);-webkit-font-smoothing:antialiased;}
.prsa-bg-glow{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(70% 60% at 50% 28%, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 62%);}
.prsa-bg-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;
  background-image:linear-gradient(var(--card-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--card-border) 1px, transparent 1px);
  background-size:32px 32px;
  -webkit-mask-image:radial-gradient(80% 70% at 50% 40%, black 0%, transparent 78%);
  mask-image:radial-gradient(80% 70% at 50% 40%, black 0%, transparent 78%);}
.prsa-card{position:relative;z-index:1;width:100%;max-width:360px;background:var(--card);
  border:1px solid var(--card-border);border-radius:16px;padding:26px 28px 28px;
  display:flex;flex-direction:column;gap:10px;
  box-shadow:0 1px 2px rgba(16,24,40,.04),0 12px 32px rgba(16,24,40,.08);}
:root[data-prsa-theme="dark"] .prsa-card{box-shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.5);}
.prsa-top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px;}
.prsa-brand{display:flex;align-items:center;gap:7px;color:var(--tx-2);font-size:12px;font-weight:600;
  letter-spacing:.02em;min-width:0;}
.prsa-brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.prsa-theme{display:grid;place-items:center;width:28px;height:28px;flex:none;padding:0;
  background:transparent;border:1px solid var(--card-border);border-radius:8px;color:var(--tx-2);
  cursor:pointer;transition:background .15s ease,color .15s ease;}
.prsa-theme:hover{background:var(--hover);color:var(--tx);}
.prsa-title{margin:6px 0 0;font-size:21px;font-weight:700;letter-spacing:-.01em;}
.prsa-clock{margin:0;font-size:12px;color:var(--tx-2);min-height:1.1em;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;}
.prsa-error{margin-top:4px;font-size:13px;color:#b42318;background:#fef3f2;border:1px solid #fee4e2;
  border-radius:8px;padding:9px 11px;}
:root[data-prsa-theme="dark"] .prsa-error{color:#fca5a5;background:rgba(239,68,68,.10);
  border-color:rgba(239,68,68,.30);}
.prsa-btn{margin-top:8px;background:var(--accent);color:#fff;border:none;border-radius:10px;
  padding:12px 14px;font-weight:600;font-size:15px;text-align:center;text-decoration:none;
  cursor:pointer;transition:filter .15s ease;}
.prsa-btn:hover{filter:brightness(1.08);}
.prsa-btn:focus-visible,.prsa-theme:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
@media (prefers-reduced-motion:reduce){.prsa-btn,.prsa-theme{transition:none;}}
`;e.s(["LoginCard",0,function({authStart:e,error:s}){let[d,l]=(0,a.useState)(""),[c,p]=(0,a.useState)(""),[h,x]=(0,a.useState)("system");return(0,a.useEffect)(()=>{l(window.location.hostname);let e=()=>{var e;let r,a;return p((r=(e=new Date).toLocaleDateString(void 0,{weekday:"short",month:"short",day:"numeric"}),a=e.toLocaleTimeString(void 0,{hour:"numeric",minute:"2-digit"}),`${r} \xb7 ${a}`))};e();let r=window.setInterval(e,3e4),a=null;try{a=window.localStorage.getItem(o)}catch{}let n=t.includes(a??"")?a:"system";x(n),i(n);let s=window.matchMedia("(prefers-color-scheme:dark)"),d=()=>{"system"===document.documentElement.getAttribute("data-prsa-mode")&&i("system")};return s.addEventListener("change",d),()=>{window.clearInterval(r),s.removeEventListener("change",d)}},[]),(0,r.jsxs)("main",{className:"prsa-login",children:[(0,r.jsx)("style",{children:n}),(0,r.jsx)("div",{className:"prsa-bg-glow","aria-hidden":"true"}),(0,r.jsx)("div",{className:"prsa-bg-grid","aria-hidden":"true"}),(0,r.jsxs)("div",{className:"prsa-card",children:[(0,r.jsxs)("div",{className:"prsa-top",children:[(0,r.jsxs)("div",{className:"prsa-brand",children:[(0,r.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("rect",{x:"3",y:"11",width:"18",height:"11",rx:"2"}),(0,r.jsx)("path",{d:"M7 11V7a5 5 0 0 1 10 0v4"})]}),(0,r.jsx)("span",{suppressHydrationWarning:!0,children:d})]}),(0,r.jsxs)("button",{type:"button",onClick:()=>{let e=t[(t.indexOf(h)+1)%t.length];x(e);try{window.localStorage.setItem(o,e)}catch{}i(e)},className:"prsa-theme","aria-label":`Theme: ${h}`,title:`Theme: ${h}`,children:["system"===h&&(0,r.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("rect",{x:"2",y:"3",width:"20",height:"14",rx:"2"}),(0,r.jsx)("path",{d:"M8 21h8M12 17v4"})]}),"light"===h&&(0,r.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("circle",{cx:"12",cy:"12",r:"4"}),(0,r.jsx)("path",{d:"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"})]}),"dark"===h&&(0,r.jsx)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:(0,r.jsx)("path",{d:"M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"})})]})]}),(0,r.jsx)("h1",{className:"prsa-title",children:"Battcal"}),(0,r.jsx)("p",{className:"prsa-clock",suppressHydrationWarning:!0,children:c}),s&&(0,r.jsx)("div",{role:"alert",className:"prsa-error",children:s}),(0,r.jsx)("a",{href:e,className:"prsa-btn",children:"Sign in with SSO"})]})]})}])}]);