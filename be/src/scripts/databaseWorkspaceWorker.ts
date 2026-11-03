import 'reflect-metadata';
import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({path:path.resolve(process.cwd(),process.env.NODE_ENV==='production'?'.env.prod':'.env.dev')});
const {controlStore}=await import('../services/databaseWorkspace/store.js');
const {runJob}=await import('../services/databaseWorkspace/runner.js');
const {reauthorizeExecution}=await import('../services/databaseWorkspace/access.js');
const {cleanupArtifacts}=await import('../services/databaseWorkspace/artifacts.js');
const {reconcileOrphans}=await import('../services/databaseWorkspace/resultAccess.js');
const {default:sequelize}=await import('../config/database.js');
const {defineAssociations}=await import('../models/defineAssociations.js');
defineAssociations();
await sequelize.authenticate();
const store=controlStore();
if(!await store.healthy())throw new Error('Database Workspace control store has not been provisioned.');
const workerId=crypto.randomUUID();let stopping=false,lastCleanup=0;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
console.log(JSON.stringify({component:'database-workspace-worker',event:'ready',workerId}));
while(!stopping){
  try{
    if(Date.now()-lastCleanup>30000){await store.expireLostLeases();await reconcileOrphans(store);await cleanupArtifacts(store);lastCleanup=Date.now();}
    const next=await store.claim(workerId);
    if(next)await runJob(store,next.job,next.payload,()=>reauthorizeExecution(next.payload.actorId,next.payload.mode,next.payload.policyHash));
    else await new Promise(resolve=>setTimeout(resolve,500));
  }catch{
    console.error(JSON.stringify({component:'database-workspace-worker',event:'iteration_failed'}));
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
await store.close();await sequelize.close();
