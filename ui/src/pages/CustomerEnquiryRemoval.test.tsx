import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MantineProvider} from '@mantine/core';
import CustomerEnquiryRemoval from './CustomerEnquiryRemoval';
import {enquiryApi,type EnquiryRemovalPreview} from '../api/customerEnquiries';
jest.mock('../api/customerEnquiries',()=>({enquiryApi:{removalPreview:jest.fn(),removeContents:jest.fn()}}));
const api=enquiryApi as jest.Mocked<typeof enquiryApi>;
const id='00000000-0000-4000-8000-000000000001';
const preview:EnquiryRemovalPreview={requestId:id,version:2,fingerprint:'a'.repeat(64),canExecute:true,blockers:[],removes:['Submitted fields','Internal notes'],retained:['Delivery identity'],fieldCount:3,activityCount:1,otherCopies:{gmailUrl:'https://mail.google.com/mail/u/?authuser=example#all/ffffffffffffffff',gmail:'not_changed',backups:'not_changed',exports:'not_changed'},crossSystemComplete:false};
const receipt={requestId:id,version:3,redactedAt:'2026-11-26T12:00:00Z',redactedBy:1,otherCopies:{gmail:'not_changed' as const,backups:'not_changed' as const,exports:'not_changed' as const},crossSystemComplete:false as const};
const removed=jest.fn(async()=>{});
const show=(dirty=false)=>render(<MantineProvider><CustomerEnquiryRemoval id={id} hasUnsavedChanges={dirty} onRemoved={removed}/></MantineProvider>);
beforeEach(()=>{
 jest.clearAllMocks();api.removalPreview.mockResolvedValue(preview);api.removeContents.mockResolvedValue(receipt);
 Object.defineProperty(window,'matchMedia',{writable:true,value:jest.fn().mockImplementation(query=>({matches:false,media:query,onchange:null,addListener:jest.fn(),removeListener:jest.fn(),addEventListener:jest.fn(),removeEventListener:jest.fn(),dispatchEvent:jest.fn()}))});
 global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
});
async function confirm(){
 fireEvent.click(screen.getByRole('button',{name:'Preview contents removal'}));
 await screen.findByText('Removed from OmniLodge');
 fireEvent.click(screen.getByRole('textbox',{name:'Removal reason'}));
 fireEvent.click(await screen.findByRole('option',{name:'Purpose ended; removal approved'}));
 fireEvent.click(screen.getByLabelText('I have reviewed the retention decision and any specific obligation or active claim.'));
 fireEvent.click(screen.getByLabelText('I understand Gmail, backups and exports require separate handling.'));
 fireEvent.change(screen.getByLabelText('Type the full enquiry reference to confirm'),{target:{value:id}});
}
it('never requests a preview or removal merely by displaying the control',()=>{show();expect(api.removalPreview).not.toHaveBeenCalled();expect(api.removeContents).not.toHaveBeenCalled();});
it('requires the follow-up draft to be saved or discarded first',()=>{show(true);expect(screen.getByRole('button',{name:'Preview contents removal'})).toBeDisabled();expect(api.removalPreview).not.toHaveBeenCalled();});
it('shows retained identities and separate Gmail/backup scope while execution is disabled',async()=>{
 api.removalPreview.mockResolvedValue({...preview,canExecute:false,blockers:['Contents removal is disabled.']});show();fireEvent.click(screen.getByRole('button',{name:'Preview contents removal'}));
 expect(await screen.findByText('Contents removal is disabled.')).toBeInTheDocument();expect(screen.getByText('• Delivery identity')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Review linked Gmail copy separately'})).toHaveAttribute('href',preview.otherCopies.gmailUrl);
 expect(screen.queryByRole('button',{name:'Remove contents permanently'})).not.toBeInTheDocument();expect(api.removeContents).not.toHaveBeenCalled();
});
it('requires every acknowledgement and the exact reference, then sends one explicitly confirmed action',async()=>{
 show();fireEvent.click(screen.getByRole('button',{name:'Preview contents removal'}));await screen.findByText('Removed from OmniLodge');
 expect(screen.getByRole('button',{name:'Remove contents permanently'})).toBeDisabled();
 await confirm();fireEvent.change(screen.getByLabelText('Type the full enquiry reference to confirm'),{target:{value:'wrong'}});
 expect(screen.getByRole('button',{name:'Remove contents permanently'})).toBeDisabled();fireEvent.change(screen.getByLabelText('Type the full enquiry reference to confirm'),{target:{value:id}});
 fireEvent.click(screen.getByRole('button',{name:'Remove contents permanently'}));
 await waitFor(()=>expect(removed).toHaveBeenCalledWith(receipt));expect(api.removeContents).toHaveBeenCalledTimes(1);
 expect(api.removeContents).toHaveBeenCalledWith(id,{version:2,fingerprint:'a'.repeat(64),confirmation:id,reviewedRetention:true,understandsOtherCopies:true,reason:'purpose_ended'});
});
it('clears a stale preview after a conflict and never automatically retries',async()=>{
 api.removeContents.mockRejectedValue({response:{status:409}});show();await confirm();fireEvent.click(screen.getByRole('button',{name:'Remove contents permanently'}));
 expect(await screen.findByText(/Removal was refused/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Remove contents permanently'})).not.toBeInTheDocument();expect(api.removeContents).toHaveBeenCalledTimes(1);expect(removed).not.toHaveBeenCalled();
});
it('blocks another action after an uncertain response until the operator reopens and checks the record',async()=>{
 api.removeContents.mockRejectedValue(new Error('network timeout'));show();await confirm();fireEvent.click(screen.getByRole('button',{name:'Remove contents permanently'}));
 expect(await screen.findByText(/could not be confirmed/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Preview contents removal'})).toBeDisabled();expect(api.removeContents).toHaveBeenCalledTimes(1);expect(removed).not.toHaveBeenCalled();
});
