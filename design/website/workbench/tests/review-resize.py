"""Regression: resize one mounted market, not four fresh pages.
Run: uv run --with playwright python tests/review-resize.py [base-url]
"""
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1920, "height": 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto((sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4275') + '/#/market')
    page.wait_for_selector('.market-card[data-pixel-ready="true"]')
    for width in [1920, 1280, 768, 390, 1920]:
        page.set_viewport_size({"width": width, "height": 1000})
        page.wait_for_timeout(500)
        assert page.locator('.market-card:visible').count() > 0
    # Force a nonzero transient bound smaller than fixed corners on both axes.
    page.evaluate('''() => {
        const panel = [...document.querySelectorAll('.market-card')].find(el => el.getBoundingClientRect().width > 0);
        window.savedBounds = panel.getBoundingClientRect;
        panel.getBoundingClientRect = () => ({left:0, top:0, width:3, height:3});
        window.dispatchEvent(new Event('resize'));
    }''')
    page.wait_for_timeout(100)
    page.evaluate('''() => {
        [...document.querySelectorAll('.market-card')].find(el => el.getBoundingClientRect().width > 0).getBoundingClientRect = window.savedBounds;
        window.dispatchEvent(new Event('resize'));
    }''')
    page.wait_for_timeout(200)
    assert not errors, errors
    assert page.locator('.market-card:visible').first.evaluate('''el => {
        const canvas=el.querySelector('canvas'), unit=parseFloat(getComputedStyle(el).getPropertyValue('--pixel'));
        return canvas.width===Math.round(el.getBoundingClientRect().width/unit) && el.dataset.pixelReady==='true';
    }''')
    print('PASS: same-page 1920→1280→768→390→1920 and undersized transient recovery; no page errors')
    browser.close()
