// @ts-check
// Shared "verified!" celebration overlay with the Nebula mascot. Injected into
// both the anti-bot proof-of-work page and the interactive challenge/game page
// so a passing visitor sees the mascot congratulate them before the redirect.
//
// Exposes window.nebulaCelebrate(done): reveals the overlay, plays the mascot
// + confetti, then calls done() after a short beat (so it's actually seen).
// The string is spliced verbatim into each page before </body>; it must not
// contain backticks or ${…} (it is embedded, never re-evaluated as a template).

export const CELEBRATION_SNIPPET = `
<div id="nb-cel" aria-hidden="true">
  <div class="nb-cel-bubble" id="nb-cel-bubble">Oé, t'es vérifié&nbsp;! ✨</div>
  <div class="nb-cel-stage">
    <svg class="nb-mascot" viewBox="0 0 140 152" width="132" height="144" role="img" aria-label="Mascotte Nebula">
      <defs>
        <radialGradient id="nbBody" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stop-color="#d6a6ff"/><stop offset="52%" stop-color="#9D4EDD"/><stop offset="100%" stop-color="#5b18a3"/>
        </radialGradient>
        <linearGradient id="nbStar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#7bf1ff"/><stop offset="100%" stop-color="#c77dff"/>
        </linearGradient>
        <filter id="nbGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
      </defs>
      <ellipse class="nb-glow" cx="70" cy="98" rx="48" ry="46" fill="#9D4EDD" opacity=".4" filter="url(#nbGlow)"/>
      <line x1="70" y1="56" x2="70" y2="32" stroke="#c77dff" stroke-width="3" stroke-linecap="round"/>
      <path class="nb-tw" d="M70 15 l4.2 8.4 9.3 1.1 -6.8 6.3 1.7 9.2 -8.4-4.6 -8.4 4.6 1.7-9.2 -6.8-6.3 9.3-1.1z" fill="url(#nbStar)"/>
      <rect x="25" y="56" width="90" height="84" rx="42" fill="url(#nbBody)"/>
      <g class="nb-eyes-open">
        <circle cx="54" cy="92" r="10.5" fill="#fff"/><circle cx="87" cy="92" r="10.5" fill="#fff"/>
        <circle class="nb-pupil" cx="54" cy="94" r="4.6" fill="#25103f"/><circle class="nb-pupil" cx="87" cy="94" r="4.6" fill="#25103f"/>
      </g>
      <g class="nb-eyes-happy">
        <path d="M45 94 q9 -10 18 0" stroke="#25103f" stroke-width="4.2" fill="none" stroke-linecap="round"/>
        <path d="M78 94 q9 -10 18 0" stroke="#25103f" stroke-width="4.2" fill="none" stroke-linecap="round"/>
      </g>
      <path class="nb-mouth" d="M57 114 q13 14 26 0" stroke="#25103f" stroke-width="4.2" fill="none" stroke-linecap="round"/>
      <circle cx="41" cy="110" r="5.5" fill="#ff8fd0" opacity=".55"/><circle cx="99" cy="110" r="5.5" fill="#ff8fd0" opacity=".55"/>
    </svg>
  </div>
  <div class="nb-cel-sub" id="nb-cel-sub">Bienvenue, humain 👋</div>
  <div class="nb-brand">Bouclier Nebula</div>
</div>
<style>
#nb-cel{position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:radial-gradient(circle at 30% 20%,rgba(157,78,221,.28),transparent 55%),radial-gradient(circle at 78% 22%,rgba(34,211,238,.16),transparent 50%),rgba(7,7,11,.92);
  backdrop-filter:blur(4px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
#nb-cel.show{display:flex;animation:nb-fade .3s ease-out both}
.nb-cel-stage{position:relative}
.nb-mascot{filter:drop-shadow(0 10px 26px rgba(157,78,221,.5))}
#nb-cel.show .nb-mascot{animation:nb-pop .6s cubic-bezier(.2,1.5,.4,1) both,nb-bob 2.4s ease-in-out .6s infinite}
.nb-tw{transform-origin:70px 27px;animation:nb-spin 3.4s linear infinite}
.nb-eyes-happy{opacity:0}
#nb-cel.show .nb-eyes-open{opacity:0}
#nb-cel.show .nb-eyes-happy{opacity:1}
.nb-cel-bubble{position:relative;background:#fff;color:#25103f;font-weight:700;font-size:16px;padding:11px 18px;border-radius:16px;
  box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0}
.nb-cel-bubble::after{content:'';position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);border:8px solid transparent;border-top-color:#fff}
#nb-cel.show .nb-cel-bubble{animation:nb-drop .5s cubic-bezier(.2,1.4,.4,1) .25s both}
.nb-cel-sub{color:#e9ddff;font-size:14px;opacity:0}
#nb-cel.show .nb-cel-sub{animation:nb-fade .4s ease-out .5s both}
.nb-brand{position:fixed;bottom:20px;color:#a1a1aa;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700}
.nb-conf{position:fixed;top:-12px;width:9px;height:14px;border-radius:2px;z-index:2147483645;will-change:transform;pointer-events:none}
@keyframes nb-fade{from{opacity:0}to{opacity:1}}
@keyframes nb-pop{0%{transform:scale(.3) rotate(-12deg);opacity:0}60%{transform:scale(1.12) rotate(4deg)}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes nb-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
@keyframes nb-spin{to{transform:rotate(360deg)}}
@keyframes nb-drop{0%{transform:translateY(-14px) scale(.8);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}
@keyframes nb-fall{to{transform:translateY(105vh) rotate(720deg);opacity:.9}}
@media (prefers-reduced-motion:reduce){#nb-cel.show .nb-mascot,.nb-tw{animation:none}.nb-conf{display:none}}
</style>
<script>
window.nebulaCelebrate=function(done){
  var o=document.getElementById('nb-cel');
  var finished=false; var go=function(){ if(finished)return; finished=true; try{done&&done();}catch(e){} };
  if(!o){ setTimeout(go,300); return; }
  o.classList.add('show');
  try{
    var cols=['#9D4EDD','#22d3ee','#c77dff','#ffd166','#ff8fd0','#7bf1ff'];
    for(var i=0;i<34;i++){(function(){
      var c=document.createElement('div');c.className='nb-conf';
      c.style.left=(Math.random()*100)+'vw';
      c.style.background=cols[i%cols.length];
      var dur=(1.6+Math.random()*1.4);
      c.style.animation='nb-fall '+dur+'s linear '+(Math.random()*.5)+'s forwards';
      c.style.opacity='0.9';
      document.body.appendChild(c);
      setTimeout(function(){ if(c.parentNode)c.parentNode.removeChild(c); }, (dur+1)*1000);
    })();}
  }catch(e){}
  setTimeout(go,1900);
};
</script>`;
