from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for width in [1280,1920,2560]:
        g=b.new_page(viewport={'width':width,'height':1080})
        errors=[]
        g.on('pageerror',lambda e:errors.append(str(e)))
        g.goto('http://localhost:4275/#/market')
        g.wait_for_selector('.market-card:visible [data-pixel-ready=true]')
        g.wait_for_timeout(500)
        columns=g.locator('.market-grid').evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length')
        assert columns==(4 if width>=1920 else 2),(width,columns)
        for card in g.locator('.market-card:visible').all():
            assert card.evaluate('e=>e.getBoundingClientRect().height')==444
            assert card.locator('.market-buy').evaluate('e=>e.scrollWidth<=e.clientWidth')
            assert card.locator('.market-lobster-art canvas').count()==0 or card.locator('.market-lobster-art canvas').evaluate('e=>e.getBoundingClientRect().width')==192
        assert not errors,errors
        print(width,'PASS',columns,'columns; 444px card height; source scale preserved; no Buy overflow/errors')
        if width==1920:
            g.locator('.market-grid').screenshot(path='/tmp/clawbada-compact-grid.png')
        g.close()
    b.close()
