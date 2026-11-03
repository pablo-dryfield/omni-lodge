import type { Field,WireValue } from './api';
import { downloadBookingBlob,copyBookingExportImage,downloadBookingExport,type BookingExportModel } from '../../utils/bookingTableExport';

export type ExportFormat='csv'|'json'|'xlsx'|'sql'|'png'|'pdf'|'copy';
const safeCsv=(v:string)=>{let first=0;while(first<v.length&&(v.charCodeAt(first)<32||!v[first].trim()))first++;return `"${(['=','+','@','-'].includes(v[first])?"'"+v:v).replace(/"/g,'""')}"`;};
export async function exportResult(fields:Field[],rows:WireValue[][],format:ExportFormat,details:string[]):Promise<string>{
  if(!fields.length)throw new Error('Choose at least one column.');
  const filename=`database-result-${new Date().toISOString().replace(/[:.]/g,'-')}`;
  const save=(body:string,type:string,extension:string)=>downloadBookingBlob(new Blob([body],{type}),`${filename}.${extension}`);
  if(format==='json'){save(JSON.stringify({fields,rows,details},null,2),'application/json','json');return 'Lossless JSON downloaded.';}
  if(format==='csv'){save('\uFEFF'+[fields.map(f=>safeCsv(f.name)).join(','),...rows.map(r=>r.map(v=>v===null?'\\N':safeCsv(v)).join(','))].join('\r\n'),'text/csv;charset=utf-8','csv');return 'CSV downloaded. Unquoted \\N represents SQL NULL; formula-like text is escaped.';}
  if(format==='sql'){
    const ident=(v:string)=>`"${v.replace(/"/g,'""')}"`;
    const value=(v:WireValue,f:Field)=>`${v===null?'NULL':`E'${v.replace(/\\/g,'\\\\').replace(/'/g,"''")}'`}::${ident(f.pgTypeSchema||'pg_catalog')}.${ident(f.pgType)}`;
    save(`-- OmniLodge captured result. Review before executing.\n-- ${details.join('\n-- ')}\n${rows.length?`VALUES\n${rows.map(r=>`(${r.map((v,i)=>value(v,fields[i])).join(', ')})`).join(',\n')};`:'-- No rows.'}\n`,'text/plain;charset=utf-8','sql');return 'SQL data script downloaded for review.';
  }
  if(format==='xlsx'){
    const {Workbook}=await import('exceljs');const workbook=new Workbook();workbook.creator='OmniLodge';
    const sheet=workbook.addWorksheet('Results',{views:[{state:'frozen',ySplit:1}]});sheet.addRow(fields.map(f=>f.name));
    const nulls:number[][]=[];
    rows.forEach((r,i)=>{sheet.addRow(r.map((v,j)=>{if(v===null)nulls.push([i+2,j+1]);return v;}));});
    sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=24; c.numFmt='@';});
    const schema=workbook.addWorksheet('Schema');schema.addRow(['Column','Name','PostgreSQL type','Encoding']);fields.forEach((f,i)=>schema.addRow([i+1,f.name,f.pgType,f.encoding]));
    const nullSheet=workbook.addWorksheet('SQL NULLs');nullSheet.addRow(['Result sheet row','Result sheet column']);nulls.forEach(n=>nullSheet.addRow(n));
    const info=workbook.addWorksheet('Scope');details.forEach(d=>info.addRow([d]));info.addRow(['All non-NULL values are text to preserve precision. SQL NULL cells are listed in SQL NULLs.']);
    const buffer=await workbook.xlsx.writeBuffer();downloadBookingBlob(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`${filename}.xlsx`);return 'Excel workbook downloaded with exact values and NULL metadata.';
  }
  if(rows.length>1000)throw new Error('For PDF or images, choose at most 1,000 rows. Use CSV, JSON or Excel for larger results.');
  const model:BookingExportModel={title:'OmniLodge · Database result',rowLabel:'rows',sheetName:'Results',filename,details,columns:fields.map(f=>({id:f.id,label:f.name,width:180})),rows:rows.map(r=>r.map(v=>({value:v===null?'SQL NULL':v,text:v===null?'⟨NULL⟩':v===''?'⟨empty text⟩':v})))};
  if(format==='copy')return (await copyBookingExportImage(model))==='copied'?'Result image copied to clipboard.':'Clipboard unavailable; the result image was downloaded.';
  await downloadBookingExport(model,format);return `${format.toUpperCase()} downloaded.`;
}
