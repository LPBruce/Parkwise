'use strict';
(() => {
const $ = id => document.getElementById(id), canvas=$('game'), ctx=canvas.getContext('2d');
const W=22,H=14, scale=50, car={length:4.95,width:1.935,wheelbase:3,rear:1.0,maxSteer:0.58};
const keys={forward:false,reverse:false,left:false,right:false,brake:false};
const pressedKeys=new Set(), touchKeys=new Set();
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
function clearKeys(){pressedKeys.clear();touchKeys.clear();Object.keys(keys).forEach(k=>keys[k]=false);document.querySelectorAll('[data-key]').forEach(b=>b.classList.remove('active'));}
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
function carArt(length,width,color,frontLight=true){
 const l=length*scale,w=width*scale;
 ctx.save();ctx.shadowColor='#101a1db0';ctx.shadowBlur=13;ctx.shadowOffsetY=8;
 ctx.fillStyle='#1e282d';ctx.beginPath();ctx.roundRect(-l/2-3,-w/2-4,l+6,w+8,17);ctx.fill();ctx.shadowColor='transparent';
 // Low, rounded body and glass roof, drawn within the collision footprint.
 ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(l*.44,-w*.39);ctx.quadraticCurveTo(l*.5,-w*.30,l*.5,0);ctx.quadraticCurveTo(l*.5,w*.30,l*.44,w*.39);ctx.quadraticCurveTo(l*.30,w*.49,l*.18,w*.49);ctx.lineTo(-l*.40,w*.49);ctx.quadraticCurveTo(-l*.5,w*.46,-l*.5,w*.32);ctx.lineTo(-l*.5,-w*.32);ctx.quadraticCurveTo(-l*.5,-w*.46,-l*.40,-w*.49);ctx.lineTo(l*.18,-w*.49);ctx.quadraticCurveTo(l*.30,-w*.49,l*.44,-w*.39);ctx.fill();
 ctx.strokeStyle='#ffffff50';ctx.lineWidth=1.5;ctx.stroke();
 ctx.fillStyle='#182a32';ctx.beginPath();ctx.moveTo(l*.21,-w*.38);ctx.quadraticCurveTo(l*.31,-w*.30,l*.31,0);ctx.quadraticCurveTo(l*.31,w*.30,l*.21,w*.38);ctx.lineTo(-l*.27,w*.38);ctx.quadraticCurveTo(-l*.36,w*.3,-l*.37,0);ctx.quadraticCurveTo(-l*.36,-w*.3,-l*.27,-w*.38);ctx.closePath();ctx.fill();
 ctx.strokeStyle='#9ab4bd55';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(l*.19,-w*.37);ctx.quadraticCurveTo(l*.23,0,l*.19,w*.37);ctx.moveTo(-l*.23,-w*.37);ctx.quadraticCurveTo(-l*.27,0,-l*.23,w*.37);ctx.stroke();
 ctx.strokeStyle='#e0f8ff55';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-l*.12,-w*.24);ctx.lineTo(l*.07,-w*.24);ctx.stroke();
 ctx.strokeStyle=frontLight?'#e8fbff':'#c9dce0';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(l*.475,-w*.31);ctx.quadraticCurveTo(l*.49,0,l*.475,w*.31);ctx.stroke();
 ctx.strokeStyle='#f0564d';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-l*.48,-w*.30);ctx.lineTo(-l*.48,w*.30);ctx.stroke();
 ctx.restore();
}
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#4a5352';ctx.fillRect(0,0,canvas.width,canvas.height);
 // Concrete slabs, parking bay boundaries and travel lane markings.
 ctx.strokeStyle='#7d878033';ctx.lineWidth=1;for(let x=0;x<W;x+=4){ctx.beginPath();ctx.moveTo(x*scale,0);ctx.lineTo(x*scale,H*scale);ctx.stroke();}for(let y=0;y<H;y+=4){ctx.beginPath();ctx.moveTo(0,y*scale);ctx.lineTo(W*scale,y*scale);ctx.stroke();}
 ctx.fillStyle='#6b777024';for(let i=0;i<42;i++){let x=(i*137%1090),y=(i*197%690);ctx.fillRect(x,y,13+(i%5)*4,1);}
 ctx.fillStyle='#71796c33';ctx.fillRect(0,5.7*scale,W*scale,7.7*scale);
 ctx.strokeStyle='#d8d6bd88';ctx.lineWidth=3;ctx.setLineDash([35,27]);ctx.beginPath();ctx.moveTo(.5*scale,11.7*scale);ctx.lineTo(21.5*scale,11.7*scale);ctx.stroke();ctx.setLineDash([]);
 ctx.fillStyle='#d8d6bd88';ctx.beginPath();ctx.moveTo(18*scale,10.55*scale);ctx.lineTo(19.3*scale,10.55*scale);ctx.lineTo(19.3*scale,10.3*scale);ctx.lineTo(20*scale,10.8*scale);ctx.lineTo(19.3*scale,11.3*scale);ctx.lineTo(19.3*scale,11.05*scale);ctx.lineTo(18*scale,11.05*scale);ctx.closePath();ctx.fill();
 let slot=scene.slot;ctx.strokeStyle='#e9e9d7bb';ctx.lineWidth=4;ctx.strokeRect(slot.x*scale,slot.y*scale,slot.w*scale,slot.h*scale);
 let t=scene.target;ctx.fillStyle='#35bba626';ctx.fillRect(t.x*scale,t.y*scale,t.w*scale,t.h*scale);ctx.save();ctx.strokeStyle='#70e5ce';ctx.lineWidth=3;ctx.setLineDash([10,7]);ctx.strokeRect(t.x*scale,t.y*scale,t.w*scale,t.h*scale);ctx.restore();ctx.fillStyle='#d6fff5';ctx.font='bold 16px sans-serif';ctx.fillText('目标区域',t.x*scale+8,t.y*scale+20);
 scene.obstacles.forEach((o,i)=>{if(o.type==='car'){ctx.save();ctx.translate((o.x+o.w/2)*scale,(o.y+o.h/2)*scale);ctx.rotate(o.h>o.w?Math.PI/2:0);carArt(Math.max(o.w,o.h),Math.min(o.w,o.h),i%2?'#a4afb1':'#75898d',false);ctx.restore();}else if(o.type==='pillar'){ctx.fillStyle='#d9bd64';ctx.fillRect(o.x*scale,o.y*scale,o.w*scale,o.h*scale);ctx.fillStyle='#273332';ctx.fillRect(o.x*scale,(o.y+.15)*scale,o.w*scale,.16*scale);ctx.fillRect(o.x*scale,(o.y+.47)*scale,o.w*scale,.16*scale);}else{ctx.fillStyle='#263333';ctx.fillRect(o.x*scale,o.y*scale,o.w*scale,o.h*scale);}});
 if($('trail').checked&&history.length>1){ctx.beginPath();history.forEach((p,i)=>i?ctx.lineTo(p.x*scale,p.y*scale):ctx.moveTo(p.x*scale,p.y*scale));ctx.strokeStyle='#a4dbff88';ctx.lineWidth=3;ctx.stroke();}
 if($('trajectory').checked){let direction=state.v<-.02||(!state.v&&(keys.reverse||(!keys.forward&&lastDirection<0)))?-1:1;for(const side of [-1,1]){let p={...state},edge=direction>0?car.length-car.rear:-car.rear;ctx.beginPath();for(let i=0;i<=50;i++){let c=Math.cos(p.angle),s=Math.sin(p.angle),x=p.x+edge*c-side*car.width/2*s,y=p.y+edge*s+side*car.width/2*c;if(i===0)ctx.moveTo(x*scale,y*scale);else ctx.lineTo(x*scale,y*scale);p=move(p,direction*.1);}ctx.strokeStyle=side<0?'#89f1df':'#c1f8ed';ctx.lineWidth=3;ctx.setLineDash([9,6]);ctx.stroke();ctx.setLineDash([]);}}
 ctx.save();ctx.translate(state.x*scale,state.y*scale);ctx.rotate(state.angle);ctx.translate((car.length/2-car.rear)*scale,0);carArt(car.length,car.width,'#d5dedc');ctx.restore();
}

