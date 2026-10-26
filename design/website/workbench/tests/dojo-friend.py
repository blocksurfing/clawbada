from playwright.sync_api import sync_playwright
import re

BASE = 'http://127.0.0.1:4275/'
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE+'#/dojo')
    page.locator('#web-loading').wait_for(state='hidden')
    bot = page.locator('[data-opponent-mode=bot]')
    friend = page.locator('[data-opponent-mode=friend]')
    assert bot.count() == 1, 'Bot / Fight with friend tabs are missing'
    assert bot.get_attribute('aria-selected') == 'true'
    page.locator('[data-bot]').select_option('Deep')
    before = page.locator('[data-side=opponent] .dojo-card').bounding_box()
    friend.click()
    assert page.locator('#dojo-friend').is_visible()
    assert 'not real multiplayer' in page.locator('#dojo-friend').inner_text()
    assert page.locator('[data-train]').is_disabled()
    assert page.locator('[data-fighter=opponent] canvas:not([hidden])').count() == 0
    page.locator('[data-create-room]').click()
    code = page.locator('[data-room-code]').inner_text()
    assert re.fullmatch(r'DEMO-[A-Z0-9]{6}', code)
    link = page.locator('[data-room-link]').input_value()
    assert link == BASE+'?dojoRoom='+code+'#/dojo'
    assert 'Waiting for friend' in page.locator('[data-room-status]').inner_text()
    assert page.locator('[data-train]').is_disabled()
    assert page.locator('[data-side=opponent] .dojo-card').bounding_box() == before
    page.screenshot(path='/tmp/dojo-friend-waiting.png')
    page.locator('[data-join-input]').fill('not a room')
    page.locator('[data-join-room]').click()
    assert page.locator('[data-join-input]').get_attribute('aria-invalid') == 'true'
    page.locator('[data-join-input]').fill(code.lower())
    page.locator('[data-join-input]').press('Enter')
    assert 'Simulated join' in page.locator('[data-room-status]').inner_text()
    assert 'Demo opponent' in page.locator('[data-room-status]').inner_text()
    assert page.locator('[data-train]').is_enabled()
    assert page.locator('[data-fighter=opponent] canvas:not([hidden])').count() == 3
    page.locator('[data-train]').click()
    page.locator('.dojo-dialog').wait_for(state='visible')
    assert 'demo opponent' in page.locator('[data-preview-summary]').inner_text()
    page.locator('[data-end-preview]').click()
    page.locator('[data-join-input]').fill(link)
    page.locator('[data-join-room]').click()
    assert page.locator('[data-join-input]').get_attribute('aria-invalid') == 'false'
    page.screenshot(path='/tmp/dojo-friend-joined.png')
    bot.click()
    assert page.locator('[data-bot]').input_value() == 'Deep'
    bot.focus()
    page.keyboard.press('ArrowRight')
    assert friend.get_attribute('aria-selected') == 'true'
    page.locator('[data-owned-id="101"]').click()
    assert page.locator('[data-train]').is_disabled()
    page.locator('[data-owned-id="101"]').click()
    assert page.locator('[data-train]').is_enabled()
    page.goto(link)
    page.locator('#web-loading').wait_for(state='hidden')
    assert friend.get_attribute('aria-selected') == 'true'
    assert 'Simulated join' in page.locator('[data-room-status]').inner_text()
    assert page.locator('[data-room-code]').inner_text() == code
    page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
    page.locator('[data-copy-room]').click()
    page.wait_for_function("document.querySelector('[data-share-status]').textContent.includes('copied')")
    assert page.evaluate('navigator.clipboard.readText()') == link
    # Unsupported share falls back to copy; supported share only opens on explicit click.
    page.evaluate("Object.defineProperty(navigator, 'share', {configurable:true, value:undefined})")
    page.locator('[data-share-room]').click()
    assert page.evaluate('navigator.clipboard.readText()') == link
    page.evaluate("Object.defineProperty(navigator, 'share', {configurable:true, value:async data => {window.shared = data}})")
    page.locator('[data-share-room]').click()
    page.wait_for_function('window.shared')
    assert page.evaluate('window.shared.url') == link
    assert 'not multiplayer' in page.evaluate('window.shared.text')
    page.evaluate("navigator.clipboard.writeText('unchanged'); Object.defineProperty(navigator, 'share', {configurable:true, value:async () => {throw new DOMException('Cancelled','AbortError')}})")
    page.locator('[data-share-room]').click()
    page.wait_for_function("document.querySelector('[data-share-status]').textContent.includes('cancelled')")
    assert page.evaluate('navigator.clipboard.readText()') == 'unchanged'
    # Real execCommand fallback when clipboard API is unavailable.
    page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true, value:undefined})")
    page.locator('[data-copy-room]').click()
    page.wait_for_function("document.querySelector('[data-share-status]').textContent.includes('copied')")
    assert page.evaluate("document.activeElement.hasAttribute('data-copy-room')")
    assert not errors, errors
    browser.close()
    print('PASS friend tabs, default bot, create/wait, code/link validation, simulated join, demo opponent, battle validity, bot preservation, keyboard, invite loading, unchanged card geometry; no JS errors')
