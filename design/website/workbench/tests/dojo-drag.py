from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:4275/#/dojo'
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.locator('#web-loading').wait_for(state='hidden')
    page.wait_for_function("document.querySelectorAll('[data-fighter=team] canvas[data-class]').length === 3")
    def tile(id):
        return page.locator(f'[data-owned-id="{id}"]')
    def slot(i):
        return page.locator(f'[data-fighter=team][data-slot="{i}"]')
    def center(el):
        b = el.bounding_box()
        return b['x'] + b['width']/2, b['y'] + b['height']/2
    def lineup():
        return page.locator('[data-fighter=team] > canvas').evaluate_all('(els)=>els.map(e=>e.dataset.class || null)')
    def start(source, target):
        page.mouse.move(*center(source))
        page.mouse.down()
        page.mouse.move(*center(target), steps=12)
    start(tile('104'), slot(1))
    assert lineup() == ['Mantis', 'Kraken', 'Ember'], 'Preview must not commit'
    ghost = slot(1).locator('[data-drag-preview]')
    assert ghost.count() == 1, 'Drag must preview the incoming fighter at the target slot'
    assert ghost.locator('canvas[data-class=Bulwark]').is_visible()
    assert ghost.locator('img').is_visible()
    assert ghost.evaluate('(e)=>Number(getComputedStyle(e).opacity)') < 1
    follower = page.locator('[data-drag-follower]')
    assert follower.count() == 1, 'Dragged character must follow the pointer live'
    old_box = follower.bounding_box()
    x, y = center(slot(1))
    page.mouse.move(x+10, y+5)
    moved_box = follower.bounding_box()
    assert abs(moved_box['x']-old_box['x']-10) < 1
    assert abs(moved_box['y']-old_box['y']-5) < 1
    assert follower.evaluate('(e)=>getComputedStyle(e).pointerEvents') == 'none'
    page.screenshot(path='/tmp/dojo-drag-preview.png')
    page.mouse.up()
    assert lineup() == ['Mantis', 'Bulwark', 'Ember']
    assert tile('102').get_attribute('aria-pressed') == 'false'
    assert tile('104').locator('[data-slot-badge]').inner_text() == '2'
    assert page.locator('[data-train]').is_enabled()
    assert page.locator('[data-drag-preview]').count() == 0
    # Selected inventory entries and lineup sources swap, never duplicate.
    start(tile('104'), slot(0))
    page.mouse.up()
    assert lineup() == ['Bulwark', 'Mantis', 'Ember']
    start(slot(0), slot(2))
    page.mouse.up()
    assert lineup() == ['Ember', 'Mantis', 'Bulwark']
    assert len(set(page.locator('[data-owned-id][aria-pressed=true]').evaluate_all('(es)=>es.map(e=>e.dataset.ownedId)'))) == 3
    start(slot(1), page.locator('[data-owned-inventory]'))
    assert page.locator('[data-owned-inventory][data-drop-remove]').count() == 1
    page.mouse.up()
    assert page.locator('[data-drop-remove]').count() == 0
    assert lineup() == ['Ember', 'Bulwark', None]
    assert tile('104').locator('[data-slot-badge]').inner_text() == '2'
    assert page.locator('[data-train]').is_disabled()
    # Escape, invalid drop and tiny pointer movement preserve normal clicks.
    before = lineup()
    start(tile('105'), slot(0))
    page.keyboard.press('Escape')
    assert page.locator('[data-drag-preview]').count() == 0
    page.mouse.up()
    assert lineup() == before
    start(tile('105'), page.locator('[data-fighter=opponent]').first)
    page.mouse.up()
    assert lineup() == before
    start(tile('105'), tile('105'))
    page.mouse.move(*(v+2 for v in center(tile('105'))))
    page.mouse.up()
    assert lineup() == ['Ember', 'Bulwark', 'Abyss']
    # Explicit empty positions must match their preview, not append to slot one.
    page.locator('[data-saved-team]').select_option('')
    start(tile('104'), slot(2))
    ghost_box = slot(2).locator('[data-drag-preview] canvas').bounding_box()
    page.mouse.up()
    assert lineup() == [None, None, 'Bulwark']
    assert slot(2).locator('canvas').bounding_box() == ghost_box
    assert page.locator('[data-train]').is_disabled()
    tile('101').click()
    assert lineup() == ['Mantis', None, 'Bulwark']
    tile('102').click()
    assert lineup() == ['Mantis', 'Kraken', 'Bulwark']
    assert page.locator('[data-train]').is_enabled()
    tile('101').click()
    assert lineup() == ['Kraken', 'Bulwark', None]
    assert page.locator('[data-train]').is_disabled()
    # Real Chromium touch events exercise pointer capture, not synthetic DOM events.
    page.locator('[data-saved-team]').select_option('12')
    cdp = page.context.new_cdp_session(page)
    cdp.send('Emulation.setTouchEmulationEnabled', {'enabled': True})
    def touch(kind, point=None):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if point is None else [{'x': point[0], 'y': point[1]}]})
    touch('touchStart', center(tile('105')))
    touch('touchMove', center(slot(1)))
    assert page.locator('[data-drag-follower]').count() == 1
    touch('touchEnd')
    assert lineup() == ['Mantis', 'Abyss', 'Ember']
    assert page.locator('[data-drag-follower]').count() == 0
    touch('touchStart', center(tile('104')))
    touch('touchMove', center(slot(2)))
    touch('touchCancel')
    assert lineup() == ['Mantis', 'Abyss', 'Ember']
    assert page.locator('[data-drag-preview], [data-drag-follower]').count() == 0
    cdp.send('Emulation.setTouchEmulationEnabled', {'enabled': False})
    start(tile('104'), slot(0))
    page.evaluate("location.hash = '#/market'")
    page.wait_for_function("document.querySelector('#page-content').dataset.page !== 'dojo'")
    assert page.locator('[data-drag-preview], [data-drag-follower]').count() == 0
    page.mouse.up()
    page.goto(URL)
    page.wait_for_function("document.querySelectorAll('[data-fighter=team] canvas[data-class]').length === 3")
    tile('101').click()
    assert lineup() == ['Kraken', 'Ember', None]
    assert not errors, errors
    browser.close()
    print('PASS live follower, translucent slot ghost/shadow, replacement, both swap sources, removal/compact order, invalid/Escape/touch cancel, exact empty slot, click/touch, badge/Battle sync, unmount/remount')
