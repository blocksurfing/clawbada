"""Headless technical checks; no screenshots or visual approval.
Run: uv run --with playwright python tests/sidebar-compact.py
Short viewports retain the existing no-scroll sidebar limitation.
"""
import os
from playwright.sync_api import sync_playwright

URL = os.environ.get('WORKBENCH_URL', 'http://127.0.0.1:4275')
IDLE = "!document.querySelector('#toggle').disabled && document.querySelector('#sidebar').dataset.phase === 'idle'"

def geometry(page, compact):
    result = page.evaluate(r"""async () => {
      const box = e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}};
      const pole = document.querySelector('#sidebar-pole'), r = box(pole);
      const logo = box(document.querySelector('.standalone-brand img'));
      const music = box(document.querySelector('.music-toggle'));
      const shell = box(document.querySelector('.sidebar-shell'));
      const heading = box(document.querySelector('.page-title'));
      const image = new Image();
      image.src = performance.getEntriesByType('resource').find(e=>/Pole[^/]*\.png/.test(e.name)).name;
      await image.decode();
      const banner = new Image();
      banner.src = performance.getEntriesByType('resource').find(e=>/Banner[^/]*\.png/.test(e.name)).name;
      await banner.decode();
      const source = document.createElement('canvas'); source.width=16; source.height=16;
      source.getContext('2d').drawImage(image,+pole.dataset.frame*64+48,0,16,16,0,0,16,16);
      const expected = source.getContext('2d').getImageData(0,0,16,16).data;
      const actual = pole.getContext('2d').getImageData(pole.width-16,0,16,16).data;
      const capLeft = r.right-48;
      const overlapsCap = b => b.x<r.right && b.right>capLeft && b.y<r.bottom && b.bottom>r.y;
      const cloth = document.querySelector('#panel');
      const clothTip = cloth.getContext('2d').getImageData(cloth.width-16,0,16,16).data;
      const trigger = box(document.querySelector('#toggle'));
      return {logo, music, shell, heading, pole:r, width:innerWidth, poleSourceWidth:pole.width,
        sourceSize:[image.naturalWidth,image.naturalHeight],
        bannerSize:[banner.naturalWidth,banner.naturalHeight],
        oldSourceLoaded:performance.getEntriesByType('resource').some(e=>/Sidebar[^/]*\.png/.test(e.name)),
        capTarget:trigger.x===r.x && trigger.right===r.right && trigger.y===r.y && trigger.bottom===r.bottom,
        capHit:document.elementFromPoint(r.right-12,r.y+24)?.id==='toggle',
        capExact:actual.every((v,i)=>v===expected[i]), capOpaque:actual.some((v,i)=>i%4===3 && v>0),
        capUnoccluded:!overlapsCap(logo) && !overlapsCap(music),
        clothHasNoPoleTip:clothTip.every((v,i)=>i%4!==3 || v===0),
        scale:pole.clientWidth/pole.width,
        overflow:getComputedStyle(document.querySelector('.sidebar-shell')).overflow};
    }""")
    assert result['sourceSize'] == [256, 16]
    assert result['bannerSize'] == [304, 96]
    assert not result['oldSourceLoaded']
    assert result['capTarget'] and result['capHit'], result
    assert result['poleSourceWidth'] == (96 if compact else 128)
    assert result['scale'] == 3
    assert result['capExact'] and result['capOpaque'], result
    assert result['capUnoccluded'] and result['clothHasNoPoleTip'], result
    assert result['pole']['right'] <= min(result['shell']['right'], result['width']), result
    assert result['pole']['bottom'] <= result['shell']['bottom'], result
    assert 0 <= result['logo']['x'] and result['logo']['right'] <= result['width'], result
    assert result['logo']['y'] >= 0 and result['logo']['bottom'] <= 1080, result
    assert max(result['logo']['right'], result['music']['right'], result['pole']['right']) <= result['heading']['x'], result
    assert result['overflow'] == 'clip'


