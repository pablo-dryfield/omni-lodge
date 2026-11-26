import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MantineProvider} from '@mantine/core';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import CustomerEnquiries from './CustomerEnquiries';
import {enquiryApi} from '../api/customerEnquiries';
import {useModuleAccess} from '../hooks/useModuleAccess';
jest.mock('../api/customerEnquiries',()=>({enquiryApi:{list:jest.fn(),detail:jest.fn(),update:jest.fn(),templates:jest.fn(),preview:jest.fn(),saveTemplate:jest.fn(),removalPreview:jest.fn(),removeContents:jest.fn()}}));
jest.mock('../hooks/useModuleAccess');
jest.mock('../components/access/PageAccessGuard',()=>({PageAccessGuard:({children}:{children:React.ReactNode})=><>{children}</>}));
const api=enquiryApi as jest.Mocked<typeof enquiryApi>;
const row={requestId:'00000000-0000-4000-8000-000000000001',formId:'contact',sourceEnvironment:'staging' as const,customerName:'Example customer',customerEmail:'customer@example.test',subject:'Local enquiry',deliveryStatus:'uncertain' as const,handlingStatus:'new' as const,assignedTo:null,version:1,createdAt:'2026-11-23T10:00:00Z',sentAt:null};
const show=()=>render(<MantineProvider><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><CustomerEnquiries/></QueryClientProvider></MantineProvider>);
beforeEach(()=>{
 jest.clearAllMocks();(useModuleAccess as jest.Mock).mockReturnValue({ready:true,loading:false,canView:true,canUpdate:true,canCreate:false,canDelete:false});
 Object.defineProperty(window,'matchMedia',{writable:true,value:jest.fn().mockImplementation(query=>({matches:false,media:query,onchange:null,addListener:jest.fn(),removeListener:jest.fn(),addEventListener:jest.fn(),removeEventListener:jest.fn(),dispatchEvent:jest.fn()}))});
 global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
 api.list.mockResolvedValue({rows:[row],count:1,offset:0,limit:25,forms:[{id:'contact',title:'Contact'}],assignees:[]});
 api.detail.mockResolvedValue({...row,enquiryData:null,staffNotes:'',gmailUrl:null,providerMessageId:null,rfcMessageId:'<local@test>',events:[]});
 api.templates.mockResolvedValue([{formId:'contact',title:'Contact',fields:[{id:'name',label:'Name'}],subjectTemplate:'Hello %%name%%',bodyTemplate:'Body',layout:'plain_text',version:0,updatedAt:null}]);
});
it('separates delivery from handling status and loads only the selected tab',async()=>{show();expect(await screen.findByText('Local enquiry')).toBeInTheDocument();const item=within(screen.getByRole('row',{name:/Example customer/}));expect(item.getByText('Email: uncertain')).toBeInTheDocument();expect(item.getByText('New')).toBeInTheDocument();expect(api.templates).not.toHaveBeenCalled();});
it('shows historical metadata honestly and preserves a draft on stale-edit rejection',async()=>{
 api.update.mockRejectedValue({response:{data:{message:'This enquiry changed in another session. Your draft has been kept.'}}});show();fireEvent.click(await screen.findByRole('button',{name:'Open enquiry'}));
 expect(await screen.findByText(/Full form contents were not stored/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Close enquiry',exact:true})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Internal notes'),{target:{value:'Keep my draft'}});fireEvent.click(screen.getByRole('button',{name:'Save follow-up'}));
 expect(await screen.findByText(/Your draft has been kept/)).toBeInTheDocument();expect(screen.getByLabelText('Internal notes')).toHaveValue('Keep my draft');expect(api.update).toHaveBeenCalledTimes(1);
});
it('previews templates without sending or saving',async()=>{
 api.preview.mockResolvedValue({subject:'Preview subject',textBody:'Sample body',replyTo:'customer@example.test',htmlBody:'<p>Safe sample</p>'});show();fireEvent.click(screen.getByRole('tab',{name:'Email templates'}));
 fireEvent.click(await screen.findByRole('button',{name:'Preview with sample details'}));expect(await screen.findByText('Sample preview — no email sent')).toBeInTheDocument();expect(screen.getByTitle('Email template preview')).toHaveAttribute('sandbox','');expect(api.saveTemplate).not.toHaveBeenCalled();expect(api.preview).toHaveBeenCalledTimes(1);
});
it('does not fetch customer data without module access',async()=>{(useModuleAccess as jest.Mock).mockReturnValue({ready:true,loading:false,canView:false,canUpdate:false});show();expect(screen.getByText('You do not have access to the enquiry inbox.')).toBeInTheDocument();await waitFor(()=>expect(api.list).not.toHaveBeenCalled());});
it('only includes earlier metadata records when the operator requests history',async()=>{show();await screen.findByText('Local enquiry');expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({includeLegacy:'0'}));fireEvent.click(screen.getByLabelText('Include earlier delivery records'));await waitFor(()=>expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({includeLegacy:'1'})));});
it('does not expose removal to ordinary follow-up editors',async()=>{show();fireEvent.click(await screen.findByRole('button',{name:'Open enquiry'}));await screen.findByLabelText('Internal notes');expect(screen.queryByRole('button',{name:'Preview contents removal'})).not.toBeInTheDocument();expect(api.removalPreview).not.toHaveBeenCalled();});
it('labels removed contents honestly and prevents follow-up restoration',async()=>{
 api.detail.mockResolvedValue({...row,handlingStatus:'closed',redactedAt:'2026-11-26T12:00:00Z',enquiryData:null,staffNotes:'',gmailUrl:null,providerMessageId:null,rfcMessageId:'<local@test>',events:[]});show();
 fireEvent.click(await screen.findByRole('button',{name:'Open enquiry'}));expect(await screen.findByText(/wider removal is not complete/)).toBeInTheDocument();
 expect(screen.getByLabelText('Internal notes')).toBeDisabled();expect(screen.queryByRole('button',{name:'Save follow-up'})).not.toBeInTheDocument();expect(screen.queryByText(/Full form contents were not stored/)).not.toBeInTheDocument();
});
