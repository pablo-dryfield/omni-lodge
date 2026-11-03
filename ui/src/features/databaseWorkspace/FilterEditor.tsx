import { Button,Group,Select,Stack,TextInput,ActionIcon } from '@mantine/core';
import { IconPlus,IconTrash,IconBrackets } from '@tabler/icons-react';
import type { Field,Filter } from './api';
const operators=[['eq','Equals'],['ne','Does not equal'],['gt','Greater than'],['gte','At least'],['lt','Less than'],['lte','At most'],['contains','Contains'],['startsWith','Starts with'],['endsWith','Ends with'],['in','In list'],['isNull','Is SQL NULL'],['notNull','Is not SQL NULL'],['empty','Is empty text']].map(([value,label])=>({value,label}));
export function FilterEditor({fields,value,onChange,depth=0}:{fields:Field[];value:Filter;onChange:(value:Filter)=>void;depth?:number}){
  if('group' in value)return <Stack gap="xs" p="sm" style={{border:'1px solid var(--dw-border)',borderRadius:8}}>
    <Group justify="space-between"><Select aria-label="Match filter group" size="xs" w={145} value={value.group} data={[{value:'and',label:'Match all (AND)'},{value:'or',label:'Match any (OR)'}]} onChange={group=>onChange({...value,group:group==='or'?'or':'and'})} allowDeselect={false}/>
      <Group gap={4}><Button variant="subtle" size="compact-xs" leftSection={<IconPlus size={13}/>} disabled={!fields.length||value.children.length>=20} onClick={()=>onChange({...value,children:[...value.children,{column:fields[0].id,operator:'eq',value:''}]})}>Condition</Button>
      {depth<5&&<Button variant="subtle" size="compact-xs" leftSection={<IconBrackets size={13}/>} onClick={()=>onChange({...value,children:[...value.children,{group:'or',children:[]}]})}>Group</Button>}</Group></Group>
    {value.children.map((child,index)=><Group key={index} wrap="nowrap" align="flex-start"><div style={{flex:1,minWidth:0}}><FilterEditor fields={fields} value={child} depth={depth+1} onChange={next=>onChange({...value,children:value.children.map((c,i)=>i===index?next:c)})}/></div><ActionIcon aria-label={`Remove condition ${index+1}`} variant="subtle" color="gray" onClick={()=>onChange({...value,children:value.children.filter((_,i)=>i!==index)})}><IconTrash size={15}/></ActionIcon></Group>)}
  </Stack>;
  const noValue=['isNull','notNull','empty'].includes(value.operator);
  return <Group gap="xs" align="flex-start" grow>
    <Select aria-label="Filter column" size="xs" value={value.column} data={fields.map(f=>({value:f.id,label:`${f.name} · ${f.pgType} [${Number(f.id.slice(1))+1}]`}))} onChange={column=>onChange({...value,column:column||fields[0].id})} searchable allowDeselect={false}/>
    <Select aria-label="Filter condition" size="xs" value={value.operator} data={operators} onChange={operator=>onChange({...value,operator:operator||'eq',value:operator==='in'?[]:''})} allowDeselect={false}/>
    {!noValue&&<TextInput aria-label="Filter value" size="xs" placeholder={value.operator==='in'?'Comma-separated values':'Value (case-sensitive)'} value={Array.isArray(value.value)?value.value.join(', '):value.value||''} onChange={e=>onChange({...value,value:value.operator==='in'?e.currentTarget.value.split(',').map(v=>v.trim()):e.currentTarget.value})}/>}
  </Group>;
}
