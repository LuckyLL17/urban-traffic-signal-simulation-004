import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

type Phase={id:string;green:number;yellow:number;red:number};
type Intersection={id:string;name:string;phases:Phase[];cycle:number;queues:Record<string,number>;capacity:number;offset?:number};
type TravelDirection='FORWARD'|'REVERSE';
type CoordinationStatus='calculated'|'rejected'|'published'|'superseded';
type CorridorLink={fromIntersectionId:string;toIntersectionId:string;distanceMeters:number;directionDegrees:number};
type Corridor={id:string;name:string;intersectionIds:string[];lengthMeters:number;targetSpeedKph:number;links?:CorridorLink[]};
type CorridorSegmentInput={fromIntersectionId?:string;toIntersectionId?:string;distanceMeters?:number;directionDegrees?:number};
type CorridorSegment={order:number;fromIntersectionId:string;toIntersectionId:string;distanceMeters:number;directionDegrees:number};
type CorridorStopProposal={intersectionId:string;order:number;segmentFromPreviousMeters:number|null;directionFromPreviousDegrees:number|null;cumulativeMeters:number;travelSeconds:number;cycleSeconds:number;wrapCount:number;rawOffsetSeconds:number;offsetSeconds:number};
type nowString=string;
type CorridorCoordinationVersion={id:string;corridorId:string;versionNumber:number;status:CoordinationStatus;speedKph:number;travelDirection:TravelDirection;request:{speedKph:number;travelDirection:TravelDirection;segments:CorridorSegmentInput[]|null};segments:CorridorSegment[];stops:CorridorStopProposal[];proposedOffsets:Record<string,number>;baselineOffsets:Record<string,number|null>;maxCycleSeconds:number;createdAt:nowString;rejectedAt?:nowString;rejectReason?:string;publishedAt?:nowString;supersededAt?:nowString;sourceVersionId?:string};
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
const priorityRequests:any[]=[]; const corridors:(Corridor&{coordinationVersions:CorridorCoordinationVersion[]})[]=[{id:'C-01',name:'中山路绿波走廊',intersectionIds:['J-01','J-02','J-03'],lengthMeters:2400,targetSpeedKph:36,links:[{fromIntersectionId:'J-01',toIntersectionId:'J-02',distanceMeters:900,directionDegrees:90},{fromIntersectionId:'J-02',toIntersectionId:'J-03',distanceMeters:1500,directionDegrees:90}],coordinationVersions:[]}]; const scenarioPolicies:any[]=[];
app.get('/api/corridors',async()=>corridors);

