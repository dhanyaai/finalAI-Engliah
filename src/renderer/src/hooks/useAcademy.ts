import {useCallback,useEffect,useMemo,useState} from 'react'
import {defaultProgress,type ChildRecord,type FamilySettings,type LearnerProfile,type Progress} from '@renderer/data/academy'

const PROFILE='hikid-academy-profile',PROGRESS='hikid-academy-progress',LIMIT='hikid-daily-limit'
const emptySettings:FamilySettings={dailyLimitMinutes:20,privacySettings:{shareAnalytics:false},hasPin:false}
function localData():{profile:LearnerProfile;progress:Progress;dailyLimitMinutes:number}|null{try{const raw=localStorage.getItem(PROFILE);if(!raw)return null;const profile=JSON.parse(raw) as LearnerProfile;const progressRaw=localStorage.getItem(PROGRESS);const parsed=progressRaw?JSON.parse(progressRaw) as Partial<Progress>:{};return{profile,progress:{...defaultProgress,...parsed,skillScores:{...defaultProgress.skillScores,...parsed.skillScores},assessments:Array.isArray(parsed.assessments)?parsed.assessments:[]},dailyLimitMinutes:Number(localStorage.getItem(LIMIT))||20}}catch{return null}}
async function api(path:string,options?:RequestInit){const response=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...options?.headers},...options});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'Request failed')}return response.status===204?null:response.json()}
export function useAcademy(){
 const [children,setChildren]=useState<ChildRecord[]>([]),[activeId,setActiveId]=useState<string|null>(null),[settings,setSettings]=useState<FamilySettings>(emptySettings),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[legacy]=useState(localData)
 const reload=useCallback(async()=>{setLoading(true);setError(null);try{const data=await api('/api/family') as {children:ChildRecord[];settings:FamilySettings};setChildren(data.children);setSettings(data.settings);setActiveId(id=>data.children.some(c=>c.id===id)?id:data.children[0]?.id??null)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setLoading(false)}},[])
 useEffect(()=>{reload()},[reload])
 const active=useMemo(()=>children.find(c=>c.id===activeId)??null,[children,activeId])
 const createChild=async(p:LearnerProfile)=>{await api('/api/family/children',{method:'POST',body:JSON.stringify(p)});await reload()}
 const migrate=async()=>{if(!legacy)return;await api('/api/family/migrate',{method:'POST',body:JSON.stringify(legacy)});localStorage.removeItem(PROFILE);localStorage.removeItem(PROGRESS);localStorage.removeItem(LIMIT);await reload()}
 const completeLesson=async(id:string,duration=12,score=0)=>{if(!active||active.progress.completedLessonIds.includes(id))return false;await api(`/api/family/children/${active.id}/lessons/${encodeURIComponent(id)}/complete`,{method:'POST',body:JSON.stringify({duration,score})});await reload();return true}
 const saveSettings=async(next:FamilySettings)=>{await api('/api/family/settings',{method:'PUT',body:JSON.stringify(next)});setSettings(next)}
 const setPin=async(pin:string)=>{await api('/api/family/pin',{method:'PUT',body:JSON.stringify({pin})});setSettings(s=>({...s,hasPin:true}))}
 const verifyPin=async(pin:string)=>{await api('/api/family/pin/verify',{method:'POST',body:JSON.stringify({pin})});return true}
 const deleteFamily=async()=>{await api('/api/family',{method:'DELETE'});setChildren([]);setActiveId(null);setSettings(emptySettings)}
 return{children,activeId,setActiveId,profile:active?.profile??null,progress:active?.progress??defaultProgress,settings,loading,error,legacyAvailable:Boolean(legacy)&&children.length===0,createChild,migrate,completeLesson,saveSettings,setPin,verifyPin,deleteFamily}
}