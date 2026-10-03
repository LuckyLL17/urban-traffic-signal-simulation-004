import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

type Phase={id:string;green:number;yellow:number;red:number}; type Intersection={id:string;name:string;phases:Phase[];cycle:number;queues:Record<string,number>;capacity:number;offset?:number};
const app=Fastify({logger:true}); const now=()=>new Date().toISOString();
const intersections:Intersection[]=[
{id:'J-01',name:'人民路/中山路',phases:[{id:'NS',green:38,yellow:3,red:39},{id:'EW',green:32,yellow:3,red:45}],cycle:80,queues:{N:12,S:8,E:15,W:11},capacity:42},
{id:'J-02',name:'中山路/解放路',phases:[{id:'NS',green:30,yellow:3,red:37},{id:'EW',green:30,yellow:3,red:37}],cycle:70,queues:{N:9,S:12,E:18,W:10},capacity:36},
{id:'J-03',name:'解放路/滨江路',phases:[{id:'NS',green:28,yellow:3,red:35},{id:'EW',green:28,yellow:3,red:35}],cycle:66,queues:{N:7,S:5,E:13,W:9},capacity:34}
];
const detectors:any[]=[];const incidents:any[]=[];const plans:any[]=[];const runs:any[]=[];const audit:any[]=[];
const log=(action:string,payload:any)=>audit.push({id:randomUUID(),time:now(),action,payload});
function simulate(input:any){
 let totalDelay=0,maxQueue=0,spillbacks=0; const snapshots:any[]=[]; const horizon=Number(input.horizon||900); const demand=input.demand||{};
 const queues:Record<string,Record<string,number>>=Object.fromEntries(intersections.map(j=>[j.id,{...j.queues}]));
 for(let tick=0;tick<horizon;tick+=5){
  for(const j of intersections){
   const d=Number(demand[j.id]??(j.capacity*.72)); const greenRatio=j.phases[0].green/j.cycle; const served=d*greenRatio*.18; const blocked=incidents.some(x=>x.status==='active'&&x.intersectionId===j.id)?.55:1;
   for(const lane of Object.keys(queues[j.id])){const arrival=d*.04*(lane==='E'||lane==='W'?1.05:.95); queues[j.id][lane]=Math.max(0,queues[j.id][lane]+arrival-served*blocked/4); if(queues[j.id][lane]>j.capacity){spillbacks++;queues[j.id][lane]=j.capacity*1.15;}}
   totalDelay+=Object.values(queues[j.id]).reduce((a,b)=>a+b,0)*5; maxQueue=Math.max(maxQueue,...Object.values(queues[j.id]));
  }
  if(tick%60===0)snapshots.push({second:tick,queues:intersections.map(j=>({id:j.id,...queues[j.id]}))});
 }
 return{horizon,totalDelay:Number(totalDelay.toFixed(1)),maxQueue:Number(maxQueue.toFixed(1)),spillbacks,averageSpeed:Number(Math.max(8,42-totalDelay/(horizon*10)).toFixed(2)),snapshots};
}
app.get('/health',async()=>({ok:true,service:'urban-traffic-signal-simulation',time:now()}));
app.get('/api/network/state',async()=>({at:now(),intersections,incidents,detectors,metrics:{averageSpeed:31.4,totalQueue:intersections.reduce((s,j)=>s+Object.values(j.queues).reduce((a,b)=>a+Number(b),0),0)}}));
app.post('/api/detectors/events',async(req:any,res)=>{const b=req.body as any;if(!b.detectorId||b.flow==null)return res.code(400).send({error:'detectorId 和 flow 必填'});const e={id:randomUUID(),time:b.time||now(),detectorId:b.detectorId,flow:Number(b.flow),occupancy:Number(b.occupancy||0),speed:Number(b.speed||0)};detectors.push(e);return e;});
app.post('/api/incidents',async(req:any,res)=>{const b=req.body as any;if(!b.intersectionId||!b.type)return res.code(400).send({error:'intersectionId 和 type 必填'});const i={id:randomUUID(),intersectionId:b.intersectionId,type:b.type,lane:b.lane||'unknown',severity:b.severity||'medium',status:'active',startedAt:now(),estimatedClearMinutes:Number(b.estimatedClearMinutes||20)};incidents.push(i);log('incident.open',i);return i;});
app.post('/api/incidents/:id/clear',async(req:any,res)=>{const i=incidents.find(x=>x.id===(req.params as any).id);if(!i)return res.code(404).send({error:'incident not found'});i.status='cleared';i.clearedAt=now();return i;});
app.post('/api/plans',async(req:any,res)=>{const b=req.body as any;if(!b.name||!b.changes)return res.code(400).send({error:'name 和 changes 必填'});const p={id:randomUUID(),name:b.name,basePlan:intersections.map(j=>({id:j.id,cycle:j.cycle,phases:j.phases})),changes:b.changes,priority:b.priority||'normal',status:'draft',createdAt:now()};plans.push(p);return p;});
app.post('/api/plans/:id/validate',async(req:any,res)=>{const p=plans.find(x=>x.id===(req.params as any).id);if(!p)return res.code(404).send({error:'plan not found'});const errors:string[]=[];for(const [id,change] of Object.entries(p.changes as Record<string,any>)){const j=intersections.find(x=>x.id===id);if(!j)errors.push(`${id}: intersection not found`);else{const cycle=Number((change as any).cycle??j.cycle);const phases=(change as any).phases||j.phases;if(cycle<30||cycle>180)errors.push(`${id}: cycle out of [30,180]`);if(phases.reduce((s:any,x:any)=>s+Number(x.green||0)+Number(x.yellow||0),0)>cycle)errors.push(`${id}: phase budget exceeded`);}}p.validation={valid:errors.length===0,errors};return p;});
app.post('/api/plans/:id/apply',async(req:any,res)=>{const p=plans.find(x=>x.id===(req.params as any).id);if(!p)return res.code(404).send({error:'plan not found'});if(!p.validation?.valid)return res.code(409).send({error:'plan must pass validation',validation:p.validation});for(const [id,change] of Object.entries(p.changes as Record<string,any>)){const j=intersections.find(x=>x.id===id);if(j){j.cycle=Number((change as any).cycle??j.cycle);if((change as any).phases)j.phases=(change as any).phases;}}p.status='applied';p.appliedAt=now();log('plan.apply',p);return p;});
app.post('/api/simulations',async(req:any,res)=>{const b=req.body as any;const plan=b.planId?plans.find(x=>x.id===b.planId):null;if(b.planId&&!plan)return res.code(404).send({error:'plan not found'});const baseline=simulate({horizon:b.horizon,demand:b.demand});let candidate=null;if(plan){const saved=intersections.map(j=>({j,cycle:j.cycle,phases:j.phases}));for(const [id,c] of Object.entries(plan.changes as Record<string,any>)){const j=intersections.find(x=>x.id===id);if(j){j.cycle=Number((c as any).cycle??j.cycle);if((c as any).phases)j.phases=(c as any).phases}}candidate=simulate({horizon:b.horizon,demand:b.demand});saved.forEach(x=>{x.j.cycle=x.cycle;x.j.phases=x.phases});}const r={id:randomUUID(),createdAt:now(),planId:b.planId||null,baseline,candidate,delta:candidate?{delay:Number((candidate.totalDelay-baseline.totalDelay).toFixed(1)),maxQueue:Number((candidate.maxQueue-baseline.maxQueue).toFixed(1)),speed:Number((candidate.averageSpeed-baseline.averageSpeed).toFixed(2))}:null};runs.push(r);return r;});
app.post('/api/optimization',async(req:any)=>{
 const b=req.body as any;
 const options=[{cycleBias:-8,greenShift:4},{cycleBias:0,greenShift:0},{cycleBias:10,greenShift:-3}].map((o,i)=>{
  const changes:any={};
  for(const j of intersections) changes[j.id]={cycle:Math.max(30,Math.min(180,j.cycle+o.cycleBias)),phases:j.phases.map((phase,k)=>({...phase,green:Math.max(10,phase.green+(k===0?o.greenShift:-o.greenShift))}))};
  return {id:randomUUID(),label:`候选方案 ${i+1}`,changes,result:simulate({horizon:b.horizon||600,demand:b.demand})};
 });
 options.sort((a,b)=>a.result.totalDelay-b.result.totalDelay);
 return {objective:b.objective||'minimize-delay',candidates:options,best:options[0]};
});
app.get('/api/simulations/:id',async(req:any,res)=>{const r=runs.find(x=>x.id===(req.params as any).id);if(!r)return res.code(404).send({error:'simulation not found'});return r;});
app.get('/api/audit',async()=>audit.slice(-100));

