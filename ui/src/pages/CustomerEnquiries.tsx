import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Alert,Anchor,Badge,Button,Card,Checkbox,Divider,Group,Loader,Modal,Pagination,Select,SimpleGrid,Stack,Table,Tabs,Text,TextInput,Textarea,Title} from '@mantine/core';
import {useDebouncedValue,useMediaQuery} from '@mantine/hooks';
import {PageAccessGuard} from '../components/access/PageAccessGuard';
import {useModuleAccess} from '../hooks/useModuleAccess';
import {PAGE_SLUGS} from '../constants/pageSlugs';
import {enquiryApi,type CustomerEnquiry,type EnquiryDetail,type EnquiryHandlingStatus,type EnquiryPreview,type EnquiryTemplate} from '../api/customerEnquiries';

const statuses=[{value:'new',label:'New'},{value:'in_progress',label:'In progress'},{value:'replied',label:'Replied'},{value:'closed',label:'Closed'}];
const statusLabel=(v:string)=>statuses.find(s=>s.value===v)?.label??v;
const date=(v:string)=>new Date(v).toLocaleString();
const errorMessage=(e:unknown,fallback:string)=>{
 const data=(e as {response?:{data?:unknown}})?.response?.data;
 if(data&&typeof data==='object'&&'message'in data&&typeof data.message==='string')return data.message;
 return fallback;
};
function Detail({id,onClose,assignees}:{id:string;onClose:()=>void;assignees:{id:number;name:string}[]}){
 const query=useQuery({queryKey:['customer-enquiry',id],queryFn:()=>enquiryApi.detail(id),refetchOnWindowFocus:false,retry:false});
 const permissions=useModuleAccess('customer-enquiries-inbox'),cache=useQueryClient();
 const [draft,setDraft]=useState<{version:number;handlingStatus:EnquiryHandlingStatus;assignedTo:number|null;staffNotes:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const fromRow=(row:EnquiryDetail)=>({version:row.version,handlingStatus:row.handlingStatus,assignedTo:row.assignedTo,staffNotes:row.staffNotes});
 useEffect(()=>{if(query.data)setDraft(current=>current??fromRow(query.data!));},[query.data]);
 const row=query.data;
 const save=async()=>{if(!draft)return;setBusy(true);setError('');try{await enquiryApi.update(id,draft);await cache.invalidateQueries({queryKey:['customer-enquiries']});const latest=await query.refetch();if(latest.data)setDraft(fromRow(latest.data));}catch(e){setError(errorMessage(e,'Unable to save. Your draft has been kept.'));}finally{setBusy(false);}};
 return <Modal opened onClose={onClose} title="Customer enquiry" closeButtonProps={{'aria-label':'Close enquiry'}} size="xl" fullScreen={useMediaQuery('(max-width: 600px)')}>
  {query.isLoading&&<Loader aria-label="Loading enquiry"/>}
  {query.isError&&<Alert color="red">Unable to load the enquiry. <Button onClick={()=>void query.refetch()}>Retry</Button></Alert>}
  {row&&draft&&<Stack style={{overflowWrap:'anywhere',minWidth:0}}>
   <Group><Badge color="yellow">{row.sourceEnvironment}</Badge><Badge>{statusLabel(row.handlingStatus)}</Badge><Badge color={row.deliveryStatus==='sent'?'green':'orange'}>Email: {row.deliveryStatus}</Badge></Group>
   <Title order={3}>{row.subject||row.formId}</Title><Text size="sm" c="dimmed">{date(row.createdAt)} · {row.requestId}</Text>
   {row.gmailUrl&&<Anchor href={row.gmailUrl} target="_blank" rel="noopener noreferrer">Open notification in Gmail</Anchor>}
   {row.deliveryStatus!=='sent'&&<Alert color="orange">Email delivery is not confirmed. The saved enquiry is available here; check Gmail before sending any message.</Alert>}
   {row.enquiryData?<><Divider label="Customer details"/>{Object.entries(row.enquiryData.fields).map(([key,value])=><div key={key}><Text fw={600} size="sm">{row.enquiryData!.labels[key]||key}</Text><Text style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{Array.isArray(value)?value.join(', '):value||'—'}</Text></div>)}<Divider label="Email notification"/><Text size="sm">To: {row.enquiryData.notification.to}{row.enquiryData.notification.cc?` · Cc: ${row.enquiryData.notification.cc}`:''}</Text><Text size="sm">Reply-To: {row.enquiryData.notification.replyTo}</Text><Text component="pre" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit'}}>{row.enquiryData.notification.textBody}</Text></>:<Alert>Delivery record only. Full form contents were not stored before Customer Enquiries was introduced.</Alert>}
   <Divider label="Team follow-up"/>
   <Select label="Handling status" data={statuses} value={draft.handlingStatus} onChange={v=>v&&setDraft({...draft,handlingStatus:v as EnquiryHandlingStatus})} disabled={!permissions.canUpdate||busy}/>
   <Select label="Assigned team member" placeholder="Unassigned" clearable searchable data={assignees.map(a=>({value:String(a.id),label:a.name}))} value={draft.assignedTo===null?null:String(draft.assignedTo)} onChange={v=>setDraft({...draft,assignedTo:v?Number(v):null})} disabled={!permissions.canUpdate||busy}/>
   <Textarea label="Internal notes" minRows={4} maxLength={20000} value={draft.staffNotes} onChange={e=>setDraft({...draft,staffNotes:e.currentTarget.value})} disabled={!permissions.canUpdate||busy}/>
   <Text size="sm" c="dimmed">Mark “Replied” after a team member has answered the customer. Opening Gmail does not send a reply.</Text>
   {error&&<Alert color="red">{error}<Button variant="subtle" onClick={async()=>{const latest=await query.refetch();if(latest.data){setDraft(fromRow(latest.data));setError('');}}}>Reload latest</Button></Alert>}
   {permissions.canUpdate&&<Button onClick={()=>void save()} loading={busy}>Save follow-up</Button>}
   {row.events.length>0&&<><Divider label="Activity"/>{row.events.map(e=><Text size="sm" key={e.id}>{date(e.createdAt)} · Team member #{e.actorId} · {e.kind==='enquiry.updated'?'Updated follow-up':e.kind}</Text>)}</>}
  </Stack>}
 </Modal>;
}
function Templates(){
 const access=useModuleAccess('customer-enquiry-templates');
 const query=useQuery({queryKey:['customer-enquiry-templates'],queryFn:enquiryApi.templates,enabled:access.canView,refetchOnWindowFocus:false,retry:false});
 const [selected,setSelected]=useState<string|null>(null),[drafts,setDrafts]=useState<Record<string,EnquiryTemplate>>({}),[preview,setPreview]=useState<EnquiryPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{if(query.data){setDrafts(d=>({...Object.fromEntries(query.data!.map(t=>[t.formId,t])),...d}));setSelected(s=>s??query.data![0]?.formId??null);}},[query.data]);
 const draft=selected?drafts[selected]:undefined;
 const change=(values:Partial<EnquiryTemplate>)=>{if(draft){setDrafts(d=>({...d,[draft.formId]:{...draft,...values}}));setPreview(null);setSaved(false);}};
 if(!access.canView)return <Alert>You do not have access to enquiry email templates.</Alert>;
 const perform=async(action:'preview'|'save')=>{if(!draft)return;setBusy(true);setError('');setSaved(false);try{if(action==='preview')setPreview(await enquiryApi.preview(draft));else{const r=await enquiryApi.saveTemplate(draft);setDrafts(d=>({...d,[draft.formId]:{...draft,...r}}));setSaved(true);}}catch(e){setError(errorMessage(e,'Unable to complete this action. Your draft has been kept.'));}finally{setBusy(false);}};
 return <Stack mt="md">
  <Text>Choose the notification wording and layout for each website form. Customer replies continue through the team’s inbox.</Text>
  {query.isLoading&&<Loader aria-label="Loading email templates"/>}{query.isError&&<Alert color="red">Unable to load email templates. <Button onClick={()=>void query.refetch()}>Retry</Button></Alert>}
  <Select label="Form" data={(query.data??[]).map(t=>({value:t.formId,label:t.title}))} value={selected} onChange={v=>{setSelected(v);setPreview(null);setError('');setSaved(false);}}/>
  {draft&&<>
   <TextInput label="Email subject" value={draft.subjectTemplate} maxLength={512} onChange={e=>change({subjectTemplate:e.currentTarget.value})} disabled={!access.canUpdate||busy}/>
   <Textarea label="Email body" minRows={10} autosize maxRows={25} value={draft.bodyTemplate} onChange={e=>change({bodyTemplate:e.currentTarget.value})} disabled={!access.canUpdate||busy}/>
   <Text size="sm" c="dimmed">Fields: {draft.fields.map(f=>`%%${f.id}%% (${f.label})`).join(', ')}. The page link and enquiry reference are included automatically.</Text>
   <Select label="Email layout" data={[{value:'plain_text',label:'Plain text'},{value:'branded',label:'Branded HTML with plain text fallback'}]} value={draft.layout} onChange={v=>change({layout:v as EnquiryTemplate['layout']})} disabled={!access.canUpdate||busy}/>
   {error&&<Alert color="red">{error}</Alert>}{saved&&<Alert color="green">Template saved. New enquiries will use this wording.</Alert>}
   <Group><Button variant="default" onClick={()=>void perform('preview')} loading={busy}>Preview with sample details</Button>{access.canUpdate&&<Button onClick={()=>void perform('save')} disabled={busy}>Save template</Button>}</Group>
   {preview&&<Card withBorder><Stack><Text fw={600}>Sample preview — no email sent</Text><Text fw={600}>{preview.subject}</Text>{preview.htmlBody?<iframe title="Email template preview" sandbox="" srcDoc={preview.htmlBody} style={{width:'100%',height:460,border:0}}/>:<Text component="pre" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit'}}>{preview.textBody}</Text>}</Stack></Card>}
  </>}
 </Stack>;
}
function Inbox(){
 const access=useModuleAccess('customer-enquiries-inbox'),mobile=useMediaQuery('(max-width: 700px)');
 const [search,setSearch]=useState(''),[q]=useDebouncedValue(search,250),[form,setForm]=useState<string|null>(null),[status,setStatus]=useState<string|null>(null),[delivery,setDelivery]=useState<string|null>(null),[history,setHistory]=useState(false),[page,setPage]=useState(1),[selected,setSelected]=useState<string|null>(null);
 useEffect(()=>setPage(1),[q,form,status,delivery,history]);
 const query=useQuery({queryKey:['customer-enquiries',q,form,status,delivery,history,page],queryFn:()=>enquiryApi.list({q,formId:form??'',handlingStatus:status??'',deliveryStatus:delivery??'',includeLegacy:history?'1':'0',limit:25,offset:(page-1)*25}),enabled:access.canView,refetchOnWindowFocus:false,retry:false});
 const data=query.data;
 if(!access.canView)return <Alert>You do not have access to the enquiry inbox.</Alert>;
 const badges=(r:CustomerEnquiry)=><Group gap="xs"><Badge>{statusLabel(r.handlingStatus)}</Badge><Badge color={r.deliveryStatus==='sent'?'green':'orange'}>Email: {r.deliveryStatus}</Badge><Badge color="yellow">{r.sourceEnvironment}</Badge></Group>;
 return <Stack mt="md">
  <SimpleGrid cols={{base:1,sm:2,lg:4}}><TextInput label="Search enquiries" placeholder="Name, email or subject" maxLength={200} value={search} onChange={e=>setSearch(e.currentTarget.value)}/><Select label="Form" placeholder="All forms" clearable data={(data?.forms??[]).map(f=>({value:f.id,label:f.title}))} value={form} onChange={setForm}/><Select label="Handling status" placeholder="All statuses" clearable data={statuses} value={status} onChange={setStatus}/><Select label="Email delivery" placeholder="All deliveries" clearable data={['sending','sent','uncertain']} value={delivery} onChange={setDelivery}/></SimpleGrid>
  <Checkbox label="Include earlier delivery records" checked={history} onChange={e=>setHistory(e.currentTarget.checked)}/>
  <Group justify="space-between"><Text>{data?`${data.count} enquiries`:'Enquiries'}</Text><Button variant="default" onClick={()=>void query.refetch()} disabled={query.isFetching}>{query.isFetching?'Refreshing…':'Refresh'}</Button></Group>
  {query.isLoading&&<Loader aria-label="Loading enquiries"/>}{query.isError&&<Alert color="red">Unable to load enquiries. Please retry.</Alert>}
  {data&&data.rows.length===0&&<Card withBorder><Text fw={600}>No enquiries found</Text><Text c="dimmed">New website submissions will appear here. Try clearing the filters.</Text></Card>}
  {data&&data.rows.length>0&&(mobile?<Stack>{data.rows.map(r=><Card withBorder key={r.requestId}><Stack gap="sm">{badges(r)}<Text fw={600}>{r.subject||r.formId}</Text><Text size="sm">{r.customerName||'Earlier delivery record'} · {date(r.createdAt)}</Text><Button variant="light" onClick={()=>setSelected(r.requestId)}>Open enquiry</Button></Stack></Card>)}</Stack>:<Table.ScrollContainer minWidth={850}><Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>Received</Table.Th><Table.Th>Customer</Table.Th><Table.Th>Enquiry</Table.Th><Table.Th>Status</Table.Th><Table.Th>Assigned</Table.Th><Table.Th>Details</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.rows.map(r=><Table.Tr key={r.requestId}><Table.Td>{date(r.createdAt)}</Table.Td><Table.Td><Text size="sm">{r.customerName||'Earlier delivery record'}</Text><Text size="xs">{r.customerEmail}</Text></Table.Td><Table.Td>{r.subject||r.formId}</Table.Td><Table.Td>{badges(r)}</Table.Td><Table.Td>{data.assignees.find(a=>a.id===r.assignedTo)?.name||'Unassigned'}</Table.Td><Table.Td><Button size="xs" variant="light" onClick={()=>setSelected(r.requestId)}>Open enquiry</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>)}
  {data&&data.count>25&&<Pagination total={Math.ceil(data.count/25)} value={page} onChange={setPage} aria-label="Enquiry pages"/>}
  {selected&&<Detail key={selected} id={selected} onClose={()=>setSelected(null)} assignees={data?.assignees??[]}/>}
 </Stack>;
}
export default function CustomerEnquiries(){
 return <PageAccessGuard pageSlug={PAGE_SLUGS.customerEnquiries}><Stack p="md" style={{minWidth:0,overflowWrap:'anywhere'}}><Group><Title order={1}>Customer Enquiries</Title><Badge color="yellow">KTK staging</Badge></Group><Text c="dimmed">Review website enquiries, coordinate follow-up and manage staging notification emails.</Text><Tabs defaultValue="inbox" keepMounted={false}><Tabs.List><Tabs.Tab value="inbox">Enquiries</Tabs.Tab><Tabs.Tab value="templates">Email templates</Tabs.Tab></Tabs.List><Tabs.Panel value="inbox"><Inbox/></Tabs.Panel><Tabs.Panel value="templates"><Templates/></Tabs.Panel></Tabs></Stack></PageAccessGuard>;
}
