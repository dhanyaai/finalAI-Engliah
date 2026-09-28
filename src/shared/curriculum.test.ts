import {describe,expect,it} from 'vitest'
import {canPublishLesson,isApprovedVideoUrl,validateCurriculumInput} from './curriculum'

describe('curriculum input validation',()=>{
 const base={title:'Hello',objective:'Say hello',level:'A1',unitId:'a1',ageBands:['5–8'],video:{provider:'mux',playbackUrl:'https://stream.mux.com/asset.m3u8'}}
 it('requires age bands',()=>expect(validateCurriculumInput({...base,ageBands:[]})).toContain('age band'))
 it('requires provider and host agreement',()=>{
  expect(isApprovedVideoUrl('mux','https://player.vimeo.com/video/1')).toBe(false)
  expect(isApprovedVideoUrl('vimeo','https://player.vimeo.com/video/1')).toBe(true)
  expect(validateCurriculumInput({...base,video:{provider:'youtube',playbackUrl:base.video.playbackUrl}})).toContain('approved')
 })
 it('rejects insecure or unapproved media URLs',()=>{
  expect(isApprovedVideoUrl('mux','http://stream.mux.com/asset')).toBe(false)
  expect(isApprovedVideoUrl('mux','https://example.com/asset')).toBe(false)
 })
 it('accepts complete lesson input',()=>expect(validateCurriculumInput(base)).toBeNull())
 it('requires both independent approvals to publish',()=>{
  expect(canPublishLesson({educatorApproved:true,ageSafetyApproved:false})).toBe(false)
  expect(canPublishLesson({educatorApproved:false,ageSafetyApproved:true})).toBe(false)
  expect(canPublishLesson({educatorApproved:true,ageSafetyApproved:true})).toBe(true)
 })
})