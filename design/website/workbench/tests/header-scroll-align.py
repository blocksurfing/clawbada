from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width':1440,'height':720}, reduced_motion='reduce')
    page.goto('http://127.0.0.1:4275/#/mining', wait_until='networkidle')
    # The current sidebar starts compact.
    page.wait_for_function('!document.querySelector("#toggle").disabled')
    def check(scroll, expected_gap):
        page.locator('#page-content').evaluate('(e,y)=>e.scrollTop=y', scroll)
        page.wait_for_timeout(100)
        r = page.evaluate('''()=>{
            const m=document.querySelector('#page-content'),h=m.querySelector('.page-header').getBoundingClientRect();
            return {gap:h.left-(m.getBoundingClientRect().left+48),y:h.top,scroll:m.scrollTop};
        }''')
        assert r['scroll']==scroll, r
        assert abs(r['gap']-expected_gap)<1, r
        assert r['y']==48-scroll, r
    for scroll,gap in [(0,144),(24,72),(48,0),(96,0),(24,72),(0,144)]:
        check(scroll,gap)
    page.locator('#toggle').click()
    page.wait_for_function('!document.querySelector("#toggle").disabled')
    check(48,0)
    check(0,0)
    print('PASS compact header progressively aligns, scrolls normally, restores at top; expanded unchanged')
    b.close()
