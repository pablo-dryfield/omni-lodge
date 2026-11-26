const mockFind=jest.fn(),mockReadEvents=jest.fn(),mockClearEvents=jest.fn(),mockCreate=jest.fn();
jest.mock('../../models/WebsiteEnquiryDelivery.js',()=>({__esModule:true,default:{findByPk:(...a:any[])=>mockFind(...a)}}));
jest.mock('../../models/CustomerEnquiryEvent.js',()=>({__esModule:true,default:{findAll:(...a:any[])=>mockReadEvents(...a),update:(...a:any[])=>mockClearEvents(...a),create:(...a:any[])=>mockCreate(...a)}}));
import {previewEnquiryRemoval,removeEnquiryContents,validateRemovalInput} from '../customerEnquiryRemoval';
const id='00000000-0000-4000-8000-000000000001',transaction:any={LOCK:{UPDATE:'UPDATE'}};
const makeRow=()=>{
 const row:any={requestId:id,formId:'contact',sourceEnvironment:'staging',version:2,status:'sent',handlingStatus:'closed',assignedTo:1,staffNotes:'PRIVATE NOTES',
   customerName:'PRIVATE NAME',customerEmail:'private@example.test',subject:'PRIVATE SUBJECT',payloadHash:'b'.repeat(64),rfcMessageId:'<id@example.test>',providerMessageId:'f'.repeat(16),sentAt:new Date('2026-11-01T00:00:00Z'),redactedAt:null,redactedBy:null,
   enquiryData:{fields:{message:'PRIVATE BODY'},labels:{message:'Message'},mailbox:'pubthroughkrakow@gmail.com',notification:{textBody:'PRIVATE NOTIFICATION'}}};
 row.update=jest.fn(async(values:any)=>Object.assign(row,values));return row;
};
const events:any[]=[{id:1,kind:'enquiry.updated',actorId:1,changes:{unexpectedPrivateValue:'PRIVATE AUDIT'},createdAt:new Date('2026-11-01T00:00:00Z')}];
const input=(row=makeRow())=>({version:row.version,fingerprint:previewEnquiryRemoval(row,events,true).fingerprint,confirmation:id,reviewedRetention:true as const,understandsOtherCopies:true as const,reason:'purpose_ended' as const});
beforeEach(()=>{jest.clearAllMocks();mockReadEvents.mockResolvedValue(events);});
it('previews exact removal scope without returning bodies, contact details, notes or audit contents',()=>{
 const p=previewEnquiryRemoval(makeRow(),events,false);expect(p.canExecute).toBe(false);expect(p.fieldCount).toBe(1);expect(p.activityCount).toBe(1);
 expect(p.crossSystemComplete).toBe(false);expect(p.otherCopies).toMatchObject({gmail:'not_changed',backups:'not_changed',exports:'not_changed'});
 expect(JSON.stringify(p)).not.toMatch(/PRIVATE|private@example/);expect(mockClearEvents).not.toHaveBeenCalled();
});
it.each([['handlingStatus','new'],['handlingStatus','in_progress'],['status','uncertain'],['status','sending'],['sourceEnvironment','production'],['redactedAt',new Date()]])('blocks unsuitable %s=%s records', (key,value)=>{
 const row=makeRow();row[key as string]=value;expect(previewEnquiryRemoval(row,events,true).canExecute).toBe(false);
});
it.each([{reviewedRetention:false},{understandsOtherCopies:false},{confirmation:'wrong'},{version:0},{fingerprint:'wrong'},{reason:'unreviewed'},{extra:'secret'}])('rejects missing/forged confirmation %j',patch=>{
 expect(()=>validateRemovalInput({...input(),...patch},id)).toThrow();
});
it('invalidates previews for same-version source or activity changes',async()=>{
 const row=makeRow(),v=input(row);row.staffNotes='Changed without a version';mockFind.mockResolvedValue(row);
 await expect(removeEnquiryContents(id,v,7,transaction)).rejects.toMatchObject({status:409});expect(row.update).not.toHaveBeenCalled();expect(mockClearEvents).not.toHaveBeenCalled();
 row.staffNotes='PRIVATE NOTES';mockReadEvents.mockResolvedValue([...events,{id:2,kind:'enquiry.updated',changes:{},actorId:1}]);
 await expect(removeEnquiryContents(id,v,7,transaction)).rejects.toMatchObject({status:409});expect(row.update).not.toHaveBeenCalled();
});
it('clears contents and audit details atomically while preserving delivery deduplication and returning a minimal receipt',async()=>{
 const row=makeRow(),v=input(row);mockFind.mockResolvedValue(row);
 const receipt=await removeEnquiryContents(id,v,7,transaction);
 expect(mockFind).toHaveBeenCalledWith(id,{transaction,lock:'UPDATE'});expect(mockClearEvents).toHaveBeenCalledWith({changes:{detailsRemoved:true}},{where:{requestId:id},transaction});
 expect(row).toMatchObject({version:3,enquiryData:null,customerName:null,customerEmail:null,subject:null,staffNotes:'',assignedTo:null,redactedBy:7,payloadHash:'b'.repeat(64),providerMessageId:'f'.repeat(16),status:'sent',handlingStatus:'closed'});
 expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({actorId:7,kind:'enquiry.contents_removed',changes:expect.objectContaining({version:3,crossSystemComplete:false})}),{transaction});
 expect(receipt).toMatchObject({version:3,redactedBy:7,crossSystemComplete:false});expect(JSON.stringify(receipt)).not.toMatch(/PRIVATE|private@example/);
 await expect(removeEnquiryContents(id,v,7,transaction)).rejects.toMatchObject({status:409});expect(mockCreate).toHaveBeenCalledTimes(1);
});
