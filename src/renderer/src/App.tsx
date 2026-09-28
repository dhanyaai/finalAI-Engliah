import {useEffect,useRef,useState} from 'react'
import Kitten from '@renderer/components/Kitten'
import VoiceButton from '@renderer/components/VoiceButton'
import ChatInput from '@renderer/components/ChatInput'
import ChatBubbles from '@renderer/components/ChatBubbles'
import {useConversation} from '@renderer/hooks/useConversation'
import {useAcademy} from '@renderer/hooks/useAcademy'
import {courses,defaultProgress,lessonsByLevel,lessonScenesByLevel,catalogLessons,type AgeBand,type LearnerProfile,type Lesson} from '@renderer/data/academy'
import {isWebChatMode} from '@renderer/api-web'
import '@renderer/assets/main.css'

type View='home'|'courses'|'lesson'|'tutor'|'progress'|'parent'|'admin'
const nav:[View,string][]=[['home','Today'],['courses','Courses'],['tutor','Tutor'],['progress','Progress'],['parent','Parent view'],['admin','Studio']]

type AuthUser={email:string}
type AuthState={status:'checking'}|{status:'error';message:string}|{status:'signed-out'}|{status:'signed-in';user:AuthUser}

function App():React.JSX.Element{
 const [auth,setAuth]=useState<AuthState>({status:'checking'})
 const [retryCount,setRetryCount]=useState(0)
 const path=window.location.pathname
 useEffect(()=>{
  let active=true
  fetch('/api/auth/me',{credentials:'same-origin'})
   .then(async response=>{
    if(response.status===401){if(active)setAuth({status:'signed-out'});return}
    if(!response.ok)throw new Error('We couldn’t check your sign-in. Please try again.')
    const data=await response.json() as {email?:unknown}
    if(typeof data.email!=='string')throw new Error('The sign-in service returned an invalid response.')
    if(active)setAuth({status:'signed-in',user:{email:data.email}})
   })
   .catch(error=>{if(active)setAuth({status:'error',message:error instanceof Error?error.message:'We couldn’t check your sign-in. Please try again.'})})
  return()=>{active=false}
 },[retryCount])
 const finishSignIn=(user:AuthUser)=>{window.history.replaceState(null,'','/');setAuth({status:'signed-in',user})}
 const logout=async()=>{
  const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'})
  if(!response.ok){
   const body=await response.json().catch(()=>({})) as {error?:unknown}
   throw new Error(typeof body.error==='string'?body.error:'Could not sign out. Please try again.')
  }
  window.history.replaceState(null,'','/')
  setAuth({status:'signed-out'})
 }
 if(auth.status==='checking')return <main className="auth-page"><p role="status">Checking your secure session…</p></main>
 if(auth.status==='signed-in')return <AcademyApp email={auth.user.email} onLogout={logout}/>
 if(path.startsWith('/sign-in'))return <AuthPage mode={window.location.search.includes('recover=1')?'recover':'signin'} onAuthenticated={finishSignIn} sessionError={auth.status==='error'?auth.message:null}/>
 if(path.startsWith('/sign-up'))return <AuthPage mode="signup" onAuthenticated={finishSignIn} sessionError={auth.status==='error'?auth.message:null}/>
 return <Landing authError={auth.status==='error'?auth.message:null} onRetry={()=>{setAuth({status:'checking'});setRetryCount(count=>count+1)}}/>
}

type AuthFormMode='signin'|'signup'|'recover'
type RecoveryCodeState={purpose:'signup';email:string;code:string}|{purpose:'recover';code:string}

