from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for value,direction in [(0.25,'right'),(0.75,'left')]:
        for width,height in [(1920,1080),(390,844)]:
            page=b.new_page(viewport={'width':width,'height':height})
            page.add_init_script(f'Math.random=()=>{value}')
            page.goto('http://localhost:4275/#/dashboard')
            shark=page.locator('.shell-shark')
            shark.wait_for(state='visible')
            r=shark.evaluate('''el=>({direction:el.dataset.direction,start:+el.dataset.start,end:+el.dataset.end,w:el.offsetWidth,z:getComputedStyle(el).zIndex,first:el.parentElement.firstElementChild===el,frames:el.getAnimations()[0].effect.getKeyframes().map(f=>f.transform),url:getComputedStyle(el.firstElementChild).backgroundImage.slice(5,-2)})''')
            assert r['direction']==direction and r['first'] and r['z']=='0',r
            assert min(r['start'],r['end'])>=width*.09
            assert max(r['start'],r['end'])+r['w']<=width*.91
            assert (r['end']>r['start'])==(direction=='right')
            assert page.request.get(r['url']).status==200
            shark.evaluate('el=>el.getAnimations()[0].finish()')
            page.wait_for_function('document.querySelector(".shell-shark").hidden')
            shark.wait_for(state='visible',timeout=11000)
            page.emulate_media(reduced_motion='reduce')
            shark.wait_for(state='hidden')
            page.evaluate('location.hash="/mining"')
            page.wait_for_function('!document.querySelector(".shell-shark")')
            print('PASS',direction,width,height,'inset spawn, one-way pass, respawn, reduced motion, cleanup')
            page.close()
    b.close()
