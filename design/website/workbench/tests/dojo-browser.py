from playwright.sync_api import sync_playwright
from pathlib import Path
import json
BASE='http://127.0.0.1:4275/'
with sync_playwright() as p:
 b=p.chromium.launch(); page=b.new_page(); errors=[]; results=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 def load(query=''):
  page.goto(BASE+query+'#/dojo'); page.locator('#web-loading').wait_for(state='hidden',timeout=30000); page.wait_for_function("document.querySelectorAll('[data-fighter] canvas').length===6"); page.wait_for_timeout(350)
 def measure(label):
  page.wait_for_timeout(300)  # Shared pixel-grid ResizeObserver settles after tab/sidebar changes.
  r=page.evaluate('''()=>{const main=document.querySelector('#page-content'); const cards=[...document.querySelectorAll('.dojo-card')].filter(e=>e.getClientRects().length);return {main:[main.clientHeight,main.scrollHeight],doc:[document.documentElement.clientHeight,document.documentElement.scrollHeight],spills:cards.flatMap(c=>[...c.querySelectorAll('button,select')].filter(e=>e.getClientRects().length).filter(e=>{const a=e.getBoundingClientRect(),b=c.getBoundingClientRect();return a.bottom>b.bottom+1||a.right>b.right+1||a.left<b.left-1||a.top<b.top-1}).map(e=>e.outerHTML.slice(0,100))),scale:[...document.querySelectorAll('[data-fighter] canvas')].filter(e=>e.getClientRects().length&&!e.hidden).map(e=>({x:e.getBoundingClientRect().width/e.width,y:e.getBoundingClientRect().height/e.height})),above:cards.every(c=>c.parentElement.querySelector('[data-lineup]').getBoundingClientRect().bottom<=c.getBoundingClientRect().top+1)}}''')
  r['label']=label; results.append(r)
  assert r['main'][0]==r['main'][1] and r['doc'][0]==r['doc'][1],r
  assert not r['spills'] and r['above'],r
  assert all(abs(s['x']-4)<.01 and abs(s['y']-4)<.01 for s in r['scale']),r
  obstructed=page.locator('.dojo-card button,.dojo-card select').evaluate_all('''els=>els.filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit!==e&&!e.contains(hit)}).map(e=>e.textContent.trim())''')
  assert not obstructed,(label,obstructed)
  if not page.locator('[data-train]').is_visible():
   assert page.viewport_size['width']<700 and page.locator('.dojo-cards').get_attribute('data-active-panel')=='team'
   return
  battle=page.locator('[data-train]').evaluate('''e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e),x=parseFloat(s.backgroundPositionX)||0,y=parseFloat(s.backgroundPositionY)||0;return {left:b.left+x+11*3,top:b.top+y+12*3,right:b.left+x+67*3,bottom:b.top+y+68*3,width:b.width,height:b.height,bg:s.backgroundSize,vw:innerWidth,vh:innerHeight}}''')
  assert battle['left']>=0 and battle['top']>=0 and battle['right']<=battle['vw'] and battle['bottom']<=battle['vh'],battle
  assert battle['bg']=='240px 240px' and battle['width']>=168 and battle['height']>=168,battle
 for w,h in [(1920,980),(1280,648),(1440,900),(390,844)]:
  page.set_viewport_size({'width':w,'height':h});load()
  for toggle in ([False,True] if w>699 else [False]):
   if toggle: page.locator('#toggle').click();page.wait_for_timeout(1800)
   measure(f'{w}x{h}-toggle{toggle}-owned')
   page.screenshot(path=f'/tmp/dojo-parent-{w}-{toggle}.png')
   assert page.locator('[data-team-mode=owned]').get_attribute('aria-selected')=='true'
   assert page.locator('[data-fighter]').count()==6
   assert page.locator('[data-fighter]').evaluate_all('(els)=>els.every(e=>!e.closest(".dojo-card"))')
   page.locator('[data-team-mode=builder]').click()
   page.locator('[data-builder-slot="2"]').select_option('Sentinel')
   assert page.locator('[data-fighter=team][data-slot="2"] canvas').get_attribute('data-class')=='Sentinel'
   assert page.locator('[data-fighter=opponent][data-slot="2"] canvas').get_attribute('data-class')=='Sentinel'
   measure(f'{w}-toggle{toggle}-builder')
   page.locator('[data-team-mode=owned]').click()
  if w<699:
   page.locator('[data-dojo-panel=opponent]').click();measure('mobile-opponent');page.locator('[data-bot]').select_option('Deep');page.locator('[data-choice=opponent][data-value="Random classes"]').click();page.screenshot(path='/tmp/dojo-parent-mobile-opponent.png')
 page.set_viewport_size({'width':1280,'height':648});load()
 page.locator('[data-owned-id="101"]').click()
 assert page.locator('[data-fighter=team] canvas:not([hidden])').count()==2
 for _ in range(6):
  if page.locator('[data-owned-id="104"]').is_visible(): break
  page.locator('[data-inventory-next]').click()
 page.locator('[data-owned-id="104"]').click()
 assert page.locator('[data-fighter=team][data-slot="2"] canvas').get_attribute('data-class')=='Bulwark'
 page.locator('[data-owned-id="104"]').click()
 assert page.locator('[data-fighter=team] canvas:not([hidden])').count()==2
 assert page.locator('[data-train]').is_disabled()
 page.locator('[data-owned-id="104"]').click()
 names=page.locator('[data-fighter=team] canvas:not([hidden])').evaluate_all('(els)=>els.map(e=>e.dataset.class)');assert len(set(names))==3,names
 page.locator('[data-train]').click();page.locator('.dojo-dialog').wait_for(state='visible');page.locator('[data-end-preview]').click()
 load('?dojoState=empty');assert page.locator('[data-empty-message]').is_visible();assert page.locator('[data-train]').is_disabled();page.locator('[data-team-mode=builder]').click();assert page.locator('[data-train]').is_enabled()
 load('?dojoState=disconnected');page.locator('[data-train]').click();assert 'Preview connected' in page.locator('[data-dojo-status]').text_content()
 load('?dojoState=error');page.locator('[data-train]').click();page.wait_for_timeout(800);assert 'Could not start' in page.locator('[data-dojo-status]').text_content()
 page.goto(BASE+'#/dashboard');page.wait_for_timeout(300);assert page.locator('.dojo-arena').count()==0
 assert not errors,errors
 Path('/tmp/dojo-parent-results.json').write_text(json.dumps(results,indent=2));print('PASS layout,4x-selected,lineups,inventoryswap,buildermirror,mobilepanels,Battle,empty,disconnected,error,cleanup; no JS errors')
 b.close()
