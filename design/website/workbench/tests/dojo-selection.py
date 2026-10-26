from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:4275/#/dojo')
    page.locator('#web-loading').wait_for(state='hidden')
    page.wait_for_function("document.querySelectorAll('[data-fighter=team] canvas[data-class]').length === 3")

    def tile(id):
        item = page.locator(f'[data-owned-id="{id}"]')
        while not item.is_visible() and page.locator('[data-inventory-prev]').is_enabled():
            page.locator('[data-inventory-prev]').click()
        while not item.is_visible() and page.locator('[data-inventory-next]').is_enabled():
            page.locator('[data-inventory-next]').click()
        return item

    def lineup():
        return page.locator('[data-fighter=team] canvas:not([hidden])').evaluate_all('(els)=>els.map(e=>e.dataset.class)')

    # Clicking an existing selection removes it instead of swapping an active slot.
    tile('102').click()
    assert lineup() == ['Mantis', 'Ember'], lineup()
    assert tile('102').get_attribute('aria-pressed') == 'false'
    assert page.locator('[data-target-slot]').count() == 0
    assert tile('103').locator('[data-slot-badge]').text_content() == '2'
    assert page.locator('[data-train]').is_disabled()
    tile('104').click()
    assert lineup() == ['Mantis', 'Ember', 'Bulwark']
    assert tile('104').locator('[data-slot-badge]').text_content() == '3'
    tile('105').click()
    assert lineup() == ['Mantis', 'Ember', 'Bulwark']
    assert 'Team full' in page.locator('[data-selection-feedback]').inner_text()
    assert page.locator('[data-selection-feedback]').is_visible()
    assert tile('105').get_attribute('aria-pressed') == 'false'
    # Saved-team reset and empty state preserve sequential selection order.
    page.locator('[data-saved-team]').select_option('')
    assert lineup() == []
    assert page.locator('[data-train]').is_disabled()
    for id, expected in [('106', ['Sentinel']), ('104', ['Sentinel','Bulwark']), ('105', ['Sentinel','Bulwark','Abyss'])]:
        tile(id).click()
        assert lineup() == expected
    assert page.locator('[data-train]').is_enabled()
    tile('104').focus()
    page.keyboard.press('Space')
    assert lineup() == ['Sentinel','Abyss']
    assert tile('105').locator('[data-slot-badge]').text_content() == '2'
    page.locator('[data-saved-team]').select_option('18')
    assert lineup() == ['Bulwark','Abyss','Sentinel']
    assert page.locator('[data-fighter=opponent] canvas:not([hidden])').evaluate_all('(els)=>els.map(e=>e.dataset.class)') == lineup()
    assert not errors, errors
    page.screenshot(path='/tmp/dojo-toggle-selection.png')
    browser.close()
    print('PASS toggle selection, compact order, badges, capacity feedback, clear, saved team, keyboard, mirror, battle validation')
