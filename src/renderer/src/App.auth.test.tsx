/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const response=(status:number,body?:unknown)=>({
 status,
 ok:status>=200&&status<300,
 json:vi.fn().mockResolvedValue(body)
})

beforeEach(()=>{
 window.history.replaceState(null,'','/')
 vi.stubGlobal('fetch',vi.fn())
})
afterEach(()=>{
 cleanup()
 vi.unstubAllGlobals()
 window.history.replaceState(null,'','/')
})

describe('self-hosted account screens',()=>{
 it('keeps the landing page public when no session exists',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(response(401) as unknown as Response)
  render(<App/>)
  expect((await screen.findByRole('link',{name:'Create parent account'})).getAttribute('href')).toBe('/sign-up')
  expect(screen.getByRole('link',{name:'Sign in'}).getAttribute('href')).toBe('/sign-in')
  expect(fetch).toHaveBeenCalledWith('/api/auth/me',{credentials:'same-origin'})
 })

 it('requires a 12-character signup password and reports API errors accessibly',async()=>{
  window.history.replaceState(null,'','/sign-up')
  vi.mocked(fetch)
   .mockResolvedValueOnce(response(401) as unknown as Response)
   .mockResolvedValueOnce(response(409,{error:'An account already exists for that email.'}) as unknown as Response)
  render(<App/>)
  const email=await screen.findByLabelText('Email address')
  const password=screen.getByLabelText('Password')
  expect((password as HTMLInputElement).minLength).toBe(12)
  fireEvent.change(email,{target:{value:'parent@example.com'}})
  fireEvent.change(password,{target:{value:'a-secure-passphrase'}})
  fireEvent.click(screen.getByRole('button',{name:'Create parent account'}))
  expect((await screen.findByRole('alert')).textContent).toContain('An account already exists for that email.')
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2))
  expect(fetch).toHaveBeenLastCalledWith('/api/auth/signup',{
   method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:'parent@example.com',password:'a-secure-passphrase'})
  })
 })

 it('shows the signup recovery code and blocks continuing until it is acknowledged',async()=>{
  window.history.replaceState(null,'','/sign-up')
  vi.mocked(fetch)
   .mockResolvedValueOnce(response(401) as unknown as Response)
   .mockResolvedValueOnce(response(201,{email:'parent@example.com',recoveryCode:'one-time-code'}) as unknown as Response)
  render(<App/>)
  fireEvent.change(await screen.findByLabelText('Email address'),{target:{value:'parent@example.com'}})
  fireEvent.change(screen.getByLabelText('Password'),{target:{value:'a-secure-passphrase'}})
  fireEvent.click(screen.getByRole('button',{name:'Create parent account'}))
  expect(await screen.findByRole('heading',{name:'Your recovery code'})).toBeTruthy()
  expect((screen.getByLabelText('Recovery code') as HTMLInputElement).value).toBe('one-time-code')
  expect(screen.getByRole('button',{name:'Copy code'})).toBeTruthy()
  const continueButton=screen.getByRole('button',{name:'Continue to HiKid'})
  expect((continueButton as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(/I’ve saved this code/))
  expect((continueButton as HTMLButtonElement).disabled).toBe(false)
 })

 it('rotates recovery code and returns to sign-in without logging in',async()=>{
  window.history.replaceState(null,'','/sign-in?recover=1')
  vi.mocked(fetch)
   .mockResolvedValueOnce(response(401) as unknown as Response)
   .mockResolvedValueOnce(response(200,{recoveryCode:'rotated-code'}) as unknown as Response)
  render(<App/>)
  fireEvent.change(await screen.findByLabelText('Email address'),{target:{value:'parent@example.com'}})
  fireEvent.change(screen.getByLabelText('Recovery code'),{target:{value:'old-code'}})
  fireEvent.change(screen.getByLabelText('New password'),{target:{value:'a-new-secure-passphrase'}})
  fireEvent.click(screen.getByRole('button',{name:'Reset password'}))
  expect(await screen.findByRole('heading',{name:'Your new recovery code'})).toBeTruthy()
  expect((screen.getByLabelText('Recovery code') as HTMLInputElement).value).toBe('rotated-code')
  const continueButton=screen.getByRole('button',{name:'Continue to sign in'})
  expect((continueButton as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(/I’ve saved this code/))
  fireEvent.click(continueButton)
  expect(await screen.findByRole('heading',{name:'Welcome back, grown-up'})).toBeTruthy()
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch).toHaveBeenLastCalledWith('/api/auth/recover',{
   method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:'parent@example.com',recoveryCode:'old-code',newPassword:'a-new-secure-passphrase'})
  })
 })
})