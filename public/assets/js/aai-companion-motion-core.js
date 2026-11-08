/* AAi Companion motion geometry. Canonical pixels only: never replace face or AAi crystal. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AAiCompanionMotionCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const WIDTH = 1230, HEIGHT = 1278;
  const STATES = Object.freeze(['sleep','wake','idle','think','talk','shy','happy','fly']);
  // Polygons map to the verified 1230x1278 transparent studio master.
  // The diamond and its AAi lettering (center chest) are never segmented.
  const PARTS = Object.freeze([
    {name:'ribbonLeft', pivot:[475,747], points:[[138,640],[240,620],[360,688],[428,772],[408,875],[334,1042],[216,1060],[116,985],[104,824]]},
    {name:'ribbonRight',pivot:[836,737], points:[[870,570],[1045,592],[1165,680],[1172,922],[1132,1145],[1015,1195],[930,1130],[995,982],[920,855],[838,762]]},
    {name:'hairLeft',  pivot:[436,475], points:[[285,395],[360,377],[442,405],[442,525],[401,613],[335,678],[285,663],[258,540]]},
    {name:'hairRight', pivot:[803,445], points:[[794,354],[889,358],[977,448],[1014,534],[970,633],[890,659],[814,584]]},
    {name:'skirtLeft', pivot:[566,828], points:[[450,817],[543,789],[656,864],[641,989],[552,1099],[434,1122],[371,1018]]},
    {name:'skirtRight',pivot:[715,833], points:[[659,826],[769,782],[894,836],[931,965],[850,1100],[760,1110],[676,990]]},
    {name:'armLeft',  pivot:[537,681], points:[[340,564],[448,570],[521,616],[567,669],[565,755],[492,759],[422,711],[328,661]]},
    {name:'armRight', pivot:[804,744], points:[[795,689],[870,701],[955,728],[1037,778],[1051,843],[989,882],[900,847],[804,809]]},
  ]);
  const ZERO = Object.freeze({
    x:0,y:0,angle:0,scale:1,eyes:0,mouth:1,
    ribbonLeft:0,ribbonRight:0,hairLeft:0,hairRight:0,
    skirtLeft:0,skirtRight:0,armLeft:0,armRight:0,
  });
  const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
  const ease = v => { const t=clamp(v,0,1); return t*t*(3-2*t); };
  const lerp = (a,b,t)=>a+(b-a)*t;
  const poseMix = (a,b,t) => {
    const k=ease(t), out={};
    for(const key of Object.keys(ZERO)) out[key]=lerp(a[key]??ZERO[key],b[key]??ZERO[key],k);
    return out;
  };
  function poseFor(state, seconds=0) {
    const t=Math.max(0,Number(seconds)||0);
    const sway=Math.sin(t*1.55), breath=Math.sin(t*2.0), flutter=Math.sin(t*3.6);
    const base={...ZERO, y:-1.6*breath,angle:.006*sway,scale:1+.005*breath,
      hairLeft:.022*sway,hairRight:-.026*sway,
      ribbonLeft:.045*flutter,ribbonRight:-.052*flutter,
      skirtLeft:.018*sway,skirtRight:-.022*sway};
    switch(state){
      case 'sleep':
        return {...base,y:16+1.3*breath,angle:-.90,scale:.82,eyes:1,mouth:0,
          armLeft:.70,armRight:-.76,hairLeft:.1,hairRight:-.08,
          ribbonLeft:.13,ribbonRight:-.12,skirtLeft:.07,skirtRight:-.05};
      case 'wake': {
        const k=ease(t/1.8);
        return poseMix(poseFor('sleep',0),{...base,y:-7,angle:.07,scale:1.02,
          eyes:0,mouth:1,armLeft:-.13,armRight:.15,
          ribbonLeft:.18*flutter,ribbonRight:-.15*flutter},k);
      }
      case 'think': return {...base,angle:-.035,eyes:.18,mouth:0,armLeft:-.10,
        armRight:-.90,hairLeft:.035*sway,skirtRight:-.035*sway};
      case 'talk': return {...base,y:-2-2*breath,armLeft:.07+.14*sway,
        armRight:-.06-.12*sway,mouth:clamp(.56+.44*Math.sin(t*11),.05,1),
        hairLeft:.06*sway,hairRight:-.07*sway,
        skirtLeft:.04*flutter,skirtRight:-.04*flutter};
      case 'shy': return {...base,y:1,angle:-.105,eyes:.62,mouth:0,
        armLeft:.84,armRight:-1.28,hairLeft:.09,hairRight:-.07,
        ribbonLeft:.11,ribbonRight:-.08};
      case 'happy': return {...base,y:-5-2*breath,angle:.028*sway,
        armLeft:-.12-.08*sway,armRight:.16+.09*sway,mouth:1};
      case 'fly': {
        const k=ease(t/3.8), arc=Math.sin(Math.PI*k);
        return {...base,x:27*Math.sin(Math.PI*2*k),y:-36*arc,
          angle:.12*Math.sin(Math.PI*2*k),scale:1+.045*arc,
          armLeft:-.24,armRight:.25,mouth:1,
          hairLeft:.11*sway,hairRight:-.12*sway,
          ribbonLeft:.19*flutter,ribbonRight:-.2*flutter,
          skirtLeft:.085*sway,skirtRight:-.095*sway};
      }
      default: return base;
    }
  }
  function validState(state){return STATES.includes(state);}
  return {WIDTH,HEIGHT,STATES,PARTS,ZERO,ease,poseMix,poseFor,validState};
});
