import { useMemo,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon,Alert,Badge,Button,Drawer,Group,Menu,Modal,Select,Stack,Text,Textarea,Tooltip } from '@mantine/core';
import { IconCopy,IconDownload,IconFilter,IconRefresh,IconShare,IconX } from '@tabler/icons-react';
import { MantineReactTable,useMantineReactTable,type MRT_ColumnDef,type MRT_PaginationState,type MRT_SortingState,type MRT_RowSelectionState } from 'mantine-react-table';
import { api,message,type Field,type Filter,type Job,type WireValue } from './api';
import { FilterEditor } from './FilterEditor';
import { exportResult,type ExportFormat } from './resultExport';

type GridRow=Record<string,WireValue>;
export function ResultGrid({job,index,canExport}:{job:Job;index:number;canExport:boolean}){
  const manifest=job.outcomes[index]?.result;
  const [pagination,setPagination]=useState<MRT_PaginationState>({pageIndex:0,pageSize:200});
  const [sorting,setSorting]=useState<MRT_SortingState>([]),[selection,setSelection]=useState<MRT_RowSelectionState>({});
  const [filter,setFilter]=useState<Filter>(),[draft,setDraft]=useState<Filter>({group:'and',children:[]}),[filtersOpen,setFiltersOpen]=useState(false);
  const [cell,setCell]=useState<{field:Field;value:WireValue}>(),[scope,setScope]=useState('page'),[exportOpen,setExportOpen]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const sort=sorting.map(s=>({column:s.id,direction:s.desc?'desc':'asc',nulls:'last'}));
  const result=useQuery({queryKey:['database-workspace-result',job.id,index,pagination,sorting,filter],queryFn:()=>api.result(job.id,index,{page:pagination.pageIndex,pageSize:pagination.pageSize,sort,filter}),enabled:Boolean(manifest),gcTime:60000,staleTime:60000,retry:false});
  const fields=useMemo(()=>result.data?.fields||manifest?.fields||[],[result.data?.fields,manifest?.fields]);
  const data=useMemo(()=>result.data?.rows.map(row=>Object.fromEntries(result.data!.fields.map((f,i)=>[f.id,row[i]])))||[],[result.data]);
  const columns=useMemo<MRT_ColumnDef<GridRow>[]>(()=>fields.map(field=>({id:field.id,accessorKey:field.id,header:field.name||'(unnamed)',size:175,minSize:90,
    Header:()=> <div><Text size="xs" fw={650}>{field.name||'(unnamed)'}</Text><Text size="10px" c="dimmed">{field.pgType}</Text></div>,
    Cell:({cell})=>{const raw=cell.getValue<WireValue>();return <button type="button" onClick={()=>setCell({field,value:raw})} style={{border:0,background:'transparent',color:raw===null?'var(--mantine-color-dimmed)':'inherit',textAlign:'inherit',fontFamily:'ui-monospace,Consolas,monospace',fontSize:12,padding:0,maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer'}} aria-label={`Inspect ${field.name} value`}>{raw===null?<em>NULL</em>:raw===''?<span style={{color:'#8993a2'}}>empty</span>:raw.slice(0,512)}</button>;},
  })),[fields]);
  const table=useMantineReactTable({columns,data,manualPagination:true,manualSorting:true,manualFiltering:true,rowCount:result.data?.filteredRows||0,
    enableColumnFilters:false,enableGlobalFilter:false,enableMultiSort:true,enableColumnPinning:true,enableColumnResizing:true,enableColumnOrdering:true,enableHiding:true,enableStickyHeader:true,enableRowSelection:true,enableColumnActions:true,
    onPaginationChange:updater=>{setPagination(updater);setSelection({});},onSortingChange:updater=>{setSorting(updater);setSelection({});setPagination(p=>({...p,pageIndex:0}));},onRowSelectionChange:setSelection,
    state:{pagination,sorting,rowSelection:selection,isLoading:result.isLoading,showProgressBars:result.isFetching},initialState:{density:'xs'},
    mantinePaperProps:{withBorder:false,shadow:undefined},mantineTableProps:{striped:true,highlightOnHover:true,withColumnBorders:true,'aria-label':'SQL query results'},mantineTableContainerProps:{style:{maxHeight:'calc(100dvh - 365px)',minHeight:160}},
    mantineTableHeadCellProps:{style:{verticalAlign:'middle'}},mantineTableBodyCellProps:{style:{verticalAlign:'middle'}},mantinePaginationProps:{rowsPerPageOptions:['50','100','200','500']},
    renderTopToolbarCustomActions:()=> <Group gap={5} wrap="wrap"><Badge variant="light" color="gray" size="sm">{result.data?.filteredRows??0} matching</Badge><Button size="compact-xs" variant={filter?'light':'subtle'} leftSection={<IconFilter size={13}/>} onClick={()=>{setDraft(filter||{group:'and',children:[]});setFiltersOpen(true);}}>Filters{filter?' applied':''}</Button>{filter&&<ActionIcon size="xs" variant="subtle" aria-label="Clear result filters" onClick={()=>setFilter(undefined)}><IconX size={12}/></ActionIcon>}<Tooltip label="Export or copy result data"><ActionIcon variant="subtle" aria-label="Export result data" disabled={!canExport} onClick={()=>setExportOpen(true)}><IconDownload size={16}/></ActionIcon></Tooltip><ActionIcon variant="subtle" aria-label="Refresh captured result" onClick={()=>void result.refetch()}><IconRefresh size={14}/></ActionIcon></Group>,
    renderBottomToolbarCustomActions:()=> <Text size="10px" c="dimmed">{manifest?.complete?'Complete capture':'Limited capture'} · {manifest?.capturedRows.toLocaleString()} rows · filtered over captured data</Text>,
    renderEmptyRowsFallback:()=> <Text size="sm" c="dimmed" p="lg" ta="center">No rows match these conditions.</Text>,
  });
  async function runExport(format:ExportFormat){
    setBusy(true);setNotice('');
    try{
      const visible=table.getVisibleLeafColumns().filter(c=>fields.some(f=>f.id===c.id));
      const exportFields=visible.map(c=>fields.find(f=>f.id===c.id)!);
      const getRows=(rows:WireValue[][])=>rows.map(row=>exportFields.map(f=>row[fields.findIndex(x=>x.id===f.id)]));
      let rows:WireValue[][]=[];
      if(scope==='all'){
        for(let page=0;;page++){const batch=await api.result(job.id,index,{page,pageSize:500,sort,filter});rows.push(...getRows(batch.rows));if(rows.length>=batch.filteredRows||!batch.rows.length)break;}
      }else if(scope==='selected')rows=table.getSelectedRowModel().rows.map(r=>exportFields.map(f=>r.original[f.id]));
      else rows=getRows(result.data?.rows||[]);
      setNotice(await exportResult(exportFields,rows,format,[`Execution ${job.id}`,`Connection ${job.targetId}`,`Scope: ${scope==='all'?'all filtered captured rows':scope==='selected'?'selected rows on this page':'current page'}`,`Transaction: ${job.transactionOutcome}`,`Capture ${manifest?.complete?'complete':'limited'}; ${manifest?.capturedRows} captured rows`,`Generated ${new Date().toISOString()}`]));
    }catch(error){setNotice(message(error));}finally{setBusy(false);}
  }
  return <div className="dw-table-region">
    {result.error&&<Alert color="red" title="Result unavailable">{message(result.error)}</Alert>}
    <MantineReactTable table={table}/>
    <Drawer opened={filtersOpen} onClose={()=>setFiltersOpen(false)} title="Filter captured results" position="right" size="lg">
      <Stack><Text size="xs" c="dimmed">These conditions search the captured result, including hidden columns. Text matching is case-sensitive. They do not rerun the SQL.</Text><FilterEditor fields={fields} value={draft} onChange={setDraft}/><Group justify="flex-end"><Button variant="default" onClick={()=>{setFilter(undefined);setFiltersOpen(false);}}>Clear</Button><Button onClick={()=>{setFilter('group' in draft&&!draft.children.length?undefined:draft);setPagination(p=>({...p,pageIndex:0}));setSelection({});setFiltersOpen(false);}}>Apply filters</Button></Group></Stack>
    </Drawer>
    <Drawer opened={Boolean(cell)} onClose={()=>setCell(undefined)} title={cell?`${cell.field.name} · ${cell.field.pgType}`:'Value'} position="right" size="lg">
      {cell&&<Stack><Badge variant="light" color={cell.value===null?'gray':'blue'}>{cell.value===null?'SQL NULL':cell.value===''?'Empty text':'Exact PostgreSQL text'}</Badge><Textarea aria-label="Exact cell value" value={cell.value===null?'SQL NULL':cell.value} readOnly autosize minRows={8} maxRows={28} styles={{input:{fontFamily:'ui-monospace,monospace',fontSize:12}}}/><Button variant="light" leftSection={<IconCopy size={15}/>} disabled={cell.value===null} onClick={()=>void navigator.clipboard.writeText(cell.value||'').then(()=>setNotice('Exact value copied.')).catch(()=>setNotice('Clipboard access was unavailable.'))}>Copy exact value</Button></Stack>}
    </Drawer>
    <Modal opened={exportOpen} onClose={()=>!busy&&setExportOpen(false)} title="Export captured results" centered size="md">
      <Stack><Text size="sm">Only visible columns are included. Exports preserve the current filter and sort. This action does not rerun SQL.</Text><Select label="Rows" value={scope} onChange={v=>setScope(v||'page')} allowDeselect={false} data={[{value:'page',label:'Current page'},{value:'selected',label:'Selected rows on this page'},{value:'all',label:'All filtered captured rows'}]}/><Text size="xs" c="dimmed">{manifest?.capturedRows} rows captured · {manifest?.complete?'complete result':'capture limit reached; database may contain more'}</Text>
      <Group><Menu><Menu.Target><Button leftSection={<IconDownload size={15}/>} loading={busy}>Download</Button></Menu.Target><Menu.Dropdown>{(['csv','json','xlsx','sql','pdf','png'] as ExportFormat[]).map(format=><Menu.Item key={format} onClick={()=>void runExport(format)}>{format.toUpperCase()}</Menu.Item>)}</Menu.Dropdown></Menu><Button variant="light" leftSection={<IconShare size={15}/>} disabled={busy} onClick={()=>void runExport('copy')}>Copy image</Button></Group>
      {notice&&<Alert color="blue" role="status">{notice}</Alert>}</Stack>
    </Modal>
    {!exportOpen&&notice&&<div className="dw-sr-only" role="status">{notice}</div>}
  </div>;
}