function AuthPage({mode,onAuthenticated,sessionError}:{mode:AuthFormMode;onAuthenticated:(user:AuthUser)=>void;sessionError:string|null}):React.JSX.Element{
 const [formMode,setFormMode]=useState<AuthFormMode>(mode)
 const [email,setEmail]=useState('')
 const [password,setPassword]=useState('')
 const [recoveryCode,setRecoveryCode]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState<string|null>(null)
 const [codeDisplay,setCodeDisplay]=useState<RecoveryCodeState|null>(null)
 const signup=formMode==='signup'
 const recover=formMode==='recover'
 const title=signup?'Create your family account':recover?'Reset your password':'Welcome back, grown-up'
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault()
  setError(null)
  if(password.length<12){setError('Choose a password with at least 12 characters.');return}
  setBusy(true)
  try{
   const response=await fetch(signup?'/api/auth/signup':recover?'/api/auth/recover':'/api/auth/login',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(signup?{email:email.trim(),password}:recover?{email:email.trim(),recoveryCode,newPassword:password}:{email:email.trim(),password})
   })
   if(!response.ok){
    const body=await response.json().catch(()=>({})) as {error?:unknown}
    throw new Error(typeof body.error==='string'?body.error:(signup?'Could not create your account. Please try again.':recover?'Could not reset your password. Check your recovery details and try again.':'Could not sign in. Check your email and password.'))
   }
   const data=await response.json() as {email?:unknown;recoveryCode?:unknown}
   if(signup){
    if(typeof data.email!=='string')throw new Error('The sign-in service returned an invalid response.')
    if(typeof data.recoveryCode!=='string'||!data.recoveryCode.trim())throw new Error('The recovery service returned an invalid code. Please contact support before continuing.')
    setCodeDisplay({purpose:'signup',email:data.email,code:data.recoveryCode})
   }else if(recover){
    if(typeof data.recoveryCode!=='string'||!data.recoveryCode.trim())throw new Error('The recovery service returned an invalid code. Please contact support before continuing.')
    setCodeDisplay({purpose:'recover',code:data.recoveryCode})
   }else{
    if(typeof data.email!=='string')throw new Error('The sign-in service returned an invalid response.')
    onAuthenticated({email:data.email})
   }
  }catch(err){setError(err instanceof Error?err.message:'Could not complete this request. Please try again.')}
  finally{setBusy(false)}
 }
 if(codeDisplay)return <RecoveryCodeStep purpose={codeDisplay.purpose} code={codeDisplay.code} onAcknowledge={()=>{
  if(codeDisplay.purpose==='signup')onAuthenticated({email:codeDisplay.email})
  else{
   setCodeDisplay(null)
   setFormMode('signin')
   setPassword('')
   setRecoveryCode('')
   setError(null)
   window.history.replaceState(null,'','/sign-in')
  }
 }}/>
 return <main className="auth-page">
  <a className="brand" href="/"><span className="brand-mark">H</span> HiKid Academy</a>
  <section className="auth-card" aria-labelledby="auth-title">
   <div className="eyebrow">{signup?'A new chapter starts here':recover?'Account recovery':'Your family learning space'}</div>
   <h1 id="auth-title">{title}</h1>
   <p className="muted">{signup?'One secure account for all your learners.':recover?'Enter your email, recovery code, and a new password.':'Sign in to keep every learner’s progress safe.'}</p>
   {sessionError&&<p className="auth-notice" role="status">{sessionError} You can still try to {signup?'create an account':'sign in'}.</p>}
   <form className="form-grid auth-form" onSubmit={submit}>
    <div className="field"><label htmlFor="auth-email">Email address</label><input id="auth-email" name="email" type="email" autoComplete="email" autoCapitalize="none" required value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/></div>
    {recover&&<div className="field"><label htmlFor="auth-recovery-code">Recovery code</label><input id="auth-recovery-code" name="recoveryCode" type="text" autoComplete="off" autoCapitalize="none" required value={recoveryCode} onChange={event=>setRecoveryCode(event.target.value)} disabled={busy}/></div>}
    <div className="field"><label htmlFor="auth-password">{recover?'New password':'Password'}</label><input id="auth-password" name={recover?'newPassword':'password'} type="password" autoComplete={signup||recover?'new-password':'current-password'} minLength={12} required value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/><span className="muted">Use at least 12 characters.</span></div>
    {formMode==='signin'&&<a className="auth-link" href="/sign-in?recover=1">Forgot password?</a>}
    {error&&<p className="auth-error" role="alert">{error}</p>}
    <button className="btn btn-primary" type="submit" disabled={busy}>{busy?(signup?'Creating account…':recover?'Resetting password…':'Signing in…'):(signup?'Create parent account':recover?'Reset password':'Sign in')}</button>
   </form>
   <p className="auth-switch">{recover?<>Remembered it? <a href="/sign-in">Return to sign in</a></>:signup?'Already have an account?':'New to HiKid?'} {!recover&&<a href={signup?'/sign-in':'/sign-up'}>{signup?'Sign in':'Create an account'}</a>}</p>
  </section>
 </main>
}
function RecoveryCodeStep({purpose,code,onAcknowledge}:{purpose:'signup'|'recover';code:string;onAcknowledge:()=>void}):React.JSX.Element{
 const [saved,setSaved]=useState(false)
 const [copyMessage,setCopyMessage]=useState('')
 const codeInput=useRef<HTMLInputElement>(null)
 const copy=async()=>{
  try{
   if(!navigator.clipboard?.writeText)throw new Error('Clipboard access unavailable')
   await navigator.clipboard.writeText(code)
   setCopyMessage('Recovery code copied.')
  }catch{
   codeInput.current?.focus()
   codeInput.current?.select()
   setCopyMessage('Copy is unavailable here. The recovery code is selected so you can copy it manually.')
  }
 }
 return <main className="auth-page">
  <a className="brand" href="/"><span className="brand-mark">H</span> HiKid Academy</a>
  <section className="auth-card recovery-card" aria-labelledby="recovery-title">
   <div className="eyebrow">{purpose==='signup'?'Save this code now':'Password updated'}</div>
   <h1 id="recovery-title">{purpose==='signup'?'Your recovery code':'Your new recovery code'}</h1>
   <p className="muted">{purpose==='signup'?'Keep this code somewhere private and safe. It is shown only once and is needed if you forget your password.':'Your password has been changed. Save this new code for your next recovery; you will need to sign in again.'}</p>
   <div className="recovery-code-row">
    <label className="sr-only" htmlFor="recovery-code-display">Recovery code</label>
    <input ref={codeInput} id="recovery-code-display" className="recovery-code-input" type="text" value={code} readOnly onFocus={event=>event.currentTarget.select()} autoComplete="off"/>
    <button className="btn btn-quiet" type="button" onClick={copy}>Copy code</button>
   </div>
   <p className="copy-status" role="status" aria-live="polite">{copyMessage}</p>
   <label className="recovery-ack"><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/><span>I’ve saved this code somewhere safe. I understand it will not be shown again.</span></label>
   <button className="btn btn-primary recovery-continue" type="button" disabled={!saved} onClick={onAcknowledge}>{purpose==='signup'?'Continue to HiKid':'Continue to sign in'}</button>
  </section>
 </main>
}
function SignOutButton({onLogout,className=''}:{onLogout:()=>Promise<void>;className?:string}):React.JSX.Element{
 const [pending,setPending]=useState(false)
 const [error,setError]=useState<string|null>(null)
 return <span className={className}><button className="btn btn-quiet" disabled={pending} onClick={async()=>{setPending(true);setError(null);try{await onLogout()}catch(err){setError(err instanceof Error?err.message:'Could not sign out. Please try again.')}finally{setPending(false)}}} type="button">{pending?'Signing out…':'Sign out'}</button>{error&&<span role="alert">{error}</span>}</span>
}
function Startup({state,message,retry}:{state:'checking'|'error';message:string;retry:()=>void}):React.JSX.Element{return <main className="main"><div className="onboarding"><div className="brand"><span className="brand-mark">H</span> HiKid Academy</div><h1>{state==='checking'?'Warming up your studio.':'Let’s get the studio ready.'}</h1><p className="muted">{message}</p>{state==='checking'?<div className="progress"><i style={{width:'58%'}}/></div>:<button className="btn btn-primary" onClick={retry} type="button">Try again</button>}</div></main>}
 function Onboarding({onSave,legacyAvailable,onMigrate}:{onSave:(p:LearnerProfile)=>Promise<void>;legacyAvailable:boolean;onMigrate:()=>Promise<void>}):React.JSX.Element{const [name,setName]=useState('');const [age,setAge]=useState<AgeBand>('9–12');const [level,setLevel]=useState('Pre-A1');const [minutes,setMinutes]=useState(15);const [busy,setBusy]=useState(false);return <main className="main"><div className="onboarding"><div className="eyebrow">A new chapter starts here</div><h1>Add a<br/><span style={{color:'var(--cat)'}}>bright voice.</span></h1><p className="muted">Each learner gets a private profile that syncs to every signed-in device.</p>{legacyAvailable&&<button className="btn btn-quiet" disabled={busy} onClick={async()=>{setBusy(true);await onMigrate().finally(()=>setBusy(false))}} type="button">Bring over progress from this device</button>}<div className="form-grid"><div className="field"><label htmlFor="name">Learner name</label><input id="name" value={name} onChange={e=>setName(e.target.value)} placeholder="What should we call you?" /></div><div className="field"><label>Age band</label><div className="choice-row">{(['5–8','9–12','13–15'] as AgeBand[]).map(x=><button aria-pressed={age===x} type="button" className={`choice ${age===x?'selected':''}`} onClick={()=>setAge(x)} key={x}>{x}</button>)}</div></div><div className="field"><label htmlFor="level">Current English level</label><select id="level" value={level} onChange={e=>setLevel(e.target.value)}>{courses.map(c=><option key={c.level}>{c.level}</option>)}</select></div><div className="field"><label>Daily goal</label><div className="choice-row">{[10,15,20,30].map(x=><button aria-pressed={minutes===x} type="button" className={`choice ${minutes===x?'selected':''}`} onClick={()=>setMinutes(x)} key={x}>{x} min</button>)}</div></div><button className="btn btn-primary" disabled={!name.trim()||busy} onClick={async()=>{setBusy(true);await onSave({name:name.trim(),ageBand:age,level,dailyGoalMinutes:minutes}).finally(()=>setBusy(false))}} type="button">Save learner</button></div></div></main>}
 function Home({name,progress,onLesson}:{name:string;progress:typeof defaultProgress;onLesson:()=>void}):React.JSX.Element{return <div className="grid"><section className="hero"><div className="eyebrow" style={{color:'var(--yellow)'}}>Today’s small win for {name}</div><h2>Your voice gets<br/>brighter every day.</h2><p>One short lesson. One brave try. Let’s make today count.</p><button className="btn btn-primary" onClick={onLesson} type="button">Continue lesson <span>→</span></button></section><div className="stat-row"><div className="card stat"><div><small>Current streak</small><strong>{progress.streak} days</strong></div><span className="pill">On a roll</span></div><div className="card stat"><div><small>Learning time</small><strong>{progress.minutes} min</strong></div><span className="pill">This week</span></div><div className="card stat"><div><small>Next milestone</small><strong>2 lessons</strong></div><span className="pill">Almost there</span></div></div><div className="section-head"><h2>Today’s learning plan</h2><span className="muted">12 minutes</span></div><div className="card lesson-card"><div className="lesson-icon">01</div><div><span className="eyebrow">Speak & listen</span><h3>A brave hello</h3><p className="muted">Introduce yourself and ask one friendly question.</p></div><button className="btn btn-quiet" onClick={onLesson} type="button">Start</button></div></div>}
 function Courses({onLesson}:{onLesson:(level:string)=>void}):React.JSX.Element{return <div><p className="muted">A six-level path from first words to fluent expression. Pick a world to explore.</p><div className="course-grid">{courses.map(c=><article className="card course-card" key={c.level}><div className="course-color" style={{background:c.color}}/><div className="course-body"><span className="pill">{c.level}</span><h3>{c.title}</h3><p className="muted">{c.description}</p>{c.units.map(u=><div className="unit" key={u.id}><span>{u.title}</span><span className="muted">{u.lessons} lessons</span></div>)}<button className="btn btn-quiet" onClick={()=>onLesson(c.level)} type="button">Preview a lesson</button></div></article>)}</div></div>}
 function Lesson({lesson,started,scene,setScene,answer,setAnswer,complete,onTutor,completed}:{lesson:Lesson;started:boolean;scene:number;setScene:(x:number)=>void;answer:string|null;setAnswer:(x:string)=>void;complete:()=>Promise<boolean>;onTutor:()=>void;completed:boolean}):React.JSX.Element{const frames=lessonScenesByLevel[Object.keys(lessonsByLevel).find(k=>lessonsByLevel[k].id===lesson.id)??lesson.courseLevel??'Pre-A1'];const [feedback,setFeedback]=useState(completed?'Lesson already complete. Progress is safe.':'');return <div className="lesson-layout"><div className="section-head"><div><div className="eyebrow">Structured lesson · {lesson.type}</div><h2>{lesson.title}</h2><p className="muted">{lesson.objective}</p></div><span className="pill">{lesson.duration} min</span></div><section className="video"><div className="video-scene"><span className="eyebrow" style={{color:frames[scene].accent}}>Pip’s story · scene {scene+1}</span><h2>{frames[scene].heading}</h2><p>{frames[scene].body}</p><strong>{frames[scene].spokenText}</strong></div><div className="scene-controls"><button className="btn btn-primary" aria-label="Play lesson scene" onClick={()=>setScene((scene+1)%frames.length)} type="button">{started?'Replay scene':'Play scene'}</button><button className="btn btn-light" onClick={()=>setScene(Math.max(0,scene-1))} type="button">Back</button><div className="scene-dots">{frames.map((_,i)=><i className={i===scene?'on':''} key={i}/>)}</div></div></section><div className="lesson-columns"><section className="card"><div className="eyebrow">Words to keep</div><h3>Say it like you mean it.</h3><div className="vocab">{lesson.vocabulary.map(w=><span className="word" key={w}>{w}</span>)}</div>{lesson.transcript&&<details style={{marginTop:18}}><summary>Open transcript</summary><p className="muted">{lesson.transcript}</p></details>}<button className="btn btn-quiet" style={{marginTop:20}} onClick={onTutor} type="button">Practice with Pip</button></section><section className="card"><div className="eyebrow">Quick check</div><h3>{lesson.assessment?.prompt??'Which word belongs in this lesson?'}</h3><div className="quiz-options">{(lesson.assessment?.options??[lesson.vocabulary[0],lesson.vocabulary[1],'perhaps']).map((x,i)=><button aria-pressed={answer===x} className={answer?(x===lesson.assessment?.answer||i===0?'correct':'wrong'):''} onClick={()=>setAnswer(x)} type="button" key={x}>{x}</button>)}</div>{answer&&<p className="muted">{answer===(lesson.assessment?.answer??lesson.vocabulary[0])?'Correct. You spotted the lesson word.':'Good try. Listen once more and choose the first word.'}</p>}</section></div><button className="btn btn-primary" style={{marginTop:18}} disabled={completed} onClick={()=>{if(!completed)complete().then(()=>setFeedback('Lesson complete. Your progress has been updated.')).catch(()=>setFeedback('Progress could not be saved. Please try again.'))}} type="button">{completed?'Completed':'Complete lesson'}</button>{feedback&&<p className="muted" role="status">{feedback}</p>}</div>}
 function Tutor(p:{kittenState:any;isRecording:boolean;isProcessing:boolean;servicesReady:boolean;error:string|null;messages:any[];mode:'press-and-hold'|'vad';start:()=>void;stop:()=>void;interrupt:()=>void;setMode:(x:'press-and-hold'|'vad')=>void;clear:()=>void}):React.JSX.Element{return <div className="grid"><section className="hero"><div className="eyebrow" style={{color:'var(--yellow)'}}>Private speaking studio</div><h2>Talk it out.<br/>I’m listening.</h2><p>Practice at your pace. Pip will keep the conversation friendly and focused.</p><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button aria-pressed={p.mode==='press-and-hold'} className="btn btn-primary" onClick={()=>p.setMode('press-and-hold')} type="button">Hold to speak</button><button aria-pressed={p.mode==='vad'} className="btn btn-light" onClick={()=>p.setMode('vad')} type="button">Auto listen</button></div></section><div className="card" style={{display:'grid',placeItems:'center',gap:12}}><Kitten state={p.kittenState}/>{p.mode==='press-and-hold'?<VoiceButton isRecording={p.isRecording} onPointerDown={p.start} onPointerUp={p.stop} disabled={!p.servicesReady}/>:<div className="vad-indicator"><span className="vad-dot"/><strong>{p.isProcessing?'Thinking…':'Auto listening'}</strong></div>}<span className="muted">{p.isProcessing?'Thinking…':p.isRecording?'Listening…':p.kittenState==='speaking'?'Pip is speaking — hold the mic to interrupt':'Ready when you are'}</span>{(p.isProcessing||p.kittenState==='speaking')&&<button className="btn btn-quiet" onClick={p.interrupt} type="button">Stop</button>}</div>{p.error&&<div className="card" style={{color:'var(--coral)'}}>The studio needs a moment. {p.error}</div>}<div className="card" style={{minHeight:160}}><div className="section-head" style={{margin:0}}><h3>Conversation</h3><button className="btn btn-quiet" onClick={p.clear} type="button">Clear</button></div><ChatBubbles messages={p.messages} visible aiName="Pip"/><ChatInput disabled={!p.servicesReady||p.isProcessing} onSend={t=>{window.api.sendMessage(t).catch(()=>{})}} placeholder="Type to Pip…"/></div></div>}
