"""Approved typography role regression. Run with uv run --with playwright python tests/typography.py."""
import os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('WORKBENCH_URL', 'http://127.0.0.1:4275')

def check(page, selector, size, family, leading, tracking):
    item = page.locator(selector).first
    actual = item.evaluate('''e => { const s=getComputedStyle(e); return {
      size:parseFloat(s.fontSize), family:s.fontFamily, leading:parseFloat(s.lineHeight),
      tracking:parseFloat(s.letterSpacing)||0, weight:s.fontWeight
    }; }''')
    assert actual['size'] == size, (selector, actual)
    assert family in actual['family'], (selector, actual)
    assert actual['weight'] == '400', (selector, actual)
    # Native Chromium select can report line-height normal despite the authored rule.
    if not item.evaluate('e=>e.tagName === "SELECT"'):
        assert abs(actual['leading'] - size*leading) < .02, (selector, actual)
    assert abs(actual['tracking'] - tracking) < .02, (selector, actual)

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(1440,900),(390,844)]:
        page = browser.new_page(viewport={'width':width,'height':height}, reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(BASE+'/#/mining')
        page.evaluate('document.fonts.ready')
        check(page,'body',16,'Big Shot',2.05,-.48)
        check(page,'.page-title',60,'Upheaval',1.2,3)
        check(page,'.page-subtitle',18,'Big Shot',2.05,-.54)
        check(page,'.mining-card h3',40,'Upheaval',1.2,40/12-2)
        check(page,'.mine-reward',16,'Big Shot',2.05,-.48)
        check(page,'.mine-reward-caption',12,'Big Shot',2.05,-.36)
        check(page,'.mine-details dt',14,'Big Shot',2.05,-.42)
        check(page,'.mine-details dd',16,'Big Shot',2.05,-.48)
        check(page,'.menu-item',24,'Upheaval',1.2,0)
        check(page,'.connect-wallet',24,'Upheaval',1.2,0)
        check(page,'.profile-menu button',24,'Upheaval',1.2,0)
        check(page,'#profile-editor input',16,'Big Shot',2.05,-.48)
        assert page.locator('#page-content').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        # Nine-slice artwork intentionally overhangs the content box; test text, not that canvas.
        assert page.locator('.mining-card > :not(canvas)').evaluate_all('els=>els.every(e=>e.scrollWidth<=e.clientWidth+1)')
        assert page.evaluate('[...document.fonts].find(f=>f.family.includes("Big Shot")).sizeAdjust')=='100%'
        page.goto(BASE+'/#/dashboard')
        page.locator('[data-shell-tab=queue]').click()
        check(page,'.shell-records h2',40,'Upheaval',1.2,40/12-2)
        check(page,'.shell-records p:not(.shell-records-label)',16,'Big Shot',2.05,-.48)
        check(page,'.shell-tabs button',24,'Upheaval',1.2,0)
        page.keyboard.press('Escape')
        page.locator('.lobby-slot').first.focus()
        page.keyboard.press('Enter')
        expect(page.locator('.lobster-picker')).to_be_visible()
        check(page,'.picker-heading h2',40,'Upheaval',1.2,40/12-2)
        check(page,'.picker-options button',24,'Upheaval',1.2,0)
        assert page.locator('.lobster-picker').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        page.keyboard.press('Escape')
        page.goto(BASE+'/#/battle')
        check(page,'.battle-modal-header h1',40,'Upheaval',1.2,40/12-2)
        check(page,'.battle-modal h2',28,'Upheaval',1.2,28/12-2)
        check(page,'.battle-modal .lobby-heading p',16,'Big Shot',2.05,-.48)
        check(page,'.battle-modal .battle-help',12,'Big Shot',2.05,-.36)
        check(page,'.battle-modal select',16,'Big Shot',2.05,-.48)
        check(page,'.battle-modal label',14,'Big Shot',2.05,-.42)
        check(page,'.battle-modal .pixel-button',24,'Upheaval',1.2,0)
        page.goto(BASE+'/typography.html')
        check(page,'.example-card .heading-lg',40,'Upheaval',1.2,40/12-2)
        check(page,'.example-card .body-copy',16,'Big Shot',2.05,-.48)
        assert not errors,errors
        print('PASS typography roles, reference parity, font scale and local overflow',width,height)
        page.close()
    browser.close()
