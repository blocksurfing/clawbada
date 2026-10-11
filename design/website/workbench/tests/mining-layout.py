"""DOM-only mining verification; visual approval stays with the designer."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    expected = ['Base Mine', 'Evolved Mine', 'Elite Mine', 'Apex Mine']
    rewards = ['1,250 $GOLD', '3,750 $GOLD', '12,500 $GOLD', '31,250 $GOLD']
    for width in [1920, 1440, 1280, 768, 390]:
        page.set_viewport_size({'width': width, 'height': 1080})
        page.goto('http://localhost:4275/#/mining')
        page.wait_for_function('document.querySelectorAll(".mining-card[data-pixel-ready=true]").length === 4')
        page.evaluate('document.fonts.ready')
        page.wait_for_timeout(350)
        assert page.locator('.mine-art-placeholder').count() == 4
        for placeholder in page.locator('.mine-art-placeholder').all():
            assert placeholder.is_visible()
            assert placeholder.evaluate('(el) => { const r=el.getBoundingClientRect(); const title=el.nextElementSibling.getBoundingClientRect(); const parent=el.parentElement.getBoundingClientRect(); return r.height === 144 && r.bottom <= title.top && r.right <= parent.right; }')
        assert page.locator('.mining-card h3').all_text_contents() == expected
        assert page.locator('.mine-reward').all_text_contents() == rewards
        assert page.locator('#page-content img, #page-content [data-pixel-sprite]').count() == 0
        assert page.locator('#page-content button, #page-content a').count() == 0
        data = page.locator('.mining-card').evaluate_all('''cards => cards.map(card => {
            const r = card.getBoundingClientRect();
            const canvas = card.querySelector('canvas');
            return {width:r.width, height:r.height, right:r.right,
                overflow:[...card.querySelectorAll('h3,p,dt,dd')].some(el => {
                    const t = el.getBoundingClientRect();
                    return el.scrollWidth > el.clientWidth + 1 || t.right > r.right + 1 || t.left < r.left - 1;
                }),
                color:getComputedStyle(card).color,
                canvasWidth:canvas.width * 3, canvasHeight:canvas.height * 3};
        })''')
        for card in data:
            assert not card['overflow'], (width, card)
            assert card['right'] <= width + 1, (width, card)
            assert card['width'] % 3 == 0 and card['height'] % 3 == 0, (width, card)
            assert card['width'] == card['canvasWidth'], (width, card)
            assert card['height'] == card['canvasHeight'], (width, card)
            assert card['color'] == 'rgb(255, 244, 214)', (width, card)
        print('PASS', width, 'four cards, reference copy, cream text, 3px sizing, no card overflow')
    page.goto('http://localhost:4275/#/dashboard')
    page.wait_for_selector('.shell-room')
    assert page.locator('.mining-card').count() == 0
    assert page.locator('.page-header').count() == 0
    assert not errors, errors
    print('PASS dashboard isolation and no browser errors')
    browser.close()
