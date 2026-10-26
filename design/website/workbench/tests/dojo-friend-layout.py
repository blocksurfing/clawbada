from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page()
 def check(label):
  page.wait_for_timeout(300)
  bad=page.locator('[data-side=opponent] .dojo-card').evaluate('''c=>{const b=c.getBoundingClientRect();return [...c.querySelectorAll('button,input,select,p,summary')].filter(e=>e.checkVisibility()).filter(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.bottom>b.bottom||r.right>b.right||r.left<b.left||(!e.contains(hit)&&e!==hit)}).map(e=>e.outerHTML)}''')
  assert not bad,(label,bad)
 for w,h in [(1920,980),(1440,900),(1280,648),(390,844)]:
  page.set_viewport_size({'width':w,'height':h});page.goto('http://127.0.0.1:4275/#/dojo');page.locator('#web-loading').wait_for(state='hidden')
  if w<700:page.locator('[data-dojo-panel=opponent]').click()
  check(f'{w}-bot')
  page.locator('[data-opponent-mode=friend]').click();page.locator('[data-create-room]').click();check(f'{w}-waiting')
  page.locator('[data-join-input]').fill('bad');page.locator('[data-join-room]').click();check(f'{w}-invalid')
  page.locator('[data-join-input]').fill('DEMO-ABC123');page.locator('[data-join-room]').click();check(f'{w}-joined')
  page.screenshot(path=f'/tmp/dojo-friend-layout-{w}.png')
  if w<700:
   assert page.locator('[data-train]').is_visible()
   page.locator('[data-train]').click();page.locator('.dojo-dialog').wait_for(state='visible');page.locator('[data-close-preview]').click()
   page.locator('[data-room-options] summary').click()
   assert not page.locator('[data-train]').is_visible()
   check('mobile-room-options')
   page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
   page.locator('[data-copy-room]').click()
   page.wait_for_function("document.querySelector('[data-share-status]').textContent.includes('copied')")
   check('mobile-copy-feedback')
   page.screenshot(path='/tmp/dojo-friend-mobile-options.png')
   page.locator('[data-room-options] summary').click()
   page.set_viewport_size({'width':1440,'height':900})
   page.wait_for_timeout(400)
   assert page.locator('[data-create-room]').is_visible(), 'Desktop resize must restore room controls'
   check('mobile-to-desktop')
 print('PASS bot/friend control containment and hit targets at 1920x980, 1440x900, 1280x648, 390x844')
 b.close()