// Advanced operations: corridor coordination, transit priority, pedestrian safety and emissions.
type CoordinationDirection='forward'|'reverse';
type CoordinationStatus='calculated'|'previewed'|'rejected'|'published'|'superseded';
type Corridor={id:string;name:string;intersectionIds:string[];lengthMeters:number;targetSpeedKph:number};
type NetworkFingerprint={cycles:Record<string,number>;offsets:Record<string,number|null>};
type CoordinationSegment={fromId:string;toId:string;distanceMeters:number;travelSeconds:number};
type CoordinationProposal={ordinal:number;intersectionId:string;cumulativeDistanceMeters:number;cumulativeTravelSeconds:number;offsetSeconds:number;wrapCount:number};
type CoordinationPlan={id:string;corridorId:string;version:number;status:CoordinationStatus;speedKph:number;direction:CoordinationDirection;referenceCycleSeconds:number;canonicalIntersectionIds:string[];orderedIntersectionIds:string[];distancesMeters:number[];segments:CoordinationSegment[];proposals:CoordinationProposal[];offsets:Record<string,number>;baseFingerprint:NetworkFingerprint;createdAt:string;updatedAt:string;preview?:{at:string;referenceCycleSeconds:number;currentOffsets:Record<string,number|null>;proposedOffsets:Record<string,number>;changes:{intersectionId:string;fromOffset:number|null;toOffset:number;changed:boolean;wrapCount:number}[];totalWrapCount:number};rejectedAt?:string;rejectReason?:string;publishedAt?:string;supersededAt?:string;supersededVersionIds?:string[]};
const priorityRequests:any[]=[]; const corridors:Corridor[]=[{id:'C-01',name:'中山路绿波走廊',intersectionIds:['J-01','J-02','J-03'],lengthMeters:2400,targetSpeedKph:36}]; const scenarioPolicies:any[]=[]; const coordinationPlans:CoordinationPlan[]=[];
const finiteNumber=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const corridorJunctions=(corridor:Corridor)=>{
 const errors:string[]=[]; const ids=Array.isArray(corridor.intersectionIds)?corridor.intersectionIds.slice():[];
 if(ids.length===0)errors.push('corridor has no intersections');
 const seen=new Set<string>();
 for(const id of ids){if(typeof id!=='string'||!id)errors.push('corridor contains an invalid intersection id');if(seen.has(id))errors.push(`${id}: duplicated corridor order`);seen.add(id);}
 const junctions=ids.map(id=>intersections.find(x=>x.id===id));
 junctions.forEach((j,i)=>{if(!j)errors.push(`${ids[i]}: intersection not found`);else if(!Number.isInteger(j.cycle)||j.cycle<=0)errors.push(`${j.id}: invalid cycle`);});
 return {ids,junctions:junctions.filter((j):j is Intersection=>Boolean(j)),errors};
};
const networkFingerprint=(junctions:Intersection[]):NetworkFingerprint=>({cycles:Object.fromEntries(junctions.map(j=>[j.id,j.cycle])),offsets:Object.fromEntries(junctions.map(j=>[j.id,j.offset??null]))});
const sameFingerprint=(a:NetworkFingerprint,b:NetworkFingerprint)=>JSON.stringify(a)===JSON.stringify(b);
function normalizeSegmentDistances(body:any,ids:string[],corridor:Corridor){
 const errors:string[]=[]; const count=Math.max(0,ids.length-1); let distances:number[]=[];
 const links=body.links; const rawDistances=body.distancesMeters??body.distances;
 if(rawDistances!==undefined&&links!==undefined)errors.push('distancesMeters 和 links 只能提供一种');
 if(rawDistances!==undefined){
  if(!Array.isArray(rawDistances)||rawDistances.length!==count)errors.push(`distancesMeters 必须是长度 ${count} 的相邻路段数组`);
  else distances=rawDistances.map((v:unknown,i:number)=>{if(!finiteNumber(v)||v<=0||v>100000){errors.push(`distancesMeters[${i}]: 必须是 0-100000 米之间的正数`);return 0;}return v;});
 }else if(links!==undefined){
  if(!Array.isArray(links)||links.length!==count)errors.push(`links 必须包含 ${count} 条相邻路段`);
  else{distances=new Array(count).fill(0);const used=new Array(count).fill(false);
   links.forEach((link:any,i:number)=>{
    if(!link||typeof link.fromId!=='string'||typeof link.toId!=='string'){errors.push(`links[${i}]: fromId 和 toId 必填`);return;}
    const distance=link.distanceMeters??link.lengthMeters;if(!finiteNumber(distance)||distance<=0||distance>100000){errors.push(`links[${i}]: distanceMeters 必须是 0-100000 米之间的正数`);return;}
    const a=ids.indexOf(link.fromId),b=ids.indexOf(link.toId);let index=-1;
    if(a>=0&&b===a+1)index=a;else if(b>=0&&a===b+1)index=b;
    if(index<0){errors.push(`links[${i}]: ${link.fromId} -> ${link.toId} 必须是走廊顺序中的相邻路口`);return;}
    if(used[index])errors.push(`links[${i}]: 相邻路段重复`);used[index]=true;distances[index]=distance;
   });
  }
 }else if(ids.length>1){
  if(!finiteNumber(corridor.lengthMeters)||corridor.lengthMeters<=0||corridor.lengthMeters>100000)errors.push('走廊 lengthMeters 非法；请在 distancesMeters 或 links 中提供相邻路段实际距离');
  else distances=new Array(count).fill(corridor.lengthMeters/count);
 }
 return {errors,distances};
}
function buildCoordinationPlan(corridor:Corridor,body:any){
 const {ids,junctions,errors:configErrors}=corridorJunctions(corridor);
 const errors:string[]=[]; const speed=body?.speedKph??corridor.targetSpeedKph;
 if(!finiteNumber(speed)||speed<10||speed>70)errors.push('speedKph must be 10-70');
 const direction=body?.direction??body?.travelDirection??'forward';
 if(direction!=='forward'&&direction!=='reverse')errors.push("direction 必须是 'forward' 或 'reverse'");
 const distanceResult=normalizeSegmentDistances(body??{},ids,corridor);
 errors.push(...distanceResult.errors);
 if(configErrors.length||errors.length)return {configErrors:[...configErrors,...(configErrors.length?errors:[])],errors:configErrors.length?[]:errors};
 const referenceCycleSeconds=Math.max(...junctions.map(j=>j.cycle));
 const orderedIntersectionIds=direction==='reverse'?ids.slice().reverse():ids.slice();
 const segments:CoordinationSegment[]=[];const proposals:CoordinationProposal[]=[];const offsets:Record<string,number>={};
 let cumulativeDistance=0;let cumulativeSeconds=0;
 orderedIntersectionIds.forEach((id,ordinal)=>{
  if(ordinal>0){
   const fromId=orderedIntersectionIds[ordinal-1];const toId=id;
   const canonicalIndex=Math.min(ids.indexOf(fromId),ids.indexOf(toId));
   const distanceMeters=distanceResult.distances[canonicalIndex];const travelSeconds=distanceMeters/(speed/3.6);
   cumulativeDistance+=distanceMeters;cumulativeSeconds+=travelSeconds;segments.push({fromId,toId,distanceMeters,travelSeconds:Number(travelSeconds.toFixed(3))});
  }
  const roundedSeconds=Math.round(cumulativeSeconds);const wrapCount=Math.floor(roundedSeconds/referenceCycleSeconds);
  const offsetSeconds=((roundedSeconds%referenceCycleSeconds)+referenceCycleSeconds)%referenceCycleSeconds;
  offsets[id]=offsetSeconds;proposals.push({ordinal,intersectionId:id,cumulativeDistanceMeters:Number(cumulativeDistance.toFixed(3)),cumulativeTravelSeconds:Number(cumulativeSeconds.toFixed(3)),offsetSeconds,wrapCount});
 });
 const version=coordinationPlans.reduce((max,p)=>p.corridorId===corridor.id?Math.max(max,p.version):max,0)+1;
 const time=now();
 const plan:CoordinationPlan={id:randomUUID(),corridorId:corridor.id,version,status:'calculated',speedKph:speed,direction,referenceCycleSeconds,canonicalIntersectionIds:ids,orderedIntersectionIds,distancesMeters:distanceResult.distances,segments,proposals,offsets,baseFingerprint:networkFingerprint(junctions),createdAt:time,updatedAt:time};
 return {plan};
}
function previewCoordinationPlan(plan:CoordinationPlan,corridor:Corridor){
 if(plan.status!=='calculated'&&plan.status!=='previewed')return {error:`plan in status ${plan.status} cannot be previewed`,statusCode:409};
 const {ids,junctions,errors}=corridorJunctions(corridor);
 if(errors.length)return {error:errors.join('; '),statusCode:409};
 const current=networkFingerprint(junctions);
 if(!sameFingerprint(plan.baseFingerprint,current))return {error:'network changed after calculation; calculate a new version',statusCode:409};
 const currentCycle=Math.max(...junctions.map(j=>j.cycle));
 if(currentCycle!==plan.referenceCycleSeconds)return {error:'reference cycle changed; calculate a new version',statusCode:409};
 const changes=plan.proposals.map(p=>({intersectionId:p.intersectionId,fromOffset:current.offsets[p.intersectionId],toOffset:p.offsetSeconds,changed:current.offsets[p.intersectionId]!==p.offsetSeconds,wrapCount:p.wrapCount}));
 plan.preview={at:now(),referenceCycleSeconds:currentCycle,currentOffsets:current.offsets,proposedOffsets:{...plan.offsets},changes,totalWrapCount:plan.proposals[plan.proposals.length-1]?.wrapCount??0};
 plan.status='previewed';plan.updatedAt=now();
 return {plan,preview:plan.preview};
}
function publishCoordinationPlan(plan:CoordinationPlan,corridor:Corridor){
 if(plan.status==='published')return {plan,alreadyPublished:true};
 if(plan.status!=='previewed')return {error:`plan in status ${plan.status} must be previewed before publish`,statusCode:409};
 const {junctions,errors}=corridorJunctions(corridor);
 if(errors.length)return {error:errors.join('; '),statusCode:409};
 const current=networkFingerprint(junctions);
 if(!sameFingerprint(plan.baseFingerprint,current))return {error:'network changed after preview; calculate and preview a new version',statusCode:409};
 if(Math.max(...junctions.map(j=>j.cycle))!==plan.referenceCycleSeconds)return {error:'reference cycle changed after preview; calculate a new version',statusCode:409};
 for(const proposal of plan.proposals){const j=junctions.find(x=>x.id===proposal.intersectionId)!;if(!Number.isInteger(proposal.offsetSeconds)||proposal.offsetSeconds<0||proposal.offsetSeconds>=plan.referenceCycleSeconds)return {error:`${j.id}: illegal offset`,statusCode:422};}
 const previousPublished=coordinationPlans.filter(p=>p.corridorId===corridor.id&&p.status==='published');
 for(const proposal of plan.proposals)junctions.find(j=>j.id===proposal.intersectionId)!.offset=proposal.offsetSeconds;
 const time=now();
 for(const previous of previousPublished){previous.status='superseded';previous.supersededAt=time;previous.updatedAt=time;}
 plan.status='published';plan.publishedAt=time;plan.updatedAt=time;plan.supersededVersionIds=previousPublished.map(p=>p.id);
 return {plan};
}
app.get('/api/corridors',async()=>corridors);
app.get('/api/corridors/:id/coordination-plans',async(req:any,res)=>{const c=corridors.find(x=>x.id===(req.params as any).id);if(!c)return res.code(404).send({error:'corridor not found'});return coordinationPlans.filter(p=>p.corridorId===c.id).sort((a,b)=>b.version-a.version);});
app.get('/api/corridors/:id/coordination-plans/:planId',async(req:any,res)=>{const c=corridors.find(x=>x.id===(req.params as any).id);if(!c)return res.code(404).send({error:'corridor not found'});const p=coordinationPlans.find(x=>x.corridorId===c.id&&x.id===(req.params as any).planId);if(!p)return res.code(404).send({error:'coordination plan not found'});return p;});
app.post('/api/corridors/:id/coordinate',async(req:any,res)=>{
 const c=corridors.find(x=>x.id===(req.params as any).id);if(!c)return res.code(404).send({error:'corridor not found'});
 const b=req.body as any;const action=b?.action??b?.phase??'calculate';
 if(action==='calculate'||action==='recalculate'){
  const built=buildCoordinationPlan(c,b);
  if(built.configErrors?.length)return res.code(409).send({error:built.configErrors.join('; ')});
  if(built.errors?.length)return res.code(400).send({error:built.errors.join('; ')});
  coordinationPlans.push(built.plan!);log('corridor.coordination.calculate',structuredClone(built.plan!));return res.code(201).send(built.plan);
 }
 const planId=b?.planId??b?.id;const plan=coordinationPlans.find(x=>x.corridorId===c.id&&x.id===planId);
 if(!plan)return res.code(404).send({error:'coordination plan not found'});
 if(action==='preview'){const result=previewCoordinationPlan(plan,c);if('error'in result)return res.code(result.statusCode!).send({error:result.error});log('corridor.coordination.preview',structuredClone({plan:result.plan,preview:result.preview}));return {plan:result.plan,preview:result.preview};}
 if(action==='reject'){
  if(plan.status!=='calculated'&&plan.status!=='previewed')return res.code(409).send({error:`plan in status ${plan.status} cannot be rejected`});
  plan.status='rejected';plan.rejectReason=typeof b.reason==='string'?b.reason:undefined;plan.rejectedAt=now();plan.updatedAt=plan.rejectedAt;
  log('corridor.coordination.reject',structuredClone(plan));return plan;
 }
 if(action==='publish'){const result=publishCoordinationPlan(plan,c);if('error'in result)return res.code(result.statusCode!).send({error:result.error});log('corridor.coordination.publish',structuredClone({plan:result.plan,alreadyPublished:Boolean(result.alreadyPublished)}));return result.alreadyPublished?{...result.plan,alreadyPublished:true}:result.plan;}
 return res.code(400).send({error:"action 必须是 calculate、preview、reject 或 publish"});
});
app.post('/api/priority-requests',async(req:any,res)=>{const b=req.body as any;if(!b.intersectionId||!b.routeId||b.etaSeconds==null)return res.code(400).send({error:'intersectionId、routeId、etaSeconds 必填'});const j=intersections.find(x=>x.id===b.intersectionId);if(!j)return res.code(404).send({error:'intersection not found'});const r:any={id:randomUUID(),intersectionId:b.intersectionId,routeId:b.routeId,etaSeconds:Number(b.etaSeconds),passengers:Number(b.passengers||0),requestType:b.requestType||'transit',status:'requested',requestedAt:now()};r.approved=r.passengers>=20||r.requestType==='emergency';r.status=r.approved?'approved':'deferred';priorityRequests.push(r);log('priority.request',r);return r;});
app.post('/api/pedestrian-phase',async(req:any,res)=>{const b=req.body as any;if(!b.intersectionId||b.crossingSeconds==null)return res.code(400).send({error:'intersectionId 和 crossingSeconds 必填'});const crossing=Number(b.crossingSeconds);if(crossing<7||crossing>60)return res.code(400).send({error:'crossingSeconds must be 7-60'});const j=intersections.find(x=>x.id===b.intersectionId);if(!j)return res.code(404).send({error:'intersection not found'});const p={id:randomUUID(),intersectionId:j.id,crossingSeconds:crossing,leadingInterval:Number(b.leadingInterval||3),accessible:Boolean(b.accessible),status:'validated',createdAt:now()};scenarioPolicies.push(p);return p;});
app.post('/api/simulations/:id/emissions',async(req:any,res)=>{const r=runs.find(x=>x.id===(req.params as any).id);if(!r)return res.code(404).send({error:'simulation not found'});const vkt=Number((req.body as any)?.vehicleKm||12000);const stopPenalty=(r.candidate?.totalDelay??r.baseline.totalDelay)/Math.max(1,r.baseline.horizon);return{simulationId:r.id,vehicleKm:vkt,co2Kg:Number((vkt*(.142+stopPenalty*.0008)).toFixed(2)),noxGrams:Number((vkt*(.32+stopPenalty*.0015)).toFixed(2)),idleHours:Number((stopPenalty*vkt/3600).toFixed(2)),method:'speed-delay surrogate model'};});
app.post('/api/evacuation-scenarios',async(req:any)=>{const b=req.body as any;const blocked=(b.blockedIntersections||[]) as string[];const original=incidents.length;for(const id of blocked)incidents.push({id:randomUUID(),intersectionId:id,type:'evacuation-block',severity:'high',status:'active',startedAt:now()});const result=simulate({horizon:b.horizon||1800,demand:b.demand});incidents.splice(original);return{id:randomUUID(),type:'evacuation',blockedIntersections:blocked,result,recommendation:result.spillbacks>3?'open reversible lanes and meter upstream inflow':'maintain coordinated offsets'};});
app.get('/api/priority-requests',async()=>priorityRequests);

export { app };

if (process.env.NODE_ENV !== 'test') {
 app.listen({port:Number(process.env.PORT||6302),host:'127.0.0.1'}).catch(err=>{app.log.error(err);process.exit(1)});
}
