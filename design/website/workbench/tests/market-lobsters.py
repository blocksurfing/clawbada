from playwright.sync_api import sync_playwright, expect

classes=['Bulwark','Mantis','Leviathan','Tempest','Specter','Sentinel','Reaver','Abyss','Kraken','Ember']
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://localhost:4275/#/market')
    expect(page.locator('.market-lobster-art')).to_have_count(8)
    expect(page.locator('.market-art-placeholder')).to_have_count(0)
    registry=page.evaluate('''async () => {
      const {pixelAssets}=await import('/pixel-assets.js');
      return await Promise.all(['Base','Evolved','Elite','Apex'].map(async tier=>{
        const a=pixelAssets['market'+tier]; const img=new Image(); img.src=a.src; await img.decode();
        return {tier,url:a.src,w:img.naturalWidth,h:img.naturalHeight,frame:a.frame};
      }));
    }''')
    assert len(registry)==4
    for entry in registry:
        assert entry['w']==640 and entry['h']==64 and entry['frame']==[64,64],entry
    for width in [1920,1440,768,390]:
        page.set_viewport_size({'width':width,'height':1080})
        page.get_by_label('Type',exact=True).select_option('Lobsters')
        expect(page.locator('.market-card:visible')).to_have_count(8)
        expect(page.get_by_role('button', name='Next')).to_be_disabled()
        page.wait_for_timeout(250)
        for card in page.locator('.market-card:visible').all():
            sprite=card.locator('.market-lobster-art > [data-pixel-sprite]')
            name=sprite.get_attribute('aria-label')
            klass,tier=name.split()
            expect(sprite).to_have_attribute('data-pixel-sprite','market'+tier)
            expect(sprite).to_have_attribute('data-frame',str(classes.index(klass)))
            dims=sprite.evaluate('e=>{const r=e.getBoundingClientRect(),p=e.closest("article").getBoundingClientRect(),c=e.querySelector("canvas");return [r.width,r.height,r.left>=p.left,r.right<=p.right,c.width,c.height,c.getContext("2d").getImageData(0,0,64,64).data.some((v,i)=>i%4===3&&v>0)]}')
            assert dims==[192,192,True,True,64,64,True],(name,dims)
        page.get_by_role('button',name='Reset filters').click()
        page.get_by_role('button',name='Next').click()
        expect(page.locator('.market-card:visible')).to_have_count(4)
        expect(page.locator('[data-market-page]')).to_have_text('Page 2 of 2')
        page.get_by_role('button',name='Reset filters').click()
    assert not errors,errors
    print('PASS 4 source sheets / 40 class-tier frames registered; 8 lobster listings mapped and painted at 3x; 4 viewports, pagination/reset, no browser errors')
    browser.close()
