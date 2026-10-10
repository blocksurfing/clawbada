from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width':1440,'height':1080}, reduced_motion='reduce')
    page.goto('http://127.0.0.1:4275', wait_until='networkidle')
    page.wait_for_function('!document.querySelector("#toggle").disabled')
    for fraction in (0.02, 0.5, 0.98, 0.02, 0.5, 0.98):
        pole = page.locator('#sidebar-pole').bounding_box()
        toggle = page.locator('#toggle').bounding_box()
        assert toggle == pole, (toggle, pole)
        before = page.locator('#toggle').get_attribute('aria-expanded')
        page.mouse.click(pole['x']+pole['width']*fraction, pole['y']+pole['height']-6)
        page.wait_for_function('(before)=>!document.querySelector("#toggle").disabled && document.querySelector("#toggle").getAttribute("aria-expanded")!==before',arg=before)
    print('PASS: full pole hitbox; left/middle/right toggle in both modes')
    browser.close()