function togglePause(){if(!$('overlay').hidden)return;paused=!paused;clearKeys();$('pause').textContent=paused?'继续':'暂停';if(paused){$('overlay').innerHTML='<div><h2>已暂停</h2><p>准备好后继续练习</p><button id="resume">继续练习</button></div>';$('overlay').hidden=false;$('resume').onclick=()=>{$('overlay').hidden=true;paused=false;$('pause').textContent='暂停';};}}
const map={w:'forward',arrowup:'forward',s:'reverse',arrowdown:'reverse',a:'left',arrowleft:'left',d:'right',arrowright:'right',' ':'brake'};
function syncKeys(){for(const action of Object.keys(keys))keys[action]=touchKeys.has(action)||[...pressedKeys].some(k=>map[k]===action);}
window.addEventListener('keydown',e=>{if(e.target.matches('select, button, input')||$('help').open)return;let k=e.key.toLowerCase();if(map[k]){e.preventDefault();pressedKeys.add(k);syncKeys();}else if(k==='escape'){e.preventDefault();togglePause();}else if(k==='r'&&!e.repeat){if(confirm('重新开始会清除本次练习进度，继续吗？'))reset();}});
window.addEventListener('keyup',e=>{let k=map[e.key.toLowerCase()];if(k){e.preventDefault();pressedKeys.delete(e.key.toLowerCase());syncKeys();}});
window.addEventListener('blur',()=>{clearKeys();if(state)state.v=0;});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();state.v=0;last=0;}});
for(let b of document.querySelectorAll('[data-key]')){let key=b.dataset.key;b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touchKeys.add(key);syncKeys();b.classList.add('active');});for(let evt of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(evt,()=>{touchKeys.delete(key);syncKeys();b.classList.remove('active');});}
$('scene').onchange=e=>{reset();e.target.blur();canvas.focus();};$('difficulty').onchange=e=>{reset();e.target.blur();canvas.focus();};$('pause').onclick=togglePause;$('reset').onclick=()=>{if(confirm('重新开始会清除本次练习进度，继续吗？'))reset();};$('helpBtn').onclick=()=>{clearKeys();state.v=0;$('help').showModal();};
function frame(ts){if(last)update(Math.min((ts-last)/1000,.05));last=ts;draw();requestAnimationFrame(frame);}reset();requestAnimationFrame(frame);
})();
