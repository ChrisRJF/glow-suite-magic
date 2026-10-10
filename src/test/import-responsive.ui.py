import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path('/tmp/browser/import-responsive');ROOT.mkdir(parents=True,exist_ok=True)
MOCKS={
'/src/contexts/AuthContext.tsx':'const user={id:"synthetic-user",email:"test@example.invalid"};export const useAuth=()=>({user});',
'/src/hooks/useUserRole.ts':'export const useUserRole=()=>({roles:["admin"],isOwner:false,isAdmin:true,loading:false});',
'/src/hooks/useSupabaseData.ts':'const x={data:[],loading:false,refetch:async()=>{}}; export const useSettings=()=>x,useCustomers=()=>x,useAppointments=()=>x,useServices=()=>x;',
'/src/hooks/useCrud.ts':'export const useCrud=()=>({insert:async()=>{},update:async()=>{}});',
'/src/contexts/SubscriptionStateContext.tsx':'export const useSubscriptionState=()=>({isReadOnly:false});',
'/src/components/AppSidebar.tsx':'export const AppSidebar=()=>null;',
'/src/components/MobileTopbar.tsx':'export const MobileTopbar=()=>null;',
'/src/components/TrialBanner.tsx':'export const TrialBanner=()=>null,ReadOnlyBanner=()=>null,PastDueBanner=()=>null;',
'/src/components/demo/DemoGuidanceReset.tsx':'export const DemoGuidanceReset=()=>null;',
'/src/components/OnboardingWizard.tsx':'export const OnboardingWizard=()=>null;',
'/src/integrations/supabase/client.ts':'''let uid=0;const db={}; function q(t){let op='select',payload,single=false;const b=new Proxy({}, {get(_,k){if(k==='then')return (a,z)=>{let data=db[t]||[];if(op==='insert'){data=(Array.isArray(payload)?payload:[payload]).map(r=>({id:'fake-'+(++uid),created_at:new Date().toISOString(),...r}));(db[t]??=[]).push(...data);}if(op==='update') data=[];return Promise.resolve({data:single?(data[0]||null):data,error:null,count:0}).then(a,z)};return (...args)=>{if(k==='insert'||k==='update'){op=k;payload=args[0]}if(k==='single'||k==='maybeSingle')single=true;return b}}});return b}export const supabase={from:q,rpc:async()=>({data:{demo:false,preview:false,import:false},error:null}),functions:{invoke:async()=>({data:null,error:null})}};'''
}
import re,urllib.request
router=re.search(r'from "([^"]*react-router-dom[^"]*)"',urllib.request.urlopen('http://localhost:8080/src/components/ImportWizard.tsx').read().decode()).group(1)
HTML='''<!doctype html><html class="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {MemoryRouter} from '/node_modules/.vite/deps/react-router-dom.js?v=24f010a3';const {default:Page}=await import('/src/pages/InstellingenPage.tsx');import '/src/index.css';ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(Page)));</script></body></html>'''.replace('/node_modules/.vite/deps/react-router-dom.js?v=24f010a3',router)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  context=await browser.new_context(viewport={"width":1280,"height":1800})
  page=await context.new_page();errors=[];blocked=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  async def route(r):
   from urllib.parse import urlparse
   u=urlparse(r.request.url)
   if u.hostname!='localhost':
    blocked.append(u.hostname);await r.abort();return
   if u.path=='/':await r.fulfill(content_type='text/html',body=HTML)
   elif u.path in MOCKS:await r.fulfill(content_type='application/javascript',body=MOCKS[u.path])
   else:await r.continue_()
  await page.route('**/*',route)
  for width in [320,375,390,430,768,1440]:
   await page.set_viewport_size({'width':width,'height':1800})
   await page.goto('http://localhost:8080/',wait_until='networkidle')
   assert not errors
   await page.get_by_role('button',name='Gegevens importeren',exact=True).evaluate('(e)=>e.parentElement.scrollLeft=e.offsetLeft')
   await page.get_by_role('button',name='Gegevens importeren',exact=True).click()
   assert await page.get_by_role('button',name='Opslaan',exact=True).count()==0
   async def check(step):
    await page.wait_for_timeout(150)
    metrics=await page.evaluate('''()=>({body:document.documentElement.scrollWidth,width:innerWidth,panels:[...document.querySelectorAll('table')].map(t=>({width:t.parentElement.clientWidth,scroll:t.parentElement.scrollWidth,overflow:getComputedStyle(t.parentElement).overflowX})),active:[...document.querySelectorAll('[aria-current="step"]')].map(e=>{let a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1})})''')
    assert metrics['body']<=width, (width,step,metrics)
    assert all(metrics['active']), (width,step,'active step outside strip')
    assert all(x['overflow']=='auto' for x in metrics['panels'])
    await page.screenshot(path=str(ROOT/f'{width}-step-{step}.png'))
    print(width,step,json.dumps(metrics))
    for button in await page.locator('.glass-card button').all():
     if await button.is_visible() and not await button.evaluate('(e)=>Boolean(e.closest("table"))'):
      box=await button.bounding_box();assert box and box['x']>=0 and box['x']+box['width']<=width+1,(width,step,'button outside viewport')
   await check(0)
   async with page.expect_file_chooser() as fc:
    await page.get_by_role('button',name='CSV of XLSX kiezen').click()
   await (await fc.value).set_files({'name':'synthetisch_'+('langebestandsnaam'*8)+'.csv','mimeType':'text/csv','buffer':b'naam,email,telefoon\nFictieve Klant,test@example.invalid,0612345678'})
   await page.get_by_role('button',name='Volgende',exact=True).wait_for();await check(1)
   await page.get_by_role('combobox').click(); await page.get_by_role('option',name='Salonized',exact=True).click()
   await page.get_by_role('button',name='Volgende',exact=True).click();await check(2)
   await page.get_by_role('button',name='Auto-detecteer kolommen').click();await check(3)
   trigger=page.get_by_role('combobox').last
   await trigger.evaluate('(e)=>e.parentElement.parentElement.parentElement.parentElement.parentElement.scrollLeft=1000')
   await trigger.click()
   box=await page.get_by_role('listbox').bounding_box();assert box and box['x']>=0 and box['x']+box['width']<=width+1
   await page.get_by_role('option',name='telefoon',exact=True).click()
   await page.get_by_role('button',name='Preview',exact=True).click();await check(4)
   await page.get_by_role('checkbox').check()
   await page.get_by_role('button',name='Importeer 1 nieuwe',exact=True).click()
   await page.wait_for_timeout(150)
   await page.get_by_role('button',name='Nieuwe import',exact=True).wait_for();await check(5)
   await page.get_by_role('button',name='Salon',exact=True).click()
   assert await page.get_by_role('button',name='Opslaan',exact=True).is_visible()
  print('ERRORS',errors);assert not errors
  print('External requests blocked:',len(blocked))
  await browser.close()
asyncio.run(main())
