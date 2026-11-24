'use strict';
(() => {
const $ = id => document.getElementById(id), canvas=$('game'), ctx=canvas.getContext('2d');
const W=22,H=14, scale=50, car={length:4.5,width:1.8,wheelbase:2.7,rear:0.9,maxSteer:0.58};
const keys={forward:false,reverse:false,left:false,right:false,brake:false};
let state, scene, paused=false, last=0, history=[], elapsed=0, collisions=0, shifts=0, lastDirection=0, minDistance=Infinity, hold=0, collisionLatch=false;
const descriptions={parking:['倒车入库','把车倒入绿色车位','车身完整进入车位，摆正并停稳。'],exit:['窄通道出库','驶出车位并进入通道','留意邻车和墙角，进入绿色区域后停稳。'],parallel:['侧方停车','倒入路边空位','在两车之间调整车身，进入绿色区域并停稳。']};
function rect(x,y,w,h,type='wall'){return {x,y,w,h,type};}
function buildScene(name,difficulty){
 const n={easy:0,normal:1,hard:2}[difficulty], walls=[rect(0,0,22,.25),rect(0,13.75,22,.25),rect(0,0,.25,14),rect(21.75,0,.25,14)];
 if(name==='parking'||name==='exit'){
  const width=[3.4,3.0,2.75][n], x=8.4, gap=width/2;
  walls.push(rect(x-gap-2.0,.65,1.9,4.5,'car'),rect(x+gap+.1,.65,1.9,4.5,'car'));
  walls.push(rect(15.8,6.0,.7,.7,'pillar'));
  return {obstacles:walls,slot:{x:x-width/2,y:.5,w:width,h:5.1,angle:Math.PI/2},target:name==='parking'?{x:x-width/2,y:.5,w:width,h:5.1,angle:Math.PI/2}:{x:12,y:8.5,w:7,h:3.4,angle:0},start:name==='parking'?{x:13.8,y:8.0,angle:0}:{x:x,y:2.0,angle:Math.PI/2}};
 }
 const length=[7.5,7,6.6][n], x=11, start=x-length/2;
 walls.push(rect(start-4.7,.65,4.5,1.9,'car'),rect(start+length+.2,.65,4.5,1.9,'car'));
 return {obstacles:walls,slot:{x:start,y:.5,w:length,h:2.8,angle:0},target:{x:start,y:.5,w:length,h:2.8,angle:0},start:{x:16,y:5.0,angle:0}};
}
function reset(){scene=buildScene($('scene').value,$('difficulty').value);state={...scene.start,v:0,steer:0};paused=false;history=[];elapsed=0;collisions=0;shifts=0;lastDirection=0;minDistance=Infinity;hold=0;collisionLatch=false;clearKeys();$('pause').textContent='暂停';$('overlay').hidden=true;let d=descriptions[$('scene').value];$('sceneTitle').textContent=d[0];$('goalTitle').textContent=d[1];$('goalText').textContent=d[2];draw();updateUI();}
function clearKeys(){Object.keys(keys).forEach(k=>keys[k]=false);document.querySelectorAll('[data-key]').forEach(b=>b.classList.remove('active'));}
function corners(s){let c=Math.cos(s.angle),sn=Math.sin(s.angle), front=car.length-car.rear, back=-car.rear, half=car.width/2;return [[front,half],[front,-half],[back,-half],[back,half]].map(([x,y])=>({x:s.x+x*c-y*sn,y:s.y+x*sn+y*c}));}
function rectCorners(r){return [{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];}
function overlap(a,b){for(const poly of [a,b])for(let i=0;i<poly.length;i++){let p=poly[i],q=poly[(i+1)%poly.length],ax=-(q.y-p.y),ay=q.x-p.x;let aa=a.map(v=>v.x*ax+v.y*ay),bb=b.map(v=>v.x*ax+v.y*ay);if(Math.max(...aa)<=Math.min(...bb)||Math.max(...bb)<=Math.min(...aa))return false;}return true;}
function hits(s){let p=corners(s);return scene.obstacles.some(o=>overlap(p,rectCorners(o)));}
function segmentDistance(p,a,b){let dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function nearest(s){let p=corners(s),best=Infinity;for(let o of scene.obstacles){let q=rectCorners(o);if(overlap(p,q))return 0;for(let i=0;i<4;i++)for(let j=0;j<4;j++){best=Math.min(best,segmentDistance(p[i],q[j],q[(j+1)%4]),segmentDistance(q[i],p[j],p[(j+1)%4]));}}return best;}
function move(s,dist){let mid=s.angle+dist*Math.tan(s.steer)/car.wheelbase/2;return {...s,x:s.x+dist*Math.cos(mid),y:s.y+dist*Math.sin(mid),angle:s.angle+dist*Math.tan(s.steer)/car.wheelbase};}
function inTarget(){let t=scene.target, p=corners(state), angle=Math.abs(Math.atan2(Math.sin(state.angle-t.angle),Math.cos(state.angle-t.angle)));return p.every(v=>v.x>=t.x&&v.x<=t.x+t.w&&v.y>=t.y&&v.y<=t.y+t.h)&&($('scene').value==='exit'?angle<15*Math.PI/180:Math.min(angle,Math.abs(Math.PI-angle))<10*Math.PI/180)&&Math.abs(state.v)<.055;}
function update(dt){if(paused)return;elapsed+=dt;
 const steerInput=(keys.right?1:0)-(keys.left?1:0); if(steerInput)state.steer=Math.max(-car.maxSteer,Math.min(car.maxSteer,state.steer+steerInput*1.0*dt));else state.steer*=Math.max(0,1-1.6*dt);
 let input=(keys.forward?1:0)-(keys.reverse?1:0), decel=keys.brake||(!input)||(keys.forward&&keys.reverse);let accel=1.5;
 if(decel)state.v=Math.sign(state.v)*Math.max(0,Math.abs(state.v)-2.5*dt);else if(input*state.v<0)state.v=Math.sign(state.v)*Math.max(0,Math.abs(state.v)-2.5*dt);else state.v=Math.max(-5/3.6,Math.min(8/3.6,state.v+input*accel*dt));
 let dir=Math.sign(state.v);if(dir&&lastDirection&&dir!==lastDirection)shifts++;if(dir)lastDirection=dir;
 let dist=state.v*dt,steps=Math.max(1,Math.ceil(Math.abs(dist)/.025)), collided=false;
 for(let i=0;i<steps;i++){let next=move(state,dist/steps);if(hits(next)){state.v=0;collided=true;break;}state=next;}
 if(collided&&!collisionLatch){collisions++;collisionLatch=true;}if(!collided&&Math.abs(state.v)>.02)collisionLatch=false;
 let near=nearest(state);minDistance=Math.min(minDistance,near);if(history.length===0||Math.hypot(state.x-history[history.length-1].x,state.y-history[history.length-1].y)>.1){history.push({x:state.x,y:state.y});if(history.length>1200)history.shift();}
 if(inTarget())hold+=dt;else hold=0;if(hold>=1)finish();updateUI(collided,near);
}
function finish(){paused=true;clearKeys();$('pause').textContent='继续';$('overlay').innerHTML=`<div><h2>练习完成</h2><p>${collisions?'碰撞 '+collisions+' 次':'无碰撞完成'}　·　用时 ${Math.round(elapsed)} 秒<br>前后换向 ${shifts} 次　·　最近距离 ${Number.isFinite(minDistance)?minDistance.toFixed(2):'—'} 米</p><button id="again">再练一次</button></div>`;$('overlay').hidden=false;$('again').onclick=reset;}
function updateUI(collided=false,near=nearest(state)){$('gear').textContent=state.v>.02?'前进':state.v<-.02?'倒车':'停止';$('speed').innerHTML=(Math.abs(state.v)*3.6).toFixed(1)+' <small>km/h</small>';$('steering').textContent=Math.abs(state.steer)<.04?'回正':(state.steer<0?'左 ':'右 ')+Math.round(Math.abs(state.steer)/car.maxSteer*100)+'%';$('distance').textContent=$('distToggle').checked?near.toFixed(2)+' 米':'已关闭';let alert=$('alert');alert.className='notice'+(collided?' danger':near<.5?' warn':'');alert.textContent=collided?'碰到障碍，试着反向驶离。':near<.2?'距离很近，请小心调整。':near<.5?'注意：车辆靠近障碍。':'保持低速，留意车身四周。';}
function polygon(points,fill,stroke){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x*scale,p.y*scale):ctx.moveTo(p.x*scale,p.y*scale));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#cbd7d8';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle='#b8c9cb';ctx.lineWidth=1;for(let x=1;x<W;x++){ctx.beginPath();ctx.moveTo(x*scale,0);ctx.lineTo(x*scale,H*scale);ctx.stroke();}for(let y=1;y<H;y++){ctx.beginPath();ctx.moveTo(0,y*scale);ctx.lineTo(W*scale,y*scale);ctx.stroke();}
 let slot=scene.slot;ctx.strokeStyle='#f8fcfb';ctx.lineWidth=3;ctx.strokeRect(slot.x*scale,slot.y*scale,slot.w*scale,slot.h*scale);
 let t=scene.target;ctx.fillStyle='#33a98433';ctx.fillRect(t.x*scale,t.y*scale,t.w*scale,t.h*scale);ctx.save();ctx.strokeStyle='#087f6d';ctx.lineWidth=3;ctx.setLineDash([10,7]);ctx.strokeRect(t.x*scale,t.y*scale,t.w*scale,t.h*scale);ctx.restore();ctx.fillStyle='#087f6d';ctx.font='bold 16px sans-serif';ctx.fillText('目标区域',t.x*scale+8,t.y*scale+20);
 for(let o of scene.obstacles){ctx.fillStyle=o.type==='car'?'#81959a':o.type==='pillar'?'#5b6e72':'#42565d';ctx.fillRect(o.x*scale,o.y*scale,o.w*scale,o.h*scale);if(o.type==='car'){ctx.fillStyle='#b7c6c8';ctx.fillRect((o.x+.25)*scale,(o.y+.4)*scale,Math.max(0,o.w-.5)*scale,Math.max(0,o.h-.8)*scale);}}
 if($('trail').checked&&history.length>1){ctx.beginPath();history.forEach((p,i)=>i?ctx.lineTo(p.x*scale,p.y*scale):ctx.moveTo(p.x*scale,p.y*scale));ctx.strokeStyle='#426d9a99';ctx.lineWidth=3;ctx.stroke();}
 if($('trajectory').checked){let p={...state},direction=state.v<-.02||(!state.v&&(keys.reverse||(!keys.forward&&lastDirection<0)))?-1:1;ctx.beginPath();ctx.moveTo(p.x*scale,p.y*scale);for(let i=0;i<50;i++){p=move(p,direction*.1);ctx.lineTo(p.x*scale,p.y*scale);}ctx.strokeStyle='#145dba';ctx.lineWidth=2;ctx.setLineDash([7,6]);ctx.stroke();ctx.setLineDash([]);}
 ctx.save();ctx.translate(state.x*scale,state.y*scale);ctx.rotate(state.angle);ctx.fillStyle='#1f4e6b33';ctx.fillRect(-car.rear*scale+4,-car.width*scale/2+5,car.length*scale,car.width*scale);ctx.fillStyle='#2373b5';ctx.strokeStyle='#124f7e';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(-car.rear*scale,-car.width*scale/2,car.length*scale,car.width*scale,12);ctx.fill();ctx.stroke();ctx.fillStyle='#b9dce9';ctx.fillRect(.9*scale,-.7*scale,1.15*scale,1.4*scale);ctx.fillStyle='#f3d88d';ctx.fillRect((car.length-car.rear-.12)*scale,-.68*scale,.12*scale,.38*scale);ctx.fillRect((car.length-car.rear-.12)*scale,.3*scale,.12*scale,.38*scale);ctx.fillStyle='#e5655d';ctx.fillRect(-car.rear*scale,-.65*scale,.1*scale,.3*scale);ctx.fillRect(-car.rear*scale,.35*scale,.1*scale,.3*scale);for(let y of [-.9,.9]){ctx.save();ctx.translate(car.wheelbase*scale,y*scale);ctx.rotate(state.steer);ctx.fillStyle='#263940';ctx.fillRect(-.35*scale,-.08*scale,.7*scale,.16*scale);ctx.restore();}ctx.restore();
}
function togglePause(){if(!$('overlay').hidden)return;paused=!paused;clearKeys();$('pause').textContent=paused?'继续':'暂停';if(paused){$('overlay').innerHTML='<div><h2>已暂停</h2><p>准备好后继续练习</p><button id="resume">继续练习</button></div>';$('overlay').hidden=false;$('resume').onclick=()=>{$('overlay').hidden=true;paused=false;$('pause').textContent='暂停';};}}
const map={w:'forward',arrowup:'forward',s:'reverse',arrowdown:'reverse',a:'left',arrowleft:'left',d:'right',arrowright:'right',' ':'brake'};
window.addEventListener('keydown',e=>{if(e.target.matches('select, button, input')||$('help').open)return;let k=e.key.toLowerCase();if(map[k]){e.preventDefault();keys[map[k]]=true;}else if(k==='escape'){e.preventDefault();togglePause();}else if(k==='r'&&!e.repeat){if(confirm('重新开始会清除本次练习进度，继续吗？'))reset();}});
window.addEventListener('keyup',e=>{let k=map[e.key.toLowerCase()];if(k){e.preventDefault();keys[k]=false;}});
window.addEventListener('blur',()=>{clearKeys();if(state)state.v=0;});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();state.v=0;last=0;}});
for(let b of document.querySelectorAll('[data-key]')){let key=b.dataset.key;b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys[key]=true;b.classList.add('active');});for(let evt of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(evt,()=>{keys[key]=false;b.classList.remove('active');});}
$('scene').onchange=reset;$('difficulty').onchange=reset;$('pause').onclick=togglePause;$('reset').onclick=()=>{if(confirm('重新开始会清除本次练习进度，继续吗？'))reset();};$('helpBtn').onclick=()=>{clearKeys();state.v=0;$('help').showModal();};
function frame(ts){if(last)update(Math.min((ts-last)/1000,.05));last=ts;draw();requestAnimationFrame(frame);}reset();requestAnimationFrame(frame);
})();
