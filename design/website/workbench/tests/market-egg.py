from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:4275/#/market')
    page.get_by_label('Type', exact=True).select_option('Eggs')
    eggs = page.locator('.market-card:visible .market-egg-sprite')
    expect(eggs).to_have_count(4)
    expect(page.locator('.market-card:visible .market-art-placeholder')).to_have_count(0)
    info = eggs.first.evaluate('''async el => {
        const style=getComputedStyle(el), url=style.backgroundImage.slice(5,-2);
        const image=new Image(); image.src=url; await image.decode();
        const animation=el.getAnimations()[0]; animation.pause();
        animation.currentTime=0; const first=getComputedStyle(el).backgroundPositionX;
        animation.currentTime=110; const second=getComputedStyle(el).backgroundPositionX;
        return {source:[image.naturalWidth,image.naturalHeight], size:[el.offsetWidth,el.offsetHeight], first,second,url};
    }''')
    assert info['source']==[192,32] and info['size']==[96,96], info
    assert info['first']!=info['second'], info
    page.emulate_media(reduced_motion='reduce')
    assert eggs.first.evaluate('el=>getComputedStyle(el).animationName')=='none'
    page.get_by_role('button',name='Reset filters').click()
    expect(page.locator('.market-card:visible')).to_have_count(8)
    expect(page.locator('.market-card:visible .market-lobster-art')).to_have_count(6)
    expect(eggs).to_have_count(2)
    expect(page.locator('[data-market-page]')).to_have_text('Page 1 of 2')
    assert not errors, errors
    print('PASS four animated egg sprites, original 192x32 sheet, 96x96 at 3x, frame advance, reduced motion, lobster sprites preserved')
    browser.close()
