import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { performance } from 'node:perf_hooks';
const phase=process.argv[2]||'before';const info=JSON.parse(await fs.readFile('work/perf-browser-session.json','utf8'));
const authSource=await fs.readFile('src/lib/auth-api.js','utf8');
const key=authSource.match(/TOKEN_KEY\s*=\s*['"]([^'"]+)/)?.[1]||'daylight.auth.token';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const samples=[];
try{
 for(const action of ['login_captcha','workspace'])for(let i=0;i<5;i++){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  if(action==='workspace')await context.addInitScript(({key,token})=>localStorage.setItem(key,token),{key,token:info.token});
  const page=await context.newPage();const errors=[];page.on('pageerror',()=>errors.push('pageerror'));
  const start=performance.now();let success=false;
  try{
   await page.goto('https://daylight.yunforis.com'+(action==='workspace'?'/app':'/login'),{waitUntil:'domcontentloaded',timeout:90000});
   if(action==='workspace'){
    await page.waitForFunction(()=>!document.body.innerText.includes('正在加载工作区')&&document.querySelector('a[href="/app/calendar"]'),{timeout:90000});
   }else await page.waitForFunction(()=>Boolean(document.querySelector('svg[viewBox="0 0 120 40"]')||[...document.querySelectorAll('svg')].some(e=>e.getAttribute('width')==='120')||document.querySelector('img[src^="data:image/svg"]')),{timeout:90000});
   success=true;
  }catch(error){errors.push(error.name);}
  const ms=performance.now()-start;
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({kind:r.name.includes('/api/')?'api':r.name.includes('/assets/')?'asset':'other',ms:r.duration,transferBytes:r.transferSize,decodedBytes:r.decodedBodySize}))).catch(()=>[]);
  samples.push({action,i,ms,success,errors,resourceCount:resources.length,transferBytes:resources.reduce((a,r)=>a+r.transferBytes,0),resources});
  console.log(JSON.stringify({phase,action,i,ms,success,errors}));await context.close();
 }
 await fs.writeFile('work/perf-browser-'+phase+'.json',JSON.stringify({phase,note:'Windows Edge headless 390px fresh browser context each run, actual public HTTPS; temporary authorized session for workspace, no password/captcha login timed',samples},null,2));
}finally{await browser.close();}
