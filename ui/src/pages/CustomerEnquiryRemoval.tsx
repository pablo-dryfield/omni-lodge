import {useState} from 'react';
import {Alert,Anchor,Button,Card,Checkbox,Select,Stack,Text,TextInput,Title} from '@mantine/core';
import {enquiryApi,type EnquiryRemovalPreview,type EnquiryRemovalReceipt} from '../api/customerEnquiries';

export default function CustomerEnquiryRemoval({id,hasUnsavedChanges,onRemoved}:{id:string;hasUnsavedChanges:boolean;onRemoved:(receipt:EnquiryRemovalReceipt)=>Promise<void>}){
 const [preview,setPreview]=useState<EnquiryRemovalPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [confirmation,setConfirmation]=useState(''),[reviewed,setReviewed]=useState(false),[copies,setCopies]=useState(false),[reason,setReason]=useState<string|null>(null);
 const [uncertain,setUncertain]=useState(false);
 const loadPreview=async()=>{setBusy(true);setError('');setPreview(null);setConfirmation('');setReviewed(false);setCopies(false);setReason(null);try{setPreview(await enquiryApi.removalPreview(id));}catch{setError('Unable to load the removal preview. No removal was requested.');}finally{setBusy(false);}};
 const remove=async()=>{
  if(!preview?.canExecute||confirmation!==id||!reviewed||!copies||!reason||hasUnsavedChanges||busy||uncertain)return;
  setBusy(true);setError('');
  let receipt:EnquiryRemovalReceipt;
  try{receipt=await enquiryApi.removeContents(id,{version:preview.version,fingerprint:preview.fingerprint,confirmation,reviewedRetention:true,understandsOtherCopies:true,reason:reason as 'purpose_ended'|'approved_request'});}
  catch(e){
   const status=(e as {response?:{status?:number}})?.response?.status;
   setPreview(null);setConfirmation('');
   if(status===409||status===400||status===423||status===403){setError('Removal was refused. Reload the enquiry and review a new preview before taking another action.');}
   else{setUncertain(true);setError('The removal result could not be confirmed. Close and reopen this enquiry to check its current state. Do not retry this action.');}
   setBusy(false);return;
  }
  setPreview(null);setConfirmation('');
  try{await onRemoved(receipt);}finally{setBusy(false);}
 };
 return <Card withBorder><Stack>
  <Title order={4}>Remove enquiry contents</Title>
  <Text size="sm">Preview the exact scope first. Removal is irreversible in the active enquiry record. Delivery identifiers remain to prevent duplicate emails; this does not anonymise every copy.</Text>
  {hasUnsavedChanges&&<Alert>Save or discard your follow-up draft before reviewing removal.</Alert>}
  {error&&<Alert color="red" role="alert">{error}</Alert>}
  <Button variant="default" onClick={()=>void loadPreview()} disabled={busy||uncertain||hasUnsavedChanges}>Preview contents removal</Button>
  {preview&&<>
   <Text fw={600}>Enquiry reference: {preview.requestId}</Text>
   <Text size="sm">Saved fields: {preview.fieldCount} · Activity entries: {preview.activityCount}</Text>
   <Text fw={600}>Removed from OmniLodge</Text>{preview.removes.map(s=><Text size="sm" key={s}>• {s}</Text>)}
   <Text fw={600}>Retained in OmniLodge</Text>{preview.retained.map(s=><Text size="sm" key={s}>• {s}</Text>)}
   <Alert color="orange">Gmail messages, backups and exports are not changed. Review and track those copies separately before calling a wider removal request complete.</Alert>
   {preview.otherCopies.gmailUrl&&<Anchor href={preview.otherCopies.gmailUrl} target="_blank" rel="noopener noreferrer">Review linked Gmail copy separately</Anchor>}
   {preview.blockers.map(s=><Alert color="orange" key={s}>{s}</Alert>)}
   {preview.canExecute&&<>
    <Select label="Removal reason" placeholder="Choose the reviewed reason" value={reason} onChange={setReason} disabled={busy} data={[{value:'purpose_ended',label:'Purpose ended; removal approved'},{value:'approved_request',label:'Individual request assessed; removal approved'}]}/>
    <Checkbox label="I have reviewed the retention decision and any specific obligation or active claim." checked={reviewed} onChange={e=>setReviewed(e.currentTarget.checked)} disabled={busy}/>
    <Checkbox label="I understand Gmail, backups and exports require separate handling." checked={copies} onChange={e=>setCopies(e.currentTarget.checked)} disabled={busy}/>
    <TextInput label="Type the full enquiry reference to confirm" value={confirmation} onChange={e=>setConfirmation(e.currentTarget.value)} autoComplete="off" disabled={busy}/>
    <Button color="red" onClick={()=>void remove()} loading={busy} disabled={hasUnsavedChanges||uncertain||confirmation!==id||!reviewed||!copies||!reason}>Remove contents permanently</Button>
   </>}
  </>}
 </Stack></Card>;
}
