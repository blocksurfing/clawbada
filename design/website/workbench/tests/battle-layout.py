"""DOM-only Shell lineup selection and Battle setup verification."""
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    for width in [1920, 1440, 1280, 1024, 768, 390]:
        page.set_viewport_size({'width': width, 'height': 1080})
        page.goto('http://localhost:4275/#/dashboard')
        page.reload()  # Same-hash navigation alone retains the previous local lineup.
        page.wait_for_selector('.shell-room')
        page.evaluate('document.fonts.ready')
        assert page.locator('#page-content [data-pixel-panel]').count() == 0
        assert page.locator('.lobby-slot').count() == 3
        expect(page.locator('.shell-battle')).to_be_disabled()
        rects = page.locator('.character-stage').evaluate_all('(els)=>els.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right}})')
        assert len({r['top'] for r in rects}) == 1
        assert all(0 <= r['left'] and r['right'] <= width for r in rects)
        for i, name in enumerate(['Bulwark', 'Mantis', 'Leviathan']):
            # Opaque stage art, not the transparent slot wrapper, is the pointer target.
            page.locator('.character-stage').nth(i).click()
            assert page.locator('.picker-options button').count() == 10
            page.locator('.picker-options button').filter(has_text=name).click()
            expect(page.locator('.lobby-slot .slot-name').nth(i)).to_have_text(name)
        assert page.locator('.lobby-slot[data-selected=true]').count() == 3
        page.locator('.character-stage').nth(1).click()
        page.locator('.picker-options button').filter(has_text='Ember').click()
        expect(page.locator('.lobby-slot .slot-name')).to_have_text(['Bulwark', 'Ember', 'Leviathan'])
        page.locator('.character-stage').nth(1).click()
        page.locator('.picker-clear').click()
        expect(page.locator('.lobby-slot[data-selected=true]')).to_have_count(2)
        page.locator('.character-stage').nth(0).click()
        page.keyboard.press('Escape')
        expect(page.locator('.lobster-picker')).not_to_be_visible()
        page.locator('.shell-battle').click()
        modal = page.locator('.battle-modal')
        expect(modal).to_be_visible()
        page.wait_for_selector('.battle-lobby[data-pixel-ready=true]')
        assert modal.locator('[data-pixel-panel]').count() == 1
        modal.locator('#battle-arena').select_option('elite')
        assert modal.locator('#battle-arena').input_value() == 'elite'
        expect(modal.get_by_role('button', name='Find Match', exact=True)).to_be_disabled()
        assert modal.locator('[id^=practice-], .lobby-slot').count() == 0
        overflow = page.locator('.slot-name, .battle-modal h1, .battle-modal h2, .battle-modal p, .battle-modal select, .battle-start button').evaluate_all('(els)=>els.filter(el=>el.getClientRects().length && el.scrollWidth>el.clientWidth+1).map(el=>el.textContent)')
        assert not overflow, (width, overflow)
        page.keyboard.press('Escape')
        expect(modal).not_to_be_visible()
        print('PASS', width, 'three side-by-side stages / select, replace, clear, Escape / Battle panel and settings / text fit')
    page.locator('.character-stage').nth(0).click()
    page.evaluate('location.hash="/mining"')
    page.wait_for_selector('.mining-card')
    assert page.locator('dialog[open]').count() == 0
    assert not errors, errors
    print('PASS navigation cleanup and no browser errors')
    browser.close()
