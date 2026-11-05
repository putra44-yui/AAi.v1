import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
const core=require('../public/assets/js/aai-companion-motion-core.js');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('AAi studio master is segmented by pixel coordinates but its chest crystal remains intact',()=>{
  assert.equal(core.WIDTH,1230);assert.equal(core.HEIGHT,1278);
  assert.equal(core.PARTS.length,8);
  const names=core.PARTS.map(p=>p.name);
  for(const name of ['armLeft','armRight','hairLeft','hairRight','skirtLeft','skirtRight','ribbonLeft','ribbonRight'])
    assert.ok(names.includes(name),name);
  assert.ok(core.PARTS.every(p=>p.points.length>=4&&p.pivot.length===2));
  assert.ok(core.PARTS.every(p=>!p.points.some(([x,y])=>x>590&&x<700&&y>645&&y<780)));
});
test('sleep, wake, talk, shy and flight move different anatomy in different ways',()=>{
  assert.ok(core.STATES.includes('sleep'));
  const sleep=core.poseFor('sleep',0);
  const wake=core.poseFor('wake',1.8);
  const think=core.poseFor('think',0);
  const talk=core.poseFor('talk',.5);
  const shy=core.poseFor('shy',0);
  const fly=core.poseFor('fly',1.9);
  assert.equal(sleep.eyes,1);
  assert.ok(sleep.angle<-.5);
  assert.ok(wake.angle>-.1);
  assert.ok(think.armRight<-.5);
  assert.notEqual(talk.armLeft,talk.armRight);
  assert.ok(shy.armLeft>.6&&shy.armRight<-1);
  assert.ok(fly.y<-20&&fly.scale>1);
  assert.notEqual(fly.hairLeft,fly.skirtLeft);
});
test('transition easing stays finite and inside endpoints',()=>{
  const sleep=core.poseFor('sleep',0),idle=core.poseFor('idle',0);
  const start=core.poseMix(sleep,idle,0),end=core.poseMix(sleep,idle,1);
  assert.equal(start.angle,sleep.angle);
  assert.equal(end.angle,idle.angle);
  for(const phase of core.STATES)for(const value of Object.values(core.poseFor(phase,.7)))
    assert.ok(Number.isFinite(value),phase);
});
test('web companion wires pixel-part renderer without changing canonical PNG or chat flow',()=>{
  const html=read('public/index.html');
  const js=read('public/assets/js/aai-companion.js');
  const css=read('public/assets/css/aai-companion.css');
  const studioCss=read('public/assets/css/aai-studio.css');
  const rig=read('public/assets/js/aai-companion-motion.js');
  assert.match(html,/src="\/aai-mascot-studio\.png"/);
  assert.match(html,/aai-companion-motion-core\.js/);
  assert.match(html,/aai-companion-motion\.js/);
  assert.match(html,/id="aaiCompanionFly"/);
  assert.match(js,/AAiCompanionMotion\?\.activity\('begin'\)/);
  assert.match(js,/AAiCompanionMotion\?\.activity\('token'\)/);
  assert.match(js,/AAiCompanionMotion\?\.activity\('done'\)/);
  assert.match(js,/AAiCompanionMotion\?\.react\(zone\)/);
  assert.match(rig,/destination-out/);
  assert.match(rig,/requestAnimationFrame/);
  assert.match(rig,/document\.hidden/);
  assert.match(rig,/prefers-reduced-motion/);
  assert.match(rig,/if\(!timer\)timer=requestAnimationFrame\(tick\)/);
  assert.match(rig,/if\(ready\)return;/);
  assert.match(rig,/function hitTest\(clientX,clientY\)/);
  assert.match(rig,/getImageData\(px,py,1,1\)/);
  assert.match(js,/AAiCompanionMotion\?\.hitTest\?\./);
  assert.doesNotMatch(js,/if \(!prefs\.composer\) \{ prefs\.composer=true;/);
  assert.match(js,/returnAfterReaction/);
  assert.match(js,/Restore the answer; never delete or rewrite chat history/);
  assert.match(studioCss,/grid-template-columns:38px minmax\(0,1fr\) 40px/);
  assert.match(studioCss,/#sendBtn\s*\{/);
  assert.match(studioCss,/display:flex!important; align-self:end/);
  assert.match(js,/if \(zone === null\) \{/);
  assert.match(css,/\.aai-companion-mascot\.motion-ready img/);
  assert.doesNotMatch(rig,/aai-mascot\.jpg|vercel\.app/);
});

test('AAi Pendamping uses real alternative illustrated poses and never fakes a checking status',()=>{
  const rig=read('public/assets/js/aai-companion-motion.js');
  const companion=read('public/assets/js/aai-companion.js');
  const lab=read('public/aai-motion-lab.html');
  for(const name of ['sleep','think','talk']){
    const path='public/assets/img/aai-companion-'+name+'-v2.webp';
    const bytes=readFileSync(new URL('../'+path,import.meta.url));
    assert.ok(bytes.length>20000,name+' is a real animation pose asset');
    assert.equal(bytes.toString('ascii',0,4),'RIFF');
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.ok(rig.includes('/assets/img/aai-companion-'+name+'-v2.webp'));
  }
  assert.match(rig,/function drawLayer\(/);
  assert.match(rig,/TALK_ARMS/);
  assert.match(rig,/phase==='wake'/);
  assert.match(lab,/Tanpa akun|tanpa akun|tanpa akun/);
  assert.doesNotMatch(companion,/state\.status='Aku cek dulu, ya\.'/);
  assert.doesNotMatch(companion,/state\.status='Aku cek sumbernya dulu, ya\.'/);
});
