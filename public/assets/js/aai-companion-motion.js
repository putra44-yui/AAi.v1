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
  const ctx=canvas.getContext('2d',{alpha:true,desynchronized:true});
  if(!ctx) return; // Original accessible image remains the fallback.
  let phase='sleep',phaseAt=0,lastAction=0,ready=false,started=false;
  let autoWake=true,fromPose=null,blendAt=0,currentPose=null;
  let timer=0,lastFrame=0,frameWidth=0,frameHeight=0;
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
  function draw(t){
    if(!ready)return;
    resize();
    const W=core.WIDTH,H=core.HEIGHT;
    const ms=Math.max(0,t-phaseAt),s=ms/1000;
    let pose=reduced()?core.poseFor('idle',0):core.poseFor(phase,s);
    if(fromPose&&t-blendAt<450){
      pose=core.poseMix(fromPose,pose,(t-blendAt)/450);
    }else fromPose=null;
    currentPose=pose;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    const scale=Math.min(canvas.width/W,canvas.height/H);
    const dx=(canvas.width-W*scale)/2,dy=(canvas.height-H*scale)/2;
    ctx.setTransform(scale,0,0,scale,dx,dy);
    ctx.translate(W/2+pose.x,H/2+pose.y);
    ctx.rotate(pose.angle);
    ctx.scale(pose.scale,pose.scale);
    ctx.translate(-W/2,-H/2);
    ctx.drawImage(img,0,0,W,H);
    // Move the actual pixels of each anatomical piece, rather than sliding
    // the entire PNG. Erase each piece's resting pixels before redrawing it.
    const moving=core.PARTS.filter(p=>Math.abs(pose[p.name]||0)>.012);
    ctx.save();ctx.globalCompositeOperation='destination-out';
    for(const part of moving){path(part.points);ctx.fill();}
    ctx.restore();
    for(const part of moving){
      const [px,py]=part.pivot;
      ctx.save();ctx.translate(px,py);ctx.rotate(pose[part.name]);ctx.translate(-px,-py);
      path(part.points);ctx.clip();
      ctx.drawImage(img,0,0,W,H);
      ctx.restore();
    }
    // Small source-pixel joint patches reduce holes near moved sleeves.
    if(Math.abs(pose.armLeft)>.08)circleSource(537,681,24);
    if(Math.abs(pose.armRight)>.08)circleSource(804,744,26);
    drawLids(pose.eyes);drawMouth(pose.mouth);
    ctx.setTransform(1,0,0,1,0,0);
  }
  function setPhase(next){
    if(!core.validState(next))return;
    const t=now();
    if(phase===next)return;
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
    timer=requestAnimationFrame(tick);
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
    if(img.naturalWidth!==core.WIDTH||img.naturalHeight!==core.HEIGHT)return;
    ready=true;mascot.insertBefore(canvas,img);
    resize();draw(now());
    mascot.classList.add('motion-ready');
    ensure();
  }
  const api={
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
