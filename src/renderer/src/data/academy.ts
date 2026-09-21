export type AgeBand='5–8'|'9–12'|'13–15'
export interface LearnerProfile{name:string;ageBand:AgeBand;level:string;dailyGoalMinutes:number}
export interface Unit{id:string;title:string;lessons:number}
export interface Course{level:string;title:string;description:string;units:Unit[];lessonCount:number;color:string}
export interface Lesson{id:string;title:string;objective:string;duration:number;type:string;status:string;vocabulary:string[]}
export interface Assessment{lessonId:string;score:number;completedAt:string}
export interface Progress{completedLessonIds:string[];minutes:number;streak:number;skillScores:Record<string,number>;assessments:Assessment[]}
export interface ChildRecord{id:string;profile:LearnerProfile;progress:Progress}
export interface FamilySettings{dailyLimitMinutes:number;privacySettings:{shareAnalytics:boolean};hasPin:boolean}
export interface VideoScene{heading:string;body:string;spokenText:string;accent:string}
export const courses:Course[]=[
 {level:'Pre-A1',title:'First Words',description:'Build a bright foundation for everyday English.',color:'#ff9b8b',lessonCount:18,units:[{id:'p1',title:'Hello, world',lessons:6},{id:'p2',title:'My little day',lessons:6},{id:'p3',title:'Play and move',lessons:6}]},
 {level:'A1',title:'Everyday Explorer',description:'Say what you mean in simple, confident English.',color:'#ffd36e',lessonCount:24,units:[{id:'a1',title:'Meet and greet',lessons:8},{id:'a2',title:'Home base',lessons:8},{id:'a3',title:'Out and about',lessons:8}]},
 {level:'A2',title:'Story Starter',description:'Tell stories, ask questions and connect ideas.',color:'#bcefe0',lessonCount:30,units:[{id:'b1',title:'Small adventures',lessons:10},{id:'b2',title:'Food lab',lessons:10},{id:'b3',title:'The big idea',lessons:10}]},
 {level:'B1',title:'World Builder',description:'Handle real conversations with a stronger voice.',color:'#a99aff',lessonCount:36,units:[{id:'c1',title:'City signals',lessons:12},{id:'c2',title:'Make it happen',lessons:12},{id:'c3',title:'Point of view',lessons:12}]},
 {level:'B2',title:'Idea Studio',description:'Explore nuance, debate and creative expression.',color:'#ffb8d0',lessonCount:42,units:[{id:'d1',title:'The bigger picture',lessons:14},{id:'d2',title:'Culture club',lessons:14},{id:'d3',title:'Future voices',lessons:14}]},
 {level:'C1',title:'Fluent Orbit',description:'Shape precise, natural English for any room.',color:'#86d4ec',lessonCount:48,units:[{id:'e1',title:'Elegant arguments',lessons:16},{id:'e2',title:'Deep listening',lessons:16},{id:'e3',title:'Your signature',lessons:16}]}
]
export const sampleLesson:Lesson={id:'hello-01',title:'A brave hello',objective:'Introduce yourself and ask one friendly question.',duration:12,type:'Speak & listen',status:'Ready',vocabulary:['hello','name','today','friend']}
export const lessonsByLevel:Record<string,Lesson>={
 'Pre-A1':{id:'pre-a1-hello',title:'Hello, little world',objective:'Say hello and name three familiar things.',duration:10,type:'Listen & say',status:'Ready',vocabulary:['hello','cat','blue','bye']},
 A1:{id:'a1-weather',title:'What is the weather like?',objective:'Describe today’s weather with a complete sentence.',duration:12,type:'Speak & listen',status:'Ready',vocabulary:['sunny','cloudy','today','outside']},
 A2:{id:'a2-story',title:'The lost map',objective:'Retell a short adventure using past tense verbs.',duration:15,type:'Story lab',status:'Ready',vocabulary:['found','followed','across','finally']},
 B1:{id:'b1-city',title:'Signals in the city',objective:'Ask for directions and clarify a detail politely.',duration:18,type:'Real-world English',status:'Ready',vocabulary:['intersection','straight ahead','nearby','Could you repeat that?']},
 B2:{id:'b2-ideas',title:'Make the case',objective:'Give an opinion, support it, and respond to another view.',duration:20,type:'Debate studio',status:'Ready',vocabulary:['although','evidence','argue','perspective']},
 C1:{id:'c1-signature',title:'A voice of your own',objective:'Shape a nuanced point with precise, natural English.',duration:22,type:'Fluency studio',status:'Ready',vocabulary:['subtle','compelling','whereas','in essence']}
}
export const lessonScenesByLevel:Record<string,VideoScene[]>=Object.fromEntries(Object.entries(lessonsByLevel).map(([level,lesson])=>[level,[
 {heading:lesson.title,body:`Pip opens a small challenge in ${level}. Watch the idea take shape, then make it yours.`,spokenText:lesson.vocabulary[0],accent:courses.find(c=>c.level===level)?.color??'#ff7b68'},
 {heading:'Notice the useful pattern.',body:lesson.objective,spokenText:lesson.vocabulary.slice(0,2).join(' · '),accent:'#ffd36e'},
 {heading:'Your turn to lead.',body:'Say it once slowly, then once with your own style.',spokenText:lesson.vocabulary.slice(-2).join(' · '),accent:'#bcefe0'}
]]))
export const scenes:VideoScene[]=[
 {heading:'A hello can open a door.',body:'Meet Pip, our curious guide. Watch how one small phrase starts a real conversation.',spokenText:'Hello! My name is Pip.',accent:'#ff7b68'},
 {heading:'Your turn, bright spark.',body:'Say the phrase slowly. Let your voice travel all the way to the end.',spokenText:'Hello! My name is Pip. What is your name?',accent:'#ffd36e'},
 {heading:'Listen for the question.',body:'A friendly question keeps the conversation moving. Notice the rising sound at the end.',spokenText:'What is your name?',accent:'#bcefe0'}
]
export const defaultProgress:Progress={completedLessonIds:[],minutes:0,streak:0,skillScores:{Speaking:34,Listening:51,Reading:28,Writing:22,Vocabulary:63,Grammar:39},assessments:[]}