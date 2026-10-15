"""Local marketplace interactions; no screenshots or backend. uv run --with playwright python tests/market.py"""
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width in [1920, 1440, 768, 390]:
        page = browser.new_page(viewport={'width': width, 'height': 1000}, reduced_motion='reduce')
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://localhost:4275/#/market')
        market = page.locator('[data-market]')
        expect(market).to_be_visible()
        expect(market.locator('.market-kicker, .market-intro, [data-market-count]')).to_have_count(0)
        page.evaluate('document.fonts.ready')
        cards = market.locator('.market-card:visible')
        expect(cards).to_have_count(8)
        expect(cards.first).to_have_attribute('data-pixel-panel', 'marketCard')
        assert not any(word in cards.first.inner_text() for word in ['Demo', 'Not for sale', 'Lobsters', 'Common'])
        expect(cards.first.locator('.market-class-badge')).to_have_attribute('aria-label', 'Bulwark')
        expect(cards.first.locator('.market-id')).to_have_text('#D001')
        expect(cards.first.locator('.market-tier-symbol')).to_have_attribute('aria-label', 'Base')
        expect(cards.first.locator('.market-tier-symbol [data-pixel-sprite]')).to_have_attribute('data-frame', '35')
        expect(cards.first.locator('.market-class-badge [data-pixel-sprite]')).to_have_attribute('data-frame', '0')
        expect(cards.first.locator('.market-purity-stars')).to_have_attribute('aria-label', '5 of 6 purity')
        expect(cards.first.locator('.market-purity-stars')).to_have_text('5')
        expect(cards.first.locator('.market-purity-stars [data-pixel-sprite]')).to_have_attribute('data-frame', '32')
        expect(cards.first.locator('.market-price')).to_have_count(0)
        expect(cards.first.get_by_role('button', name='Buy D001 for 1,200 GOLD', exact=True)).to_be_visible()
        expect(cards.first.locator('.market-buy-price')).to_have_text('1,200')
        expect(cards.first.get_by_role('button', name='Bid on D001', exact=True)).to_be_visible()
        assert cards.first.evaluate('''el=>{
            const stats=el.querySelector('.market-card-header .market-details');
            if(!stats) return false;
            const rows=[...stats.children].map(e=>e.getBoundingClientRect());
            const art=el.querySelector('.market-lobster-art').getBoundingClientRect();
            const title=el.querySelector('h3').getBoundingClientRect();
            return rows[1].top>=rows[0].bottom && rows[0].left>=title.right && rows[1].bottom<=art.top;
        }'''), 'stats stacked in upper right above sprite'
        expect(cards.first.locator('.market-details > div').first).to_have_class('market-purity')
        assert '%' not in cards.first.inner_text()
        assert cards.evaluate_all('''els=>els.every(el=>{
            const card=el.querySelector('.market-lobster-art, .market-egg-art').getBoundingClientRect(), sprite=el.querySelector('.market-lobster-art > span, .market-egg-art > span').getBoundingClientRect();
            return Math.abs((sprite.top+sprite.bottom-card.top-card.bottom)/2)<3 && Math.abs((sprite.left+sprite.right-card.left-card.right)/2)<3;
        })'''), 'sprites centered in their art area'
        assert market.locator('.market-grid').evaluate('e=>getComputedStyle(e).gap') == '24px'
        assert cards.evaluate_all('''els=>els.every(el=>{
            const card=el.getBoundingClientRect(), price=el.querySelector('.market-buy-price').getBoundingClientRect();
            const actions=el.querySelector('.market-card-actions').getBoundingClientRect(), buttons=[...el.querySelectorAll('.market-card-actions button')].map(b=>b.getBoundingClientRect());
            // Footer source art includes a 6px transparent overhang below the card.
            return Math.abs(card.height-444)<2 && actions.left>=card.left && actions.right<=card.right && Math.abs(actions.bottom-card.bottom-6)<2 && buttons.length===2 && Math.abs(buttons[0].right-buttons[1].left)<2 && Math.abs(buttons[0].top-buttons[1].top)<2 && Math.abs(buttons[0].bottom-buttons[1].bottom)<2 && price.left>=buttons[0].left && price.right<=buttons[0].right && price.top>=buttons[0].top && price.bottom<=buttons[0].bottom;
        })'''), '444px cards with contained price/Buy and Bid side by side, including eggs'
        assert cards.first.evaluate('''el=>{
            const card=el.getBoundingClientRect(), title=el.querySelector('h3').getBoundingClientRect(), badge=el.querySelector('.market-class-badge').getBoundingClientRect();
            return Math.abs(title.left-card.left-18)<2 && badge.width===48 && badge.height===48 && badge.bottom<=title.top && Math.abs(badge.left-title.left)<2;
        }'''), '48px class badge above tier symbol without overlap'
        assert cards.first.evaluate('''el => {
            const title=el.querySelector('h3'), art=el.querySelector('.market-lobster-art'), id=el.querySelector('.market-id');
            const card=el.getBoundingClientRect(), identity=id.getBoundingClientRect();
            return title.getBoundingClientRect().bottom <= art.getBoundingClientRect().top && getComputedStyle(id).fontSize==='24px' && Math.abs((identity.left+identity.right-card.left-card.right)/2)<2 && identity.top>=card.top && identity.bottom<=el.querySelector('.market-card-header').getBoundingClientRect().top;
        }'''), 'ribbon ID centered above symbol header and sprite'
        expect(market.locator('.market-catalog')).to_have_attribute('data-pixel-panel', 'woodenPanel')
        expect(market.locator('[data-market-page]')).to_have_text('Page 1 of 2')
        expect(market.get_by_role('button', name='List Lobster')).to_have_count(0)
        expect(market.get_by_role('button', name='Previous')).to_be_disabled()
        expect(market.get_by_role('button', name='Next')).to_be_enabled()
        assert market.evaluate('e=>e.scrollWidth<=e.clientWidth+2'), 'first-page market overflow'
        assert page.locator('#page-content').evaluate('e=>e.scrollWidth<=e.clientWidth+2'), 'first-page content overflow'
        assert cards.locator(':scope > :not(canvas), .market-card-actions button').evaluate_all('els=>els.every(e=>e.scrollWidth<=e.clientWidth+2)'), 'first-page card/control overflow'
        market.get_by_role('button', name='Next').click()
        expect(cards).to_have_count(4)
        expect(cards.first).to_have_attribute('data-listing-id', 'D009')
        expect(market.locator('[data-market-page]')).to_have_text('Page 2 of 2')
        expect(market.get_by_role('button', name='Next')).to_be_disabled()
        market.get_by_role('button', name='Previous').click()
        expect(cards).to_have_count(8)
        expect(cards.first).to_have_attribute('data-listing-id', 'D001')
        market.get_by_role('button', name='Next').click()
        market.get_by_label('Type', exact=True).select_option('Eggs')
        expect(cards).to_have_count(4)
        expect(market.locator('[data-market-page]')).to_have_text('Page 1 of 1')
        market.get_by_label('Sort', exact=True).select_option('price-asc')
        expect(cards.first).to_have_attribute('data-listing-id', 'D012')
        market.get_by_role('button', name='Reset filters').click()
        expect(market.locator('select[name=klass]')).to_have_count(0)
        expect(market.get_by_role('radio')).to_have_count(11)
        choices = market.locator('.market-class-choice')
        assert choices.nth(1).bounding_box()['y'] == choices.nth(2).bounding_box()['y'], 'class choices must use multiple columns'
        assert market.locator('input[name=klass]').evaluate_all('els=>els.every(e=>getComputedStyle(e).clipPath!=="none" || e.getBoundingClientRect().width===0)'), 'no visible radio circles'
        choices.filter(has_text='Bulwark').click()
        for label, value in [('Tier', 'Evolved'), ('Rarity (demo)', 'Rare')]:
            market.get_by_label(label, exact=True).select_option(value)
        market.get_by_label('Min purity', exact=True).select_option('5')
        for label, value in [('Min price (GOLD)', '2000'), ('Max price (GOLD)', '3000')]:
            market.get_by_label(label, exact=True).fill(value)
        expect(cards).to_have_count(1)
        expect(cards.first).to_have_attribute('data-listing-id', 'D011')
        market.get_by_label('Min price (GOLD)', exact=True).fill('5000')
        expect(cards).to_have_count(0)
        expect(market.locator('[data-market-empty]')).to_be_visible()
        expect(market.locator('[data-market-page]')).to_have_text('Page 1 of 1')
        market.get_by_role('button', name='Reset filters').click()
        expect(cards).to_have_count(8)
        expect(market.get_by_role('radio', name='All classes', exact=True)).to_be_checked()
        market.get_by_label('Sort', exact=True).select_option('price-desc')
        expect(cards.first).to_have_attribute('data-listing-id', 'D005')
        market.get_by_label('Sort', exact=True).select_option('purity-desc')
        expect(cards.first).to_have_attribute('data-listing-id', 'D005')
        market.get_by_role('button', name='Reset filters').click()
        market.get_by_role('button', name='Next').click()
        # Previously hidden panels must acquire correct source-resolution canvas sizes.
        page.wait_for_function('''() => [...document.querySelectorAll('.market-card:not([hidden])')].every(e => {
          const c=e.querySelector('canvas'); const r=e.getBoundingClientRect();
          return e.dataset.pixelReady==='true' && c.width*3===Math.round(r.width) && c.height*3===Math.round(r.height);
        })''')
        assert market.locator('.market-card').evaluate_all("els=>els.every(e=>e.querySelectorAll(':scope > canvas').length===1)")
        assert market.evaluate('e=>e.scrollWidth<=e.clientWidth+2')
        assert page.locator('#page-content').evaluate('e=>e.scrollWidth<=e.clientWidth+2')
        assert market.locator('input,select,.market-card > :not(canvas)').evaluate_all('els=>els.every(e=>e.scrollWidth<=e.clientWidth+2)')
        tracks = market.locator('[data-pixel-grid]').evaluate("e=>getComputedStyle(e).gridTemplateColumns.split(' ').length")
        assert tracks == {1920: 4, 1440: 2, 768: 1, 390: 1}[width], (width, tracks)
        assert 'Big Shot' in market.locator('select').first.evaluate('e=>getComputedStyle(e).fontFamily')
        assert 'Upheaval' in cards.first.locator('h3').evaluate('e=>getComputedStyle(e).fontFamily')
        page.evaluate("location.hash='/mining'")
        expect(page.locator('[data-page=mining]')).to_be_visible()
        page.evaluate("location.hash='/market'")
        expect(market).to_be_visible()
        expect(market.locator('[data-market-page]')).to_have_text('Page 1 of 2')
        market.get_by_role('button', name='Next').click()
        expect(market.locator('[data-market-page]')).to_have_text('Page 2 of 2')
        assert market.locator('.market-card').evaluate_all("els=>els.every(e=>e.querySelectorAll(':scope > canvas').length===1)")
        assert not errors, errors
        print(f'PASS market {width}px: filters, sorts, empty/reset, pagination, panel resize, overflow, typography, navigation; no pageerrors; {tracks} columns')
        page.close()
    browser.close()
