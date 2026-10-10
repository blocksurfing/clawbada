"""Header must track the pole every frame, not chase separate CSS transitions."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1080})
    page.goto('http://127.0.0.1:4275/#/mining', wait_until='networkidle')
    page.wait_for_function('!document.querySelector("#toggle").disabled')
    for mode in ('expanded', 'compact'):
        samples = page.evaluate('''() => new Promise(resolve => {
            const rows = [];
            document.querySelector('#toggle').click();
            const start = performance.now();
            function sample(now) {
                const header = document.querySelector('.page-header').getBoundingClientRect();
                const pole = document.querySelector('#sidebar-pole').getBoundingClientRect();
                rows.push({x:header.x, expected:pole.right + 48});
                if (now-start < 1800 || document.querySelector('#toggle').disabled)
                    requestAnimationFrame(sample);
                else resolve(rows);
            }
            requestAnimationFrame(sample);
        })''')
        error = max(abs(s['x']-s['expected']) for s in samples)
        print(f'{mode}: maximum header/pole tracking error {error:.3f}px')
        assert error <= 1, f'{mode}: header desynchronizes by {error}px'
    browser.close()
