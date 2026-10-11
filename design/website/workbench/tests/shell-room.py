"""Shell has no scroll; visible stage/controls fit rather than being clipped."""
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    for width,height in [(1920,1080),(1440,900),(1366,768),(1280,720),(1024,768),(768,1024),(390,844),(375,667),(844,390)]:
        page.set_viewport_size({'width':width,'height':height})
        page.goto('http://localhost:4275/#/dashboard')
        page.reload()  # Each viewport starts with an empty lineup.
        page.wait_for_selector('.shell-room')
        page.evaluate('document.fonts.ready')
        page.wait_for_timeout(300)
        assert page.locator('.page-header').count()==0
        assert page.locator('.lobby-slot').count()==3
        geometry=page.locator('#page-content').evaluate('''main=>{
            const room=main.querySelector('.shell-room'); const r=room.getBoundingClientRect();
            return {overflow:getComputedStyle(main).overflow,scrollH:main.scrollHeight,clientH:main.clientHeight,scrollW:main.scrollWidth,clientW:main.clientWidth,
              room:{x:r.x,y:r.y,w:r.width,h:r.height},bad:[...main.querySelectorAll('.lobby-slot,.character-stage,.slot-name,.shell-hud,.shell-battle')].filter(el=>{
                if(!el.getClientRects().length)return false;const b=el.getBoundingClientRect();
                return b.bottom>innerHeight+1||b.top<0||b.right>innerWidth+1||b.left<0||(el.matches('.slot-name') && el.scrollWidth>el.clientWidth+1);
              }).map(el=>el.className)};
        }''')
        assert geometry['overflow']=='clip',geometry
        assert geometry['scrollH']<=geometry['clientH']+1,geometry
        assert geometry['scrollW']<=geometry['clientW']+1,geometry
        assert not geometry['bad'],(width,height,geometry)
        assert geometry['room']=={'x':0,'y':0,'w':width,'h':height},geometry
        targets=page.locator('.character-stage,.shell-battle').evaluate_all('''els=>els.map(el=>{const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return el===hit||el.contains(hit);})''')
        assert all(targets),(width,height,targets)
        page.locator('#page-content').evaluate('(el)=>{el.scrollTop=999;el.scrollLeft=999}')
        page.mouse.move(width-60,height-120)
        page.mouse.wheel(0,600)
        assert page.locator('#page-content').evaluate('(el)=>el.scrollTop')==0
        assert page.evaluate('window.scrollY')==0
        page.locator('.character-stage').nth(0).click()
        page.locator('.picker-options button').filter(has_text='Bulwark').click()
        expect(page.locator('.slot-name').nth(0)).to_have_text('Bulwark')
        page.locator('.shell-battle').click()
        expect(page.locator('.battle-modal')).to_be_visible()
        assert page.url.endswith('#/dashboard')
        page.keyboard.press('Escape')
        expect(page.locator('.battle-modal')).not_to_be_visible()
        expect(page.locator('.shell-battle')).to_be_focused()
        expect(page.locator('.slot-name').nth(0)).to_have_text('Bulwark')
        page.wait_for_selector('.shell-room')
        print('PASS',width,height,'no scroll, controls fit, slot selection, Battle overlay, close and focus return; room=',geometry['room'])
    assert not errors,errors
    browser.close()
