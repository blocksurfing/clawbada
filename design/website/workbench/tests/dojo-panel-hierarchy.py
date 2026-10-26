"""All setup tabs: readable controls, fixed card containment, Battle clearance."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

OUT = Path('/tmp/dojo-hierarchy')
OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    results = []
    for w, h in [(1920, 1080), (1440, 900), (1280, 648), (390, 844)]:
        page.set_viewport_size({'width': w, 'height': h})
        for compact in ([False, True] if w >= 700 else [False]):
            page.goto('http://127.0.0.1:4275/#/dojo')
            page.locator('#web-loading').wait_for(state='hidden')
            if w >= 700 and page.locator('body').evaluate("e=>e.classList.contains('sidebar-compact')") != compact:
                page.locator('#toggle').click()
            page.wait_for_timeout(1800)
            for name in ['owned', 'builder', 'bot', 'friend']:
                side = 'team' if name in ['owned', 'builder'] else 'opponent'
                if w < 700:
                    page.locator(f'[data-dojo-panel={side}]').click()
                page.locator(f'[aria-controls=dojo-{name}]').click()
                page.wait_for_timeout(300)
                issues = page.locator(f'#dojo-{name}').evaluate('''panel => {
                    const card=panel.closest('.dojo-card').getBoundingClientRect();
                    const battle=document.querySelector('[data-train]');
                    const br=battle.checkVisibility()?battle.getBoundingClientRect():null;
                    return [...panel.closest('.dojo-card').querySelectorAll('button,select,input,summary')].filter(e=>e.checkVisibility()).flatMap(e=>{
                        const r=e.getBoundingClientRect(),s=getComputedStyle(e),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),bad=[];
                        if(r.left<card.left||r.right>card.right+1||r.top<card.top||r.bottom>card.bottom+1)bad.push('containment');
                        if(!e.contains(hit))bad.push('obscured');
                        if(!e.matches('.dojo-inventory-tile')&&parseFloat(s.fontSize)<14)bad.push('small typography');
                        if(br&&r.left<br.right&&r.right>br.left&&r.top<br.bottom&&r.bottom>br.top)bad.push('Battle overlap');
                        return bad.map(issue=>({issue,text:e.textContent.slice(0,40)}));
                    });
                }''')
                label = f'{w}x{h}-{"compact" if compact else "expanded"}-{name}'
                assert not issues, (label, issues)
                page.screenshot(path=str(OUT / f'{label}.png'))
                results.append(label)
    (OUT / 'results.json').write_text(json.dumps(results, indent=2))
    print(f'PASS {len(results)} all-tab/sidebar/viewport cases; screenshots: {OUT}')
    browser.close()
