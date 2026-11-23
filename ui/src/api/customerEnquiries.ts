import axiosInstance from '../utils/axiosInstance';

export type EnquiryHandlingStatus='new'|'in_progress'|'replied'|'closed';
export type CustomerEnquiry={requestId:string;formId:string;sourceEnvironment:'staging';customerName:string|null;customerEmail:string|null;subject:string|null;deliveryStatus:'sending'|'sent'|'uncertain';handlingStatus:EnquiryHandlingStatus;assignedTo:number|null;version:number;createdAt:string;sentAt:string|null};
export type EnquiryList={rows:CustomerEnquiry[];count:number;limit:number;offset:number;forms:{id:string;title:string}[];assignees:{id:number;name:string}[]};
export type EnquiryDetail=CustomerEnquiry&{enquiryData:null|{fields:Record<string,string|string[]>;labels:Record<string,string>;notification:{subject:string;textBody:string;htmlBody?:string;replyTo:string;from:string;to:string;cc?:string}};staffNotes:string;gmailUrl:string|null;providerMessageId:string|null;rfcMessageId:string;events:{id:number;kind:string;actorId:number;changes:Record<string,unknown>;createdAt:string}[]};
export type EnquiryTemplate={formId:string;title:string;fields:{id:string;label:string}[];subjectTemplate:string;bodyTemplate:string;layout:'plain_text'|'branded';version:number;updatedAt:string|null};
export type EnquiryPreview={subject:string;textBody:string;htmlBody?:string;replyTo:string};
export const enquiryApi={
 list:async(params:Record<string,string|number>)=>(await axiosInstance.get<EnquiryList>('/customer-enquiries',{params})).data,
 detail:async(id:string)=>(await axiosInstance.get<EnquiryDetail>('/customer-enquiries/'+encodeURIComponent(id))).data,
 update:async(id:string,draft:{version:number;handlingStatus:EnquiryHandlingStatus;assignedTo:number|null;staffNotes:string})=>(await axiosInstance.patch<CustomerEnquiry>('/customer-enquiries/'+encodeURIComponent(id),draft)).data,
 templates:async()=>(await axiosInstance.get<{templates:EnquiryTemplate[]}>('/customer-enquiries/templates')).data.templates,
 preview:async(draft:EnquiryTemplate)=>(await axiosInstance.post<{preview:EnquiryPreview}>('/customer-enquiries/templates/'+encodeURIComponent(draft.formId)+'/preview',{subjectTemplate:draft.subjectTemplate,bodyTemplate:draft.bodyTemplate,layout:draft.layout})).data.preview,
 saveTemplate:async(draft:EnquiryTemplate)=>(await axiosInstance.put<{version:number;updatedAt:string}>('/customer-enquiries/templates/'+encodeURIComponent(draft.formId),{subjectTemplate:draft.subjectTemplate,bodyTemplate:draft.bodyTemplate,layout:draft.layout,version:draft.version})).data,
};