function Progress({progress}:{progress:typeof defaultProgress}):React.JSX.Element{return <div><div className="hero"><div className="eyebrow" style={{color:'var(--yellow)'}}>Your learning signal</div><h2>Small practice.<br/>Real progress.</h2><p>You have built {progress.minutes} minutes of learning time. Keep the rhythm gentle and steady.</p></div><div className="section-head"><h2>Skill constellation</h2><span className="muted">Updated just now</span></div><div className="card skill-list">{Object.entries(progress.skillScores).map(([k,v])=><div className="skill-line" key={k}><header><span>{k}</span><span>{v}%</span></header><div className="progress"><i style={{width:`${v}%`}}/></div></div>)}</div></div>}
 function Parent({settings,addChild,save,setPin,verifyPin,deleteFamily}:{settings:import('./data/academy').FamilySettings;addChild:()=>void;save:(x:import('./data/academy').FamilySettings)=>Promise<void>;setPin:(x:string)=>Promise<void>;verifyPin:(x:string)=>Promise<boolean>;deleteFamily:()=>Promise<void>}):React.JSX.Element{const [unlocked,setUnlocked]=useState(!settings.hasPin),[pin,setPinValue]=useState(''),[draft,setDraft]=useState(settings),[message,setMessage]=useState('');if(!unlocked)return <div className="onboarding"><div className="eyebrow">Parent check</div><h1>Grown-ups only.</h1><p className="muted">Enter the family PIN to open settings.</p><div className="field"><input aria-label="Parent PIN" inputMode="numeric" type="password" value={pin} onChange={e=>setPinValue(e.target.value.replace(/\D/g,''))}/></div><button className="btn btn-primary" onClick={()=>verifyPin(pin).then(()=>setUnlocked(true)).catch(e=>setMessage(e.message))} type="button">Unlock</button>{message&&<p role="alert">{message}</p>}</div>;return <div className="grid"><div className="hero"><div className="eyebrow" style={{color:'var(--yellow)'}}>A calm view for grown-ups</div><h2>Family controls,<br/>kept private.</h2><p>Manage all learners, learning limits, privacy, and family data in one place.</p><button className="btn btn-light" onClick={addChild} type="button">Add another learner</button></div><div className="lesson-columns"><section className="card"><div className="eyebrow">Parent PIN</div><h3>{settings.hasPin?'Change family PIN':'Create family PIN'}</h3><p className="muted">Use 4–8 digits. The PIN is stored as a one-way hash.</p><input aria-label="New parent PIN" inputMode="numeric" type="password" value={pin} onChange={e=>setPinValue(e.target.value.replace(/\D/g,'').slice(0,8))}/><button className="btn btn-quiet" onClick={()=>setPin(pin).then(()=>setMessage('PIN saved.'))} type="button">Save PIN</button></section><section className="card"><div className="eyebrow">Limits & privacy</div><h3>Learning time</h3><input aria-label="Daily limit" type="range" min="5" max="180" value={draft.dailyLimitMinutes} onChange={e=>setDraft({...draft,dailyLimitMinutes:Number(e.target.value)})} style={{width:'100%'}}/><strong>{draft.dailyLimitMinutes} minutes per day</strong><hr/><label><input type="checkbox" checked={draft.privacySettings.shareAnalytics} onChange={e=>setDraft({...draft,privacySettings:{shareAnalytics:e.target.checked}})}/> Share anonymous learning analytics</label><br/><button className="btn btn-primary" onClick={()=>save(draft).then(()=>setMessage('Settings saved.'))} type="button">Save settings</button></section></div><section className="card danger-zone"><h3>Delete family data</h3><p className="muted">Permanently deletes every child profile, assessment, lesson record, limit, and privacy setting in this account.</p><button className="btn btn-quiet" onClick={()=>{if(confirm('Permanently delete all family learning data? This cannot be undone.'))deleteFamily()}} type="button">Delete all family data</button></section>{message&&<p role="status">{message}</p>}</div>}