class DomainValidationError extends Error{constructor(public details:string[]){super(details.join('; '));this.name='DomainValidationError';}}
type StoredCorridor=Corridor&{coordinationVersions:CorridorCoordinationVersion[]};
const findCorridor=(id:string)=>corridors.find(x=>x.id===id);
const findVersion=(c:StoredCorridor,versionId:string)=>c.coordinationVersions.find(v=>v.id===versionId||String(v.versionNumber)===versionId);
function parseTravelDirection(value:unknown):TravelDirection{
 const direction=String(value??'FORWARD').toUpperCase();
 if(direction!=='FORWARD'&&direction!=='REVERSE')throw new DomainValidationError([`travelDirection must be FORWARD or REVERSE, received ${String(value)}`]);
 return direction;
}
function canonicalSegments(c:Corridor):Required<CorridorSegment>[]{
 const links=c.links?.length===c.intersectionIds.length-1?c.links:c.intersectionIds.slice(1).map((toIntersectionId,index)=>({fromIntersectionId:c.intersectionIds[index],toIntersectionId,distanceMeters:c.lengthMeters/(c.intersectionIds.length-1),directionDegrees:0}));
 return links.map((link,index)=>({order:index,fromIntersectionId:link.fromIntersectionId,toIntersectionId:link.toIntersectionId,distanceMeters:link.distanceMeters,directionDegrees:link.directionDegrees}));
}
function resolveSegments(c:Corridor,travelDirection:TravelDirection,rawSegments:unknown):CorridorSegment[]{
 const canonical=canonicalSegments(c);
 const expected=travelDirection==='REVERSE'?canonical.map(link=>({...link,fromIntersectionId:link.toIntersectionId,toIntersectionId:link.fromIntersectionId,directionDegrees:(link.directionDegrees+180)%360})).reverse():canonical;
 if(rawSegments==null)return expected;
 if(!Array.isArray(rawSegments))throw new DomainValidationError(['segments must be an array']);
 if(rawSegments.length!==expected.length)throw new DomainValidationError([`segments must contain ${expected.length} adjacent links for ${c.intersectionIds.length} intersections`]);
 const errors:string[]=[];
 const segments=rawSegments.map((raw:any,index)=>{
  const wanted=expected[index];
  const fromIntersectionId=raw?.fromIntersectionId??wanted.fromIntersectionId;
  const toIntersectionId=raw?.toIntersectionId??wanted.toIntersectionId;
  const distanceMeters=Number(raw?.distanceMeters??wanted.distanceMeters);
  const directionDegrees=Number(raw?.directionDegrees??wanted.directionDegrees);
  if(fromIntersectionId!==wanted.fromIntersectionId||toIntersectionId!==wanted.toIntersectionId)errors.push(`segments[${index}]: expected ${wanted.fromIntersectionId} -> ${wanted.toIntersectionId} for ${travelDirection} order`);
  if(!Number.isFinite(distanceMeters)||distanceMeters<=0||distanceMeters>100000)errors.push(`segments[${index}]: distanceMeters must be 0-100000`);
  if(!Number.isFinite(directionDegrees)||directionDegrees<0||directionDegrees>=360)errors.push(`segments[${index}]: directionDegrees must be 0-360 (exclusive 360)`);
  return {order:index,fromIntersectionId,toIntersectionId,distanceMeters,directionDegrees};
 });
 if(errors.length)throw new DomainValidationError(errors);
 return segments;
}
function buildCoordination(c:StoredCorridor,b:any,sourceVersionId?:string):Omit<CorridorCoordinationVersion,'id'|'versionNumber'|'createdAt'|'status'>{
 const errors:string[]=[];
 const speedKph=Number(b?.speedKph??c.targetSpeedKph);
 if(!Number.isFinite(speedKph)||speedKph<10||speedKph>70)errors.push('speedKph must be 10-70');
 let travelDirection:TravelDirection='FORWARD';
 try{travelDirection=parseTravelDirection(b?.travelDirection);}catch(e){errors.push(...(e as DomainValidationError).details);}
 let segments:CorridorSegment[]=[];
 try{segments=resolveSegments(c,travelDirection,b?.segments);}catch(e){errors.push(...(e as DomainValidationError).details);}
 const orderedIntersectionIds=travelDirection==='REVERSE'?[...c.intersectionIds].reverse():c.intersectionIds;
 const stopsData=orderedIntersectionIds.map((intersectionId,index)=>{
  const j=intersections.find(x=>x.id===intersectionId);
  if(!j){errors.push(`${intersectionId}: intersection not found`);return null;}
  if(!Number.isInteger(j.cycle)||j.cycle<30||j.cycle>180)errors.push(`${intersectionId}: current cycle must be an integer in 30-180 seconds`);
  if(j.offset!==undefined&&(!Number.isInteger(j.offset)||j.offset<0||j.offset>=j.cycle))errors.push(`${intersectionId}: current offset must be an integer in its cycle before coordination`);
  return {j,index};
 });
 if(errors.length)throw new DomainValidationError(errors);
 const baselineOffsets:Record<string,number|null>={};
 const proposedOffsets:Record<string,number>={};
 const stops:CorridorStopProposal[]=[];
 let cumulativeMeters=0;
 for(const item of stopsData){
  if(!item)continue;
  const {j,index}=item;
  const segment=index===0?null:segments[index-1];
  cumulativeMeters+=segment?.distanceMeters??0;
  const travelSeconds=Number((cumulativeMeters/(speedKph/3.6)).toFixed(3));
  const rawOffsetSeconds=Math.round(travelSeconds);
  const wrapCount=Math.floor(rawOffsetSeconds/j.cycle);
  const offsetSeconds=rawOffsetSeconds%j.cycle;
  baselineOffsets[j.id]=j.offset??null;
  proposedOffsets[j.id]=offsetSeconds;
  stops.push({intersectionId:j.id,order:index,segmentFromPreviousMeters:segment?.distanceMeters??null,directionFromPreviousDegrees:segment?.directionDegrees??null,cumulativeMeters:Number(cumulativeMeters.toFixed(3)),travelSeconds,cycleSeconds:j.cycle,wrapCount,rawOffsetSeconds,offsetSeconds});
 }
 return {corridorId:c.id,speedKph,travelDirection,request:{speedKph,travelDirection,segments:Array.isArray(b?.segments)?b.segments:null},segments,stops,proposedOffsets,baselineOffsets,maxCycleSeconds:Math.max(...stops.map(s=>s.cycleSeconds)),sourceVersionId};
}
function createVersion(c:StoredCorridor,b:any,sourceVersion?:CorridorCoordinationVersion){
 const draft=buildCoordination(c,b,sourceVersion?.id);
 const version:CorridorCoordinationVersion={...draft,id:randomUUID(),versionNumber:c.coordinationVersions.length+1,status:'calculated',createdAt:now(),sourceVersionId:sourceVersion?.id};
 c.coordinationVersions.push(version);
 log(sourceVersion?'corridor.coordination.recalculate':'corridor.coordination.calculate',{corridorId:c.id,versionId:version.id,versionNumber:version.versionNumber,speedKph:version.speedKph,travelDirection:version.travelDirection,sourceVersionId:version.sourceVersionId});
 return version;
}
function buildPreview(v:CorridorCoordinationVersion){
 return {version:v,network:{intersections:v.stops.map(stop=>{
  const j=intersections.find(x=>x.id===stop.intersectionId)!;
  const currentOffset=j.offset??null;
  const delta=currentOffset===null?stop.offsetSeconds:stop.offsetSeconds-currentOffset;
  return {intersectionId:stop.intersectionId,currentOffset,proposedOffset:stop.offsetSeconds,cycleSeconds:stop.cycleSeconds,offsetDeltaSeconds:delta,wouldChange:currentOffset!==stop.offsetSeconds};
 })}};
}
app.post('/api/corridors/:id/coordination/calculate',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 try{return createVersion(c,req.body as any);}catch(e){if(e instanceof DomainValidationError){log('corridor.coordination.invalid',{corridorId:c.id,details:e.details,body:req.body});return res.code(400).send({error:'validation failed',details:e.details});}throw e;}
});
app.get('/api/corridors/:id/coordination/versions',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 const status=String((req.query as any)?.status??'').toUpperCase();
 return c.coordinationVersions.filter(v=>!status||v.status===status);
});
app.get('/api/corridors/:id/coordination/version/:versionRef',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 const version=findVersion(c,(req.params as any).versionRef);
 if(!version)return res.code(404).send({error:'coordination version not found'});
 return version;
});
app.get('/api/corridors/:id/coordination/:versionId/preview',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 const version=findVersion(c,(req.params as any).versionId);
 if(!version)return res.code(404).send({error:'coordination version not found'});
 return buildPreview(version);
});
app.post('/api/corridors/:id/coordination/:versionId/reject',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 const version=findVersion(c,(req.params as any).versionId);
 if(!version)return res.code(404).send({error:'coordination version not found'});
 if(version.status!=='calculated')return res.code(409).send({error:'only calculated versions can be rejected',status:version.status});
 version.status='rejected';version.rejectedAt=now();version.rejectReason=String((req.body as any)?.reason??'rejected before publication');
 log('corridor.coordination.reject',{corridorId:c.id,versionId:version.id,versionNumber:version.versionNumber,reason:version.rejectReason});
 return version;
});
app.post('/api/corridors/:id/coordination/:versionId/recalculate',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 const source=findVersion(c,(req.params as any).versionId);
 if(!source)return res.code(404).send({error:'coordination version not found'});
 if(source.status!=='rejected')return res.code(409).send({error:'only rejected versions can be recalculated',status:source.status});
 const body=req.body as any;
 try{return createVersion(c,{speedKph:body?.speedKph??source.speedKph,travelDirection:body?.travelDirection??source.travelDirection,segments:body?.segments??source.request.segments??undefined},source);}catch(e){if(e instanceof DomainValidationError){log('corridor.coordination.recalculate-invalid',{corridorId:c.id,sourceVersionId:source.id,details:e.details});return res.code(400).send({error:'validation failed',details:e.details});}throw e;}
});
app.post('/api/corridors/:id/coordination/:versionId/publish',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 const version=findVersion(c,(req.params as any).versionId);
 if(!version)return res.code(404).send({error:'coordination version not found'});
 if(version.status!=='calculated')return res.code(409).send({error:'only calculated versions can be published',status:version.status});
 const errors:string[]=[];
 for(const stop of version.stops){
  const j=intersections.find(x=>x.id===stop.intersectionId);
  const baseline=version.baselineOffsets[stop.intersectionId];
  const current=j?.offset??null;
  if(!j)errors.push(`${stop.intersectionId}: intersection no longer exists`);
  else if(j.cycle!==stop.cycleSeconds)errors.push(`${stop.intersectionId}: cycle changed from ${stop.cycleSeconds} to ${j.cycle} after calculation`);
  else if(current!==baseline)errors.push(`${stop.intersectionId}: offset changed after calculation`);
  else if(!Number.isInteger(stop.offsetSeconds)||stop.offsetSeconds<0||stop.offsetSeconds>=stop.cycleSeconds)errors.push(`${stop.intersectionId}: proposed offset is outside its cycle`);
 }
 if(errors.length){log('corridor.coordination.publish-blocked',{corridorId:c.id,versionId:version.id,details:errors});return res.code(409).send({error:'stale or invalid coordination version',details:errors});}
 const previousPublished=c.coordinationVersions.find(x=>x.status==='published');
 for(const stop of version.stops)intersections.find(x=>x.id===stop.intersectionId)!.offset=stop.offsetSeconds;
 previousPublished&&(previousPublished.status='superseded',previousPublished.supersededAt=now());
 version.status='published';version.publishedAt=now();
 log('corridor.coordination.publish',{corridorId:c.id,versionId:version.id,versionNumber:version.versionNumber,supersededVersionId:previousPublished?.id,offsets:version.proposedOffsets});
 return version;
});
app.get('/api/corridors/:id/audit',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 return audit.filter(x=>x.payload?.corridorId===c.id);
});
// Deprecated: retained for compatibility, but now creates an unpublished draft instead of mutating offsets.
app.post('/api/corridors/:id/coordinate',async(req:any,res)=>{
 const c=findCorridor((req.params as any).id);
 if(!c)return res.code(404).send({error:'corridor not found'});
 try{return{deprecated:true,message:'use /coordination/calculate, then preview and publish',version:createVersion(c,req.body as any)};}catch(e){if(e instanceof DomainValidationError)return res.code(400).send({error:'validation failed',details:e.details});throw e;}
});
app.post('/api/priority-requests',async(req:any,res)=>{const b=req.body as any;if(!b.intersectionId||!b.routeId||b.etaSeconds==null)return res.code(400).send({error:'intersectionId、routeId、etaSeconds 必填'});const j=intersections.find(x=>x.id===b.intersectionId);if(!j)return res.code(404).send({error:'intersection not found'});const r:any={id:randomUUID(),intersectionId:b.intersectionId,routeId:b.routeId,etaSeconds:Number(b.etaSeconds),passengers:Number(b.passengers||0),requestType:b.requestType||'transit',status:'requested',requestedAt:now()};r.approved=r.passengers>=20||r.requestType==='emergency';r.status=r.approved?'approved':'deferred';priorityRequests.push(r);log('priority.request',r);return r;});
app.post('/api/pedestrian-phase',async(req:any,res)=>{const b=req.body as any;if(!b.intersectionId||b.crossingSeconds==null)return res.code(400).send({error:'intersectionId 和 crossingSeconds 必填'});const crossing=Number(b.crossingSeconds);if(crossing<7||crossing>60)return res.code(400).send({error:'crossingSeconds must be 7-60'});const j=intersections.find(x=>x.id===b.intersectionId);if(!j)return res.code(404).send({error:'intersection not found'});const p={id:randomUUID(),intersectionId:j.id,crossingSeconds:crossing,leadingInterval:Number(b.leadingInterval||3),accessible:Boolean(b.accessible),status:'validated',createdAt:now()};scenarioPolicies.push(p);return p;});
app.post('/api/simulations/:id/emissions',async(req:any,res)=>{const r=runs.find(x=>x.id===(req.params as any).id);if(!r)return res.code(404).send({error:'simulation not found'});const vkt=Number((req.body as any)?.vehicleKm||12000);const stopPenalty=(r.candidate?.totalDelay??r.baseline.totalDelay)/Math.max(1,r.baseline.horizon);return{simulationId:r.id,vehicleKm:vkt,co2Kg:Number((vkt*(.142+stopPenalty*.0008)).toFixed(2)),noxGrams:Number((vkt*(.32+stopPenalty*.0015)).toFixed(2)),idleHours:Number((stopPenalty*vkt/3600).toFixed(2)),method:'speed-delay surrogate model'};});
app.post('/api/evacuation-scenarios',async(req:any)=>{const b=req.body as any;const blocked=(b.blockedIntersections||[]) as string[];const original=incidents.length;for(const id of blocked)incidents.push({id:randomUUID(),intersectionId:id,type:'evacuation-block',severity:'high',status:'active',startedAt:now()});const result=simulate({horizon:b.horizon||1800,demand:b.demand});incidents.splice(original);return{id:randomUUID(),type:'evacuation',blockedIntersections:blocked,result,recommendation:result.spillbacks>3?'open reversible lanes and meter upstream inflow':'maintain coordinated offsets'};});
app.get('/api/priority-requests',async()=>priorityRequests);

app.listen({port:Number(process.env.PORT||6302),host:'127.0.0.1'}).catch(err=>{app.log.error(err);process.exit(1)});
