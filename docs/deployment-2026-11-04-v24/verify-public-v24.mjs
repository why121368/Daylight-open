import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TOUR_CHAPTERS } from '../../src/lib/experience-tour.js';
const origin='https://daylight.yunforis.com';
const out='work/experience-tour';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();
const errors=[], results=[], assets=[];
page.on('pageerror', e=>errors.push(e.message));
try {
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    for (const id of ['todos','mail','traces','jobs']) {
      const chapter=TOUR_CHAPTERS.find(c=>c.id===id);
      await page.goto(origin+'/experience?view='+id,{waitUntil:'networkidle'});
      await page.getByRole('heading',{name:chapter.title,exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const img=page.locator('figure img');
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(img=>img.decode());
      assert.equal(await img.getAttribute('src'),chapter.images[0].preview);
      assert.ok((await img.getAttribute('srcset')).includes(chapter.images[0].src));
      await page.getByRole('button',{name:'放大查看：'+chapter.images[0].label,exact:true}).click();
      const dialog=page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await dialog.locator('img').getAttribute('src'),chapter.images[0].src);
      await dialog.locator('img').evaluate(img=>img.decode());
      await page.keyboard.press('Escape');
      if(width===1440 || width===390) await page.screenshot({path:`${out}/public-v24-${id}-${width}.png`,fullPage:true});
      results.push({id,width,layout:true,correctImage:true,zoom:true});
    }
  }
  for(const id of ['todos','mail','traces','jobs']) for(const suffix of ['','-1280']) {
    const name=id+suffix+'.webp';
    const r=await fetch(origin+'/experience/'+name);assert.equal(r.status,200);
    assert.match(r.headers.get('content-type'),/image\/webp/);
    const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest(Buffer.from(await r.arrayBuffer())),digest(await fs.readFile('public/experience/'+name)));
    assets.push(name);
  }
  assert.deepEqual(errors,[]);
  const result={ok:true,results,assets,errors};
  await fs.writeFile(out+'/public-ui-v24.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await browser.close();}