function Admin({library,loading,error,review,publish,save}:{library:Lesson[];loading:boolean;error:string|null;review:(id:string,r:{educatorApproved?:boolean;ageSafetyApproved?:boolean})=>Promise<Lesson>;publish:(id:string)=>Promise<Lesson>;save:(lesson:Partial<Lesson>)=>Promise<Lesson>}):React.JSX.Element{
 const [filter,setFilter]=useState('All'); const [busy,setBusy]=useState<string|null>(null); const [editing,setEditing]=useState<Lesson|null>(null); const [message,setMessage]=useState('')
 const states=['All','Published','Approved','In review','Draft']
 const filtered=library.filter(l=>filter==='All'||(filter==='In review'?l.reviewState==='in_review':filter==='Approved'?l.reviewState==='approved':filter.toLowerCase()===l.reviewState))
 const blank:Lesson={id:'',title:'',objective:'',duration:10,type:'Structured practice',status:'Draft',courseLevel:'Pre-A1',unitId:'p1',ageBands:['5–8','9–12','13–15'],vocabulary:[],video:{provider:'mux',assetId:'',playbackUrl:''},transcript:'',subtitles:[],activities:[],assessment:{prompt:'',answer:'',options:[]},review:{educatorApproved:false,ageSafetyApproved:false}}
 const editor=editing&&<div className="card" style={{marginBottom:16}}><div className="section-head" style={{marginTop:0}}><h3>{editing.id?'Edit lesson':'Create lesson'}</h3><button className="btn btn-light" onClick={()=>setEditing(null)} type="button">Close</button></div><div className="form-grid"><div className="field"><label>Title<input value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})}/></label></div><div className="field"><label>Objective<textarea value={editing.objective} onChange={e=>setEditing({...editing,objective:e.target.value})}/></label></div><div className="lesson-columns"><label className="field">Level<select value={editing.courseLevel} onChange={e=>setEditing({...editing,courseLevel:e.target.value})}>{courses.map(c=><option key={c.level}>{c.level}</option>)}</select></label><label className="field">Unit<input value={editing.unitId} onChange={e=>setEditing({...editing,unitId:e.target.value})}/></label></div><label className="field">Age bands<div className="choice-row">{(['5–8','9–12','13–15'] as AgeBand[]).map(b=><button className={`choice ${editing.ageBands?.includes(b)?'selected':''}`} type="button" key={b} onClick={()=>setEditing({...editing,ageBands:editing.ageBands?.includes(b)?editing.ageBands.filter(x=>x!==b):[...(editing.ageBands??[]),b]})}>{b}</button>)}</div></label><div className="lesson-columns"><label className="field">Duration (minutes)<input type="number" min="1" max="180" value={editing.duration} onChange={e=>setEditing({...editing,duration:Number(e.target.value)})}/></label><label className="field">Provider<select value={editing.video?.provider} onChange={e=>setEditing({...editing,video:{...editing.video!,provider:e.target.value as 'mux'|'vimeo'|'youtube'}})}><option value="mux">Mux</option><option value="vimeo">Vimeo</option><option value="youtube">YouTube</option></select></label></div><label className="field">Approved video URL<input type="url" value={editing.video?.playbackUrl??''} placeholder="https://stream.mux.com/..." onChange={e=>setEditing({...editing,video:{...editing.video!,playbackUrl:e.target.value}})}/></label><label className="field">Transcript<textarea value={editing.transcript??''} onChange={e=>setEditing({...editing,transcript:e.target.value})}/></label><label className="field">Vocabulary (comma separated)<input value={editing.vocabulary.join(', ')} onChange={e=>setEditing({...editing,vocabulary:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></label><label className="field">Assessment prompt<input value={editing.assessment?.prompt??''} onChange={e=>setEditing({...editing,assessment:{...editing.assessment!,prompt:e.target.value}})}/></label><button className="btn btn-primary" onClick={()=>{setBusy('save');save(editing).then(()=>{setMessage('Lesson saved.');setEditing(null)}).catch(e=>setMessage(e.message)).finally(()=>setBusy(null))}} disabled={busy==='save'} type="button">Save lesson</button>{message&&<p role="status" className="muted">{message}</p>}</div></div>
 return <div>{editor}<div className="section-head" style={{marginTop:0}}><div><div className="eyebrow">Content operations</div><h2>Reviewed lesson library</h2><p className="muted">Every lesson needs educator and age-safety approval before publishing.</p></div><div><span className="pill">{library.length} lessons</span> <button className="btn btn-primary" onClick={()=>setEditing(blank)} type="button">Create lesson</button></div></div><div className="tabs">{states.map(x=><button className={filter===x?'active':''} onClick={()=>setFilter(x)} type="button" key={x}>{x}</button>)}</div>{error&&<p role="alert" className="muted">{error}</p>}<div className="card">{loading?<p className="muted">Loading catalog…</p>:<table className="admin-table"><thead><tr><th>Content</th><th>Level / ages</th><th>Review</th><th>Actions</th></tr></thead><tbody>{filtered.map(l=><tr key={l.id}><td><button className="btn btn-quiet" onClick={()=>setEditing(l)} type="button"><strong>{l.title}</strong></button><br/><span className="muted">{l.video?.provider.toUpperCase()} · {l.duration} min</span></td><td>{l.courseLevel} · {l.ageBands?.join(', ')}<br/><span className="muted">{l.unitId}</span></td><td><span className="pill">{l.reviewState}</span><br/><span className="muted">{l.review?.educatorApproved?'Educator ✓':'Educator —'} · {l.review?.ageSafetyApproved?'Safety ✓':'Safety —'}</span></td><td style={{display:'flex',gap:6,flexWrap:'wrap'}}>{!l.review?.educatorApproved&&<button className="btn btn-quiet" disabled={busy===l.id} onClick={()=>{setBusy(l.id);review(l.id,{educatorApproved:true}).finally(()=>setBusy(null))}} type="button">Educator approve</button>}{!l.review?.ageSafetyApproved&&<button className="btn btn-quiet" disabled={busy===l.id} onClick={()=>{setBusy(l.id);review(l.id,{ageSafetyApproved:true}).finally(()=>setBusy(null))}} type="button">Safety approve</button>}{l.review?.educatorApproved&&l.review?.ageSafetyApproved&&l.reviewState!=='published'&&<button className="btn btn-primary" disabled={busy===l.id} onClick={()=>{setBusy(l.id);publish(l.id).finally(()=>setBusy(null))}} type="button">Publish</button>}</td></tr>)}</tbody></table>}</div></div>}
export default App

function Landing({authError,onRetry}:{authError:string|null;onRetry:()=>void}):React.JSX.Element{return <main className="landing"><div className="brand"><span className="brand-mark">H</span> HiKid Academy</div>{authError&&<div className="card auth-notice" role="alert"><p>{authError}</p><button className="btn btn-quiet" onClick={onRetry} type="button">Try again</button></div>}<section className="hero"><div className="eyebrow" style={{color:'var(--yellow)'}}>Learning that follows them</div><h2>Every child’s progress,<br/>safe on every device.</h2><p>Create one parent account, add each learner, and keep lessons, goals, and privacy choices together.</p><div className="auth-actions"><a className="btn btn-primary" href="/sign-up">Create parent account</a><a className="btn btn-light" href="/sign-in">Sign in</a></div></section></main>}

function AcademyApp({email,onLogout}:{email:string;onLogout:()=>Promise<void>}):React.JSX.Element{
 const academy=useAcademy(); const [view,setView]=useState<View>('home'); const [onboard,setOnboard]=useState(false)
 const [lessonStarted,setLessonStarted]=useState(false); const [selectedLesson,setSelectedLesson]=useState<Lesson|null>(null); const [scene,setScene]=useState(0); const [answer,setAnswer]=useState<string|null>(null)
 const [startup,setStartup]=useState<'checking'|'ready'|'error'>(isWebChatMode()?'ready':'checking'); const [startupMessage,setStartupMessage]=useState('Preparing your learning studio…')
 const {kittenState,isRecording,isProcessing,messages,servicesReady,error,mode,startRecording,stopRecording,interrupt,setMode,clearMessages}=useConversation()
  useEffect(()=>{academy.loadLibrary()},[academy.loadLibrary])
  useEffect(()=>{if(isWebChatMode()){window.api.startServices().catch(()=>{});return}let alive=true;const fail=(message:string)=>{if(alive){setStartup('error');setStartupMessage(message)}};const unsub=window.api.onServiceStatus(status=>{if(status.ready&&alive)setStartup('ready')});(async()=>{try{setStartupMessage('Checking learning services…');const deps=await window.api.checkDependencies();if(!deps.sox||!deps.espeakNg){fail('A required audio service is missing.');return}setStartupMessage('Checking the local language model…');const models=await window.api.checkModels();if(!models.exists){fail('The local language model is not installed yet.');return}setStartupMessage('Starting Kitten’s studio…');await window.api.startServices()}catch(err){fail(err instanceof Error?err.message:String(err))}})();return()=>{alive=false;unsub()}},[])
 const name=academy.profile?.name||'learner'
 const go=(v:View)=>setView(v)
  const openLesson=(level:string)=>{setSelectedLesson(catalogLessons.find(l=>l.courseLevel===level)??lessonsByLevel[level]??lessonsByLevel['Pre-A1']);setScene(0);setAnswer(null);setLessonStarted(true);setView('lesson')}
 const profileLevel=academy.profile?.level??'Pre-A1'
 if(startup!=='ready'||academy.loading)return <Startup state="checking" message={academy.loading?'Loading your family’s progress…':startupMessage} retry={()=>{setStartup('checking');window.api.startServices().catch(err=>{setStartup('error');setStartupMessage(err instanceof Error?err.message:String(err))})}}/>
 if(academy.error)return <main className="main"><div className="onboarding"><h1>We couldn’t load your family.</h1><p className="muted">{academy.error}</p><button className="btn btn-primary" onClick={()=>location.reload()} type="button">Try again</button></div></main>
 if(onboard||!academy.profile)return <Onboarding legacyAvailable={academy.legacyAvailable} onMigrate={academy.migrate} onSave={async(p)=>{await academy.createChild(p);setOnboard(false)}}/>
 return <div className="app-shell">
   <nav className="nav"><div className="brand"><span className="brand-mark">H</span> HiKid Academy</div><div className="nav-label">Your learning world</div><div className="nav-list">{nav.map(([id,label])=><button aria-current={view===id?'page':undefined} className={view===id?'active':''} onClick={()=>go(id)} key={id} type="button">{label}</button>)}</div><div className="nav-footer"><span>{email}</span><br/>Progress is safely synced.<br/><SignOutButton onLogout={onLogout}/></div></nav>
   <main className="main"><div className="topbar"><div><div className="eyebrow">HiKid Academy / {view}</div><h1>{view==='home'?`Good to see you, ${name}.`:nav.find(n=>n[0]===view)?.[1]}</h1></div><label className="profile-chip"><span className="avatar">{name.slice(0,1).toUpperCase()}</span><select aria-label="Active learner" value={academy.activeId??''} onChange={e=>academy.setActiveId(e.target.value)}>{academy.children.map(child=><option value={child.id} key={child.id}>{child.profile.name} · {child.profile.level}</option>)}</select></label><SignOutButton className="mobile-signout" onLogout={onLogout}/></div>
   {view==='home'&&<Home name={name} progress={academy.progress} onLesson={()=>openLesson(profileLevel)}/>}
   {view==='courses'&&<Courses onLesson={openLesson}/>}
    {view==='lesson'&&selectedLesson&&<Lesson lesson={selectedLesson} started={lessonStarted} scene={scene} setScene={setScene} answer={answer} setAnswer={setAnswer} complete={()=>academy.completeLesson(selectedLesson.id,selectedLesson.duration,answer===selectedLesson.vocabulary[0]?100:0)} onTutor={()=>setView('tutor')} completed={academy.progress.completedLessonIds.includes(selectedLesson.id)}/>}
   {view==='tutor'&&<Tutor kittenState={kittenState} isRecording={isRecording} isProcessing={isProcessing} servicesReady={servicesReady} error={error} messages={messages} mode={mode} start={startRecording} stop={stopRecording} interrupt={interrupt} setMode={setMode} clear={clearMessages}/>}
   {view==='progress'&&<Progress progress={academy.progress}/>}
    {view==='parent'&&<Parent settings={academy.settings} addChild={()=>setOnboard(true)} save={academy.saveSettings} setPin={academy.setPin} verifyPin={academy.verifyPin} deleteFamily={academy.deleteFamily}/>}
    {view==='admin'&&<Admin library={academy.library} loading={academy.libraryLoading} error={academy.libraryError} review={academy.reviewLesson} publish={academy.publishLesson} save={academy.saveLesson}/>}
  </main>
 </div>
}