def transition(page, old_width, new_width):
    page.evaluate(r"""async () => {
      window.trace = []; window.tracing = true;
      const image = new Image();
      image.src = performance.getEntriesByType('resource').find(e=>/Pole[^/]*\.png/.test(e.name)).name;
      await image.decode();
      const expected = new Map();
      for (const width of Array.from({length:33},(_,i)=>96+i)) for (let frame=0;frame<4;frame++) {
        const c=document.createElement('canvas'); c.width=width; c.height=16;
        const ctx=c.getContext('2d');
        for (let x=0;x<width;x++) {
          const sx=x<16 ? x : x>=width-32 ? 64-(width-x) : 16+(x-16)%16;
          ctx.drawImage(image,frame*64+sx,0,1,16,x,0,1,16);
        }
        expected.set(`${width}/${frame}`,c.toDataURL());
      }
      function sample() {
        const c = document.querySelector('#panel');
        const pole = document.querySelector('#sidebar-pole');
        window.trace.push({width:c.width, step:+c.dataset.step, total:+c.dataset.total,
          pose:+c.dataset.pose, poleFrame:+pole.dataset.frame, poleWidth:pole.width, resizing:pole.dataset.resizing==='true',
          poleExact:pole.toDataURL()===expected.get(`${pole.width}/${pole.dataset.frame}`),
          polePixels:pole.toDataURL(),
          logoX:document.querySelector('.standalone-brand img').getBoundingClientRect().x,
          musicX:document.querySelector('.music-toggle').getBoundingClientRect().x,
          phase:document.querySelector('#sidebar').dataset.phase,
          left:document.querySelector('.sidebar-shell').getBoundingClientRect().left});
        if (window.tracing) requestAnimationFrame(sample);
      }
      sample();
    }""")
    page.locator('#toggle').click()
    page.wait_for_function(IDLE)
    trace = page.evaluate('window.tracing=false; window.trace')
    old = [x for x in trace if x['width'] == old_width]
    new = [x for x in trace if x['width'] == new_width]
    assert old and new, trace
    assert any(x['step'] == 0 for x in old), 'Outgoing banner must roll completely up'
    assert any(x['step'] == 0 for x in new), 'Incoming banner must start rolled'
    assert any(0 < x['step'] < x['total'] for x in old)
    assert any(0 < x['step'] < x['total'] for x in new)
    first_new = next(i for i,x in enumerate(trace) if x['width'] == new_width)
    assert trace[first_new-1]['step'] == 0, trace
    assert all(x['left'] == 0 for x in trace), 'No slide-left hiding'
    resizing = [x for x in trace if x['resizing']]
    widths = [x['poleWidth'] for x in resizing]
    assert len(set(widths)) > 5, 'Pole width must animate through intermediate source pixels'
    assert all(x['phase']=='unrolling' for x in resizing), 'Pole resize starts together with incoming banner'
    assert any(0 < x['step'] < x['total'] and 96 < x['poleWidth'] < 128 for x in resizing), 'Banner must descend while pole is still resizing'
    assert widths == sorted(widths, reverse=new_width < old_width), widths
    for x in trace:
        assert abs(x['logoX'] - 72*(x['poleWidth']-96)/32) < 0.1, ('Logo must track pole progress', x)
        assert abs(x['musicX'] - x['logoX'] - 192) < 0.1, ('Music must stay attached to logo', x)
    active = [x for x in trace if x['phase'] != 'idle']
    def sequence(values):
        return [v for i,v in enumerate(values) if i == 0 or values[i-1] != v]
    frames = sequence([x['poleFrame'] for x in active])
    assert frames == [0, 1, 2, 3], frames
    assert all(x['poleExact'] for x in trace), 'Pole must render actual source pose pixels, not only advance metadata'
    assert len({x['polePixels'] for x in active if x['phase'] == 'rolling-up'}) == 4, 'All four distinct source poses must paint'
    assert active[0]['phase'] == 'rolling-up' and active[0]['poleFrame'] == 0, 'Pole and banner start together'
    assert any(x['poleFrame'] == 1 and 0 < x['step'] < x['total'] for x in old), 'Animations must overlap'
    assert sequence([x['pose'] for x in old]) == [0, 1, 2, 3, 4], 'Banner close uses forward poses'
    assert sequence([x['pose'] for x in new]) == [4, 3, 2, 1, 0], 'Banner open uses reverse poses'
    assert page.locator('#sidebar-pole').get_attribute('data-frame') == '3', 'Hold the exported final rest pose'
    assert page.locator('#panel').evaluate('(c)=>+c.dataset.step === +c.dataset.total')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1080})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL.split("#")[0].rstrip("/") + "/#/mining")
    page.wait_for_function(IDLE)
    # Current startup is compact; explicitly establish the expanded baseline.
    assert page.locator('#toggle').get_attribute('aria-expanded') == 'false'
    page.locator('#toggle').click()
    page.wait_for_function(IDLE)
    assert page.locator('#sidebar-pole').count() == 1, 'Pole must render independently from cloth'
    for width in [700, 1000, 1440]:
        page.set_viewport_size({'width': width, 'height': 1080})
        geometry(page, False)
    expanded_pixels = page.locator('#panel').evaluate('(c)=>c.toDataURL()')
    wide = page.locator('#page-content').bounding_box()['width']
    transition(page, 128, 48)
    assert page.locator('.menu-item[aria-current="page"] .menu-icon').evaluate('(e)=>getComputedStyle(e).outlineWidth') == '0px'
    assert page.locator('#menu-overlay').is_visible()
    assert not page.locator('#menu-overlay').evaluate('(e)=>e.inert')
    assert page.locator('#page-content').bounding_box()['width'] > wide
    assert page.locator('#panel').evaluate('(c)=>c.clientWidth/c.width===3 && c.clientHeight/c.height===3')
    buttons = page.locator('#menu-list .menu-item')
    assert buttons.count() == 11
    names = buttons.evaluate_all('(els)=>els.map(e=>e.getAttribute("aria-label"))')
    assert names == ["Shell", "Mining", "Dojo", "Breeding", "Evolve", "Repair", "Teams", "Market", "Activity", "Ranks", "Docs"]
    for name in names:
        b = page.get_by_role('button', name=name, exact=True)
        assert b.get_attribute('title') == name
        assert not b.locator('.menu-label').is_visible()
        assert b.locator('.menu-icon').bounding_box()['width'] == 48
        b.focus()
        assert b.evaluate('(e)=>document.activeElement===e')
        page.keyboard.press('Enter')
        page.wait_for_function('(slug)=>document.querySelector("#page-content").dataset.page===slug', arg='dashboard' if name == 'Shell' else name.lower())
        page.wait_for_function('(slug)=>document.querySelector("button[data-menu="+slug+"]").getAttribute("aria-current")==="page"', arg=name.lower())
        assert b.locator('.menu-icon').evaluate('(e)=>getComputedStyle(e).outlineStyle') == 'none'
        assert b.locator('.menu-icon').evaluate('(e)=>getComputedStyle(e).outlineWidth') == '0px'
        page.wait_for_function('(slug)=>{const c=document.querySelector("button[data-menu="+slug+"] .active-ribbon");return c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3 && v>0)}', arg=name.lower())
    for width in [700, 1000, 1440]:
        page.set_viewport_size({'width': width, 'height': 1080})
        geometry(page, True)
        for i in range(buttons.count()):
            b = buttons.nth(i)
            box = b.bounding_box()
            assert 0 <= box['x'] and box['x'] + box['width'] <= 144
            assert box['y'] + box['height'] <= 1080
            assert b.evaluate('(e)=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
    transition(page, 48, 128)
    geometry(page, False)
    assert page.locator('#page-content').bounding_box()['width'] == wide
    assert page.locator('#panel').evaluate('(c)=>c.toDataURL()') == expanded_pixels, 'Expanded art unchanged after round trip'
    page.emulate_media(reduced_motion='reduce')
    for expected in [48, 128]:
        page.locator('#toggle').click()
        page.wait_for_function(IDLE, timeout=1000)
        assert page.locator('#panel').evaluate('(c)=>c.width') == expected
        assert page.locator('#menu-overlay').is_visible()
    assert not errors, errors
    print({'result':'PASS', 'keyboard_routes':names, 'phases':'full up -> width switch -> full down (both directions)', 'scale':3, 'compact_cloth_css':96, 'compact_canvas_css':144, 'compact_pole_css':288, 'pole_cap':'source-exact, nontransparent, unclipped, unoccluded', 'logo_heading_geometry':'PASS expanded + compact', 'active_icon_outline':'absent; ribbon preserved', 'resize_widths':[700,1000,1440], 'tested_height':1080, 'reduced_motion':'PASS', 'expanded_canvas_roundtrip':'byte-identical', 'browser_errors':errors})
    browser.close()
