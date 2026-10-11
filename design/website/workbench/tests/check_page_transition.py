from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch()
 page=b.new_page(viewport={'width':1440,'height':1000})
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:4275/#/dashboard',wait_until='networkidle')
 page.evaluate("window.originalSidebar=document.querySelector('.sidebar-shell')")
 page.evaluate("location.hash='/market'")
 page.wait_for_function("document.querySelector('#page-content').dataset.page==='market'")
 assert page.locator('.page-water-wipe').count()==0
 page.wait_for_timeout(250)
 assert page.evaluate("getComputedStyle(document.querySelector('#page-content')).opacity==='1' && !document.querySelector('#page-content').inert && originalSidebar===document.querySelector('.sidebar-shell')")
 page.evaluate("location.hash='/mining'")
 page.wait_for_timeout(30)
 page.evaluate("location.hash='/dojo'")
 page.wait_for_function("document.querySelector('#page-content').dataset.page==='dojo'")
 page.wait_for_timeout(250)
 assert page.evaluate("document.querySelector('#page-content').getAnimations().length===0")
 page.go_back()
 page.wait_for_function("document.querySelector('#page-content').dataset.page==='mining'")
 page.emulate_media(reduced_motion='reduce')
 page.evaluate("location.hash='/dashboard'")
 page.wait_for_function("document.querySelector('#page-content').dataset.page==='dashboard'")
 assert page.evaluate("document.querySelector('#page-content').getAnimations().length===0")
 assert not errors,errors
 print('PASS: simple fade completes; no water overlay; rapid routing/Back/reduced motion; shell retained; no JS errors')
 b.close()
