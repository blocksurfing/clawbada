from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(1920,1080),(1366,768),(390,844),(844,390)]:
        page = browser.new_page(viewport={'width':width,'height':height}, reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://localhost:4275/#/dashboard')
        main=page.locator('#page-content')
        assert main.get_by_role('button',name='Arena',exact=True).count()==0
        expect(main.locator('.shell-tabs button')).to_have_text(['Queue','Active','History'])
        battle=main.locator('.shell-battle')
        expect(battle).to_be_disabled()
        slot=main.locator('.lobby-slot').first
        slot.focus()
        page.keyboard.press('Enter')
        main.locator('button[data-class=Bulwark]').click()
        expect(slot.locator('.slot-name')).to_have_text('Bulwark')
        page.wait_for_function('document.querySelector(".stage-lighting").dataset.phase === "on"')
        expect(battle).to_be_enabled()
        assert main.locator('.shell-tabs').evaluate('nav => { const a=nav.getBoundingClientRect(), b=document.querySelector(".shell-battle").getBoundingClientRect(); return a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top; }'), 'tabs overlap Battle'
        original=slot.locator('.character-stage').bounding_box()
        for view in ['Queue', 'Active', 'History']:
            tab=main.get_by_role('button',name=view,exact=True)
            tab.click()
            expect(tab).to_be_focused()
            expect(tab).to_have_attribute('aria-expanded','true')
            expect(battle).to_be_visible()
            expect(slot).to_be_visible()
            expect(main.locator('.stage-lighting').first).to_be_visible()
            panel=main.get_by_role('region',name=view,exact=True)
            expect(panel).to_be_visible()
            expect(panel).to_contain_text('Not connected')
            rect=panel.bounding_box()
            assert rect['x']>=0 and rect['y']>=0 and rect['x']+rect['width']<=width+1 and rect['y']+rect['height']<=height+1,rect
            assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            assert main.locator('.shell-room').bounding_box()=={'x':0,'y':0,'width':width,'height':height}
            assert main.locator('[data-shell-layer="shell"]').evaluate('e=>getComputedStyle(e).backgroundImage')!='none'
            assert page.evaluate('document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth')
        tab.click()
        expect(panel).not_to_be_visible()
        expect(tab).to_have_attribute('aria-expanded','false')
        page.keyboard.press('Home')
        expect(main.get_by_role('button',name='Queue',exact=True)).to_be_focused()
        expect(slot.locator('.slot-name')).to_have_text('Bulwark')
        expect(battle).to_be_visible()
        expect(main.locator('.stage-lighting').first).to_be_visible()
        assert slot.locator('.character-stage').bounding_box()==original
        battle.click()
        modal=page.locator('.battle-modal')
        expect(modal).to_be_visible()
        assert page.url.endswith('#/dashboard')
        assert modal.locator('.battle-tabs,[role=tab],[id^=practice-],.lobby-slot,.lobster-picker').count()==0
        assert 'Practice' not in modal.inner_text()
        expect(modal.get_by_role('button',name='Find Match')).to_be_disabled()
        expect(modal).to_contain_text('Not connected')
        assert modal.locator('select').count()==1
        modal.locator('#battle-arena').select_option('elite')
        assert modal.locator('#battle-arena').input_value()=='elite'
        rect=modal.bounding_box()
        assert rect['x']>=0 and rect['y']>=0 and rect['x']+rect['width']<=width+1 and rect['y']+rect['height']<=height+1,rect
        assert modal.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        page.keyboard.press('Escape')
        expect(modal).not_to_be_visible()
        expect(battle).to_be_focused()
        expect(slot.locator('.slot-name')).to_have_text('Bulwark')
        slot.focus()
        page.keyboard.press('Enter')
        main.locator('.picker-clear').click()
        expect(battle).to_be_disabled()
        page.evaluate("location.hash='/dojo'")
        expect(main).to_have_attribute('data-page','dojo')
        expect(main.locator('.page-title')).to_have_text('Dojo')
        assert main.locator('.shell-tabs,.shell-records,.battle-lobby').count()==0
        assert not errors,errors
        print('PASS',width,height,'tabs, keyboard, selection, beams, background, bounds, modal, clear, Dojo; no JS errors')
        page.close()
    # Exercise real opening/closing slides as well as the reduced-motion checks above.
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.goto('http://localhost:4275/#/dashboard')
    page.wait_for_selector('.shell-room')
    for view in ['queue','active','history']:
        button=page.locator(f'[data-shell-tab={view}]')
        panel=page.locator(f'#shell-{view}')
        for opening in [True,False]:
            motion=button.evaluate("""button => {
                button.click();
                const panel=document.getElementById(button.getAttribute('aria-controls'));
                const animation=panel.getAnimations()[0];
                return {duration:animation.effect.getTiming().duration,
                    frames:animation.effect.getKeyframes().map(f=>f.transform), inert:panel.inert};
            }""")
            assert motion['duration']==220,motion
            assert motion['frames']==(['translateX(48px)','translateX(0px)'] if opening else ['translateX(0px)','translateX(48px)']),motion
            assert motion['inert']==(not opening),motion
            page.wait_for_function('(id)=>document.getElementById(id).getAnimations().length===0',arg=f'shell-{view}')
            expect(button).to_have_attribute('aria-expanded',str(opening).lower())
            assert panel.is_visible()==opening
            expect(page.locator('.shell-lineup')).to_be_visible()
            expect(page.locator('.shell-battle')).to_be_visible()
        button.click()
        page.keyboard.press('Escape')
        expect(panel).not_to_be_visible()
        expect(button).to_be_focused()
    print('PASS all three overlay slides open/close, Escape, inert state and persistent basecamp')
    page.close()
    page=browser.new_page()
    page.goto('http://localhost:4275/#/battle')
    expect(page.locator('.battle-modal')).to_be_visible()
    assert page.url.endswith('#/dashboard')
    print('PASS legacy Battle URL opens setup overlay on Shell')
    browser.close()
