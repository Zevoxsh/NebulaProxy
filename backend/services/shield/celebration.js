// @ts-check
// Shared "verified" success overlay. Injected into both the anti-bot
// proof-of-work page and the interactive challenge/game page so a passing
// visitor gets a short, sober confirmation before the redirect.
//
// Exposes window.nebulaCelebrate(done): reveals the overlay (green check +
// "Vérification réussie"), then calls done() after a brief beat.
// The string is spliced verbatim into each page before </body>; it must not
// contain backticks or ${…} (it is embedded, never re-evaluated as a template).

import { MASCOT_BUST_DATA_URI } from './mascot.js';

export const CELEBRATION_SNIPPET = `
<div id="nb-cel" role="status" aria-live="polite" aria-hidden="true">
  <div class="nb-cel-card">
    <div class="nb-cel-figure">
      <img class="nb-cel-mascot" src="` + MASCOT_BUST_DATA_URI + `" alt="" aria-hidden="true">
      <svg class="nb-cel-check" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13"/><path d="M10 16.5l4 4 8-9"/></svg>
    </div>
    <div class="nb-cel-title">Vérification réussie</div>
    <div class="nb-cel-sub">Redirection en cours…</div>
  </div>
  <div class="nb-cel-brand">Performance et sécurité par <b>Bouclier Nebula</b></div>
</div>
<style>
#nb-cel{position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;align-items:center;justify-content:center;gap:24px;
  background:#fff;color:#313131;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased}
@media (prefers-color-scheme:dark){#nb-cel{background:#1b1b1d;color:#e8e8e8}#nb-cel .nb-cel-sub,#nb-cel .nb-cel-brand{color:#a3a3a3}#nb-cel .nb-cel-brand b{color:#e8e8e8}}
#nb-cel.show{display:flex;animation:nb-fade .2s ease-out both}
.nb-cel-card{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:0 24px}
.nb-cel-figure{position:relative;height:220px;margin-bottom:12px}
.nb-cel-mascot{height:220px;width:auto;display:block;filter:drop-shadow(0 12px 28px rgba(0,0,0,.2))}
#nb-cel.show .nb-cel-mascot{animation:nb-pop .5s cubic-bezier(.2,1.2,.4,1) both}
.nb-cel-check{position:absolute;right:-6px;bottom:8px;width:44px;height:44px;background:#fff;border-radius:50%}
@media (prefers-color-scheme:dark){.nb-cel-check{background:#1b1b1d}}
.nb-cel-check circle{fill:none;stroke:#0f9d58;stroke-width:2.5;stroke-dasharray:82;stroke-dashoffset:82}
.nb-cel-check path{fill:none;stroke:#0f9d58;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30}
#nb-cel.show .nb-cel-check circle{animation:nb-draw .45s ease-out forwards}
#nb-cel.show .nb-cel-check path{animation:nb-draw .35s ease-out .3s forwards}
.nb-cel-title{font-size:20px;font-weight:500}
.nb-cel-sub{font-size:14px;color:#6b6b6b}
.nb-cel-brand{position:fixed;bottom:20px;font-size:12px;color:#6b6b6b}
.nb-cel-brand b{font-weight:600;color:#313131}
@keyframes nb-fade{from{opacity:0}to{opacity:1}}
@keyframes nb-draw{to{stroke-dashoffset:0}}
@keyframes nb-pop{0%{transform:scale(.7);opacity:0}100%{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){#nb-cel.show .nb-cel-mascot{animation:none}#nb-cel.show .nb-cel-check circle,#nb-cel.show .nb-cel-check path{animation:none;stroke-dashoffset:0}}
</style>
<script>
window.nebulaCelebrate=function(done){
  var o=document.getElementById('nb-cel');
  var finished=false; var go=function(){ if(finished)return; finished=true; try{done&&done();}catch(e){} };
  if(!o){ setTimeout(go,300); return; }
  o.setAttribute('aria-hidden','false');
  o.classList.add('show');
  setTimeout(go,900);
};
</script>`;
