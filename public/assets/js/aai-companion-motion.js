/* AAi Pendamping: lightweight 2D cut-out rig for the verified studio PNG.
   The crystal and the letters "AAi" remain untouched in the source torso. */
(function () {
  'use strict';
  const core=window.AAiCompanionMotionCore;
  const stage=document.getElementById('aaiCompanionStage');
  const mascot=document.getElementById('aaiCompanionMascot');
  const widget=document.getElementById('aaiCompanionWidget');
  const img=mascot?.querySelector('img');
  if(!core||!stage||!mascot||!widget||!img) return;
  const canvas=document.createElement('canvas');
  canvas.className='aai-companion-rig';
  canvas.setAttribute('aria-hidden','true');
  canvas.setAttribute('role','presentation');
  const ctx=canvas.getContext('2d',{alpha:true,desynchronized:true,willReadFrequently:true});
  if(!ctx) return; // Original accessible image remains the fallback.
  let phase='sleep',phaseAt=0,lastAction=0,ready=false,started=false;
  let autoWake=true,fromPose=null,blendAt=0,currentPose=null;
  let timer=0,lastFrame=0,frameWidth=0,frameHeight=0;
  // Real illustrated key poses from the same AAi master: no body-rotation substitute.
  // Each pose still has independent ribbon/hair/hand articulation in drawLayer().
  const altUrls = {
    sleep:'/assets/img/aai-companion-sleep-v2.webp',
    think:'/assets/img/aai-companion-think-v2.webp',
    talk:'/assets/img/aai-companion-talk-v2.webp',
  };
  const altImages = {};
  for (const [kind,url] of Object.entries(altUrls)) {
    const picture = new Image();
    picture.decoding='async';
    picture.onload=()=>{if(ready)draw(now());};
    picture.src=url;
    altImages[kind]=picture;
  }
  let previousPhase='idle';
  const TALK_ARMS = [
    {name:'armLeft', pivot:[568,681], points:[[448,585],[516,593],[577,622],[597,694],[559,747],[497,742],[447,690]]},
    {name:'armRight', pivot:[822,660], points:[[774,594],[845,577],[903,542],[971,513],[1054,540],[1058,636],[955,696],[822,741]]},
  ];
  const reducedQuery=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const live=()=>document.body.classList.contains('aai-companion-active')&&!stage.hidden;
  const reduced=()=>Boolean(reducedQuery?.matches)||document.body.classList.contains('aai-companion-low-motion');
  const now=()=>performance.now();

  function resize(){
    const box=mascot.getBoundingClientRect();
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(box.width*ratio));
    const h=Math.max(1,Math.round(box.height*ratio));
    if(w!==canvas.width||h!==canvas.height){canvas.width=w;canvas.height=h;}
    frameWidth=box.width;frameHeight=box.height;
  }
  function path(points){
    ctx.beginPath();
    points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.closePath();
  }
  function circleSource(x,y,r){
    ctx.save();
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
    ctx.drawImage(img,0,0,core.WIDTH,core.HEIGHT);
    ctx.restore();
  }
  function drawLids(amount){
    if(amount<.04)return;
    ctx.save();ctx.globalAlpha=core.ease(amount);
    for(const [x,y,rx,ry] of [[542,526,61,55],[720,475,55,54]]){
      const skin=ctx.createRadialGradient(x,y,9,x,y,Math.max(rx,ry));
      skin.addColorStop(0,'rgba(255,231,238,1)');
      skin.addColorStop(.60,'rgba(255,238,244,.98)');
      skin.addColorStop(1,'rgba(255,237,245,0)');
      ctx.fillStyle=skin;
      ctx.beginPath();ctx.ellipse(x,y,rx,ry,-.10,0,Math.PI*2);ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x-rx*.64,y+3);ctx.quadraticCurveTo(x,y+24,x+rx*.65,y-2);
      ctx.strokeStyle='rgba(124,73,106,.80)';
      ctx.lineWidth=6;ctx.lineCap='round';ctx.stroke();
    }
    ctx.restore();
  }
  function drawMouth(open){
    if(open>.93)return;
    const closed=core.ease(1-open);
    ctx.save();ctx.globalAlpha=closed;
    const x=642,y=549;
    const skin=ctx.createRadialGradient(x,y,2,x,y,37);
    skin.addColorStop(0,'rgba(255,224,230,1)');
    skin.addColorStop(.63,'rgba(255,232,240,.96)');
    skin.addColorStop(1,'rgba(255,232,240,0)');
    ctx.fillStyle=skin;ctx.beginPath();ctx.ellipse(x,y,41,35,0,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.moveTo(x-14,y+4);ctx.quadraticCurveTo(x,y+10,x+15,y+3);
    ctx.strokeStyle='rgba(171,87,116,.9)';ctx.lineWidth=4;ctx.lineCap='round';ctx.stroke();
    ctx.restore();
  }
  function sprite(kind) {
    const candidate=altImages[kind];
    return candidate?.complete && candidate.naturalWidth>=500
      && Math.abs(candidate.naturalWidth/candidate.naturalHeight-core.WIDTH/core.HEIGHT)<.02
      ? candidate : img;
  }
  function kindFor(phaseName) {
    return phaseName==='sleep'?'sleep'
      : phaseName==='think'?'think'
      : phaseName==='talk'?'talk':'original';
  }
  function drawLayer(t,kind,pose,opacity=1,articulate=true) {
    const W=core.WIDTH,H=core.HEIGHT;
    const source=kind==='original'?img:sprite(kind);
    if(source===img)kind='original';
    if(opacity<=.002)return;
    const scale=Math.min(canvas.width/W,canvas.height/H);
    const dx=(canvas.width-W*scale)/2,dy=(canvas.height-H*scale)/2;
    ctx.save();
    ctx.setTransform(scale,0,0,scale,dx,dy);
    // Alternate artwork already depicts sleeping, thinking and speaking.
    // Never tilt the entire picture by ~50deg to simulate sleep.
    const drift=kind==='sleep'?1.35*Math.sin(t/950):pose.y*(kind==='original'?1:.2);
    ctx.translate(W/2+pose.x*(kind==='original'?1:.2),H/2+drift);
    ctx.rotate(kind==='original'?pose.angle:pose.angle*.1);
    ctx.scale(kind==='original'?pose.scale:1+.004*Math.sin(t/1100),
              kind==='original'?pose.scale:1+.004*Math.sin(t/1100));
    ctx.translate(-W/2,-H/2);
    ctx.globalAlpha=opacity;
    ctx.drawImage(source,0,0,W,H);
    if(articulate&&opacity>.995){
      const parts=kind==='original'?core.PARTS
        : core.PARTS.filter(p=>/^(ribbon|hair|skirt)/.test(p.name)).concat(kind==='talk'?TALK_ARMS:[]);
      // Source-pixel cut-outs are articulated independently at their own joints.
      // The torso/chest crystal always comes from its untouched source image.
      const movement={...pose};
      if(kind==='sleep'){
        movement.ribbonLeft=.055*Math.sin(t/810);
        movement.ribbonRight=-.065*Math.sin(t/810+.4);
        movement.hairLeft=.015*Math.sin(t/960);
        movement.hairRight=-.014*Math.sin(t/930);
      }
      if(kind==='think'){
        movement.ribbonLeft=.08*Math.sin(t/840);
        movement.ribbonRight=-.06*Math.sin(t/780);
        movement.hairLeft=.026*Math.sin(t/1180);
        movement.hairRight=-.03*Math.sin(t/1260);
      }
      if(kind==='talk'){
        movement.armLeft=.07+.13*Math.sin(t/240);
        movement.armRight=-.10+.19*Math.sin(t/290);
        movement.ribbonLeft=.1*Math.sin(t/270);
        movement.ribbonRight=-.12*Math.sin(t/270+.45);
      }
      const moving=parts.filter(p=>Math.abs(movement[p.name]||0)>.012);
      ctx.save();ctx.globalCompositeOperation='destination-out';
      for(const part of moving){path(part.points);ctx.fill();}
      ctx.restore();
      for(const part of moving){
        const [px,py]=part.pivot;
        ctx.save();ctx.translate(px,py);ctx.rotate(movement[part.name]);ctx.translate(-px,-py);
        path(part.points);ctx.clip();ctx.drawImage(source,0,0,W,H);
        ctx.restore();
      }
      if(kind==='original'){
        if(Math.abs(pose.armLeft)>.08)circleSource(537,681,24);
        if(Math.abs(pose.armRight)>.08)circleSource(804,744,26);
        drawLids(pose.eyes);drawMouth(pose.mouth);
      }
    }
    ctx.restore();
  }
  function draw(t){
    if(!ready)return;
    resize();
    const s=Math.max(0,t-phaseAt)/1000;
    let pose=reduced()?core.poseFor('idle',0):core.poseFor(phase,s);
    if(fromPose&&t-blendAt<450)pose=core.poseMix(fromPose,pose,(t-blendAt)/450);
    else fromPose=null;
    currentPose=pose;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // Wake is an actual curled sleeper revealing the standing body; image
    // crossfade stays short while arms/ribbons finish their joint motions.
    if(phase==='wake'&&sprite('sleep')!==img){
      const awake=core.ease((t-phaseAt)/1700);
      drawLayer(t,'sleep',core.poseFor('sleep',s),1-awake,false);
      drawLayer(t,'original',{...pose,angle:pose.angle*.08,scale:1+(pose.scale-1)*.1,y:pose.y*.3},awake,false);
    }else{
      const to=kindFor(phase);
      const from=kindFor(previousPhase);
      const blend=core.ease((t-blendAt)/320);
      if(!reduced()&&to!==from&&blend<1&&phase!=='sleep'){
        drawLayer(t,from,core.poseFor(previousPhase,0),1-blend,false);
        drawLayer(t,to,pose,blend,false);
      }else drawLayer(t,to,pose,1,!reduced());
    }
    ctx.setTransform(1,0,0,1,0,0);
  }
  function setPhase(next){
    if(!core.validState(next))return;
    const t=now();
    if(phase===next)return;
    previousPhase=phase;
    fromPose=currentPose||core.poseFor(phase,(t-phaseAt)/1000);
    blendAt=t;phase=next;phaseAt=t;
    widget.dataset.motion=next;
    lastAction=t;
    ensure();
  }
  function tick(t){
    timer=0;
    if(!live()||document.hidden||reduced()){
      if(live()&&ready)draw(t);
      return;
    }
    const elapsed=t-phaseAt;
    if(phase==='sleep'&&autoWake&&elapsed>2800)setPhase('wake');
    else if(phase==='wake'&&elapsed>1800)setPhase('idle');
    else if(phase==='happy'&&elapsed>1600)setPhase('idle');
    else if(phase==='shy'&&elapsed>1500)setPhase('idle');
    else if(phase==='fly'&&elapsed>3800)setPhase('idle');
    else if(phase==='idle'&&t-lastAction>42000){autoWake=false;setPhase('sleep');}
    if(t-lastFrame>=32){lastFrame=t;draw(t);}
    // setPhase() can already schedule the next frame during this tick.
    // Scheduling again here creates two independent RAF loops after a transition.
    if(!timer)timer=requestAnimationFrame(tick);
  }
  function ensure(){
    if(!ready||!live()||document.hidden)return;
    if(!started){
      started=true;autoWake=true;phase='sleep';phaseAt=now();lastAction=phaseAt;
      widget.dataset.motion='sleep';
    }
    if(reduced()){
      if(timer){cancelAnimationFrame(timer);timer=0;}
      draw(now());return;
    }
    if(!timer)timer=requestAnimationFrame(tick);
  }
  function stop(){
    if(timer){cancelAnimationFrame(timer);timer=0;}
    if(!live())started=false;
  }
  function onViewChange(){
    if(live())ensure();
    else stop();
  }
  function onImage(){
    if(ready)return; // A cached PNG can trigger both complete and load callbacks.
    if(img.naturalWidth!==core.WIDTH||img.naturalHeight!==core.HEIGHT)return;
    ready=true;mascot.insertBefore(canvas,img);
    resize();draw(now());
    mascot.classList.add('motion-ready');
    ensure();
  }
  // A transformed cut-out no longer occupies its original PNG coordinates.
  // Hit-test the rendered frame, then undo the body transform for touch zones.
  // Returning undefined means the original image-based fallback should be used.
  function hitTest(clientX,clientY){
    if(!ready||!live())return undefined;
    const box=mascot.getBoundingClientRect();
    if(!box.width||!box.height)return null;
    const px=Math.floor((clientX-box.left)*canvas.width/box.width);
    const py=Math.floor((clientY-box.top)*canvas.height/box.height);
    if(px<0||py<0||px>=canvas.width||py>=canvas.height)return null;
    try { if(ctx.getImageData(px,py,1,1).data[3]<35)return null; }
    catch {return undefined;}
    const scale=Math.min(canvas.width/core.WIDTH,canvas.height/core.HEIGHT);
    const dx=(canvas.width-core.WIDTH*scale)/2;
    const dy=(canvas.height-core.HEIGHT*scale)/2;
    const pose=currentPose||core.poseFor('idle',0);
    const vx=(px-dx)/scale-core.WIDTH/2-pose.x;
    const vy=(py-dy)/scale-core.HEIGHT/2-pose.y;
    const cos=Math.cos(pose.angle),sin=Math.sin(pose.angle);
    return {
      x:(vx*cos+vy*sin)/pose.scale+core.WIDTH/2,
      y:(vy*cos-vx*sin)/pose.scale+core.HEIGHT/2,
    };
  }
  const api={
    hitTest,
    activity(kind){
      if(!live()||!ready)return;
      autoWake=false;
      if(kind==='begin'||kind==='status')setPhase('think');
      else if(kind==='token')setPhase('talk');
      else if(kind==='done')setPhase('happy');
      else if(kind==='error')setPhase('idle');
    },
    react(zone){
      if(!live()||!ready)return;
      autoWake=false;
      setPhase(zone==='head'||zone==='protect'||zone==='repeat'?'shy':'happy');
    },
    fly(){
      if(!live()||!ready)return false;
      autoWake=false;setPhase('fly');return true;
    },
    wake(){autoWake=true;setPhase('wake');},
    sleep(){autoWake=false;setPhase('sleep');},
    getState(){return {phase,ready,reduced:reduced()};},
  };
  window.AAiCompanionMotion=api;
  const observer=new MutationObserver(onViewChange);
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  observer.observe(stage,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',onViewChange);
  if(reducedQuery?.addEventListener)reducedQuery.addEventListener('change',onViewChange);
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(ready)draw(now());}).observe(mascot);
  else window.addEventListener('resize',()=>{if(ready)draw(now());});
  img.addEventListener('load',onImage);
  if(img.complete&&img.naturalWidth)onImage();
})();
