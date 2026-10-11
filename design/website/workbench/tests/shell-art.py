"""Check source identity, stacking, and uniform proportional cover scaling."""
from pathlib import Path
from hashlib import sha256
from playwright.sync_api import sync_playwright
source=Path(__file__).resolve().parents[2]/'site'/'The Shell'
expected=[('background-rock-2','Background_Rock_2.png'),('background-rock','Background_Rock.png'),('coral','Coral.png'),('back-sand','Back_Sand.png'),('shell','Shell.png'),('sand','Sand.png'),('rock','Rock.png')]
assert {name for _,name in expected}.issubset({p.name for p in source.glob('*.png')})
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={'width':1920,'height':1080})
    page.goto('http://localhost:4275/#/dashboard')
    page.wait_for_selector('.shell-art-layer',state='attached')
    for index,(key,name) in enumerate(expected):
        layer=page.locator('[data-shell-layer='+key+']')
        data=layer.evaluate('el=>{const s=getComputedStyle(el);return {z:Number(s.zIndex),url:s.backgroundImage.slice(5,-2),render:s.imageRendering,events:s.pointerEvents}}')
        assert data['z']==index and data['render']=='pixelated' and data['events']=='none'
        response=page.request.get(data['url'])
        assert response.status==200
        assert sha256(response.body()).digest()==sha256((source/name).read_bytes()).digest()
        print('PASS',name,'original source + stack',index)
    for width,height in [(2560,1440),(2560,1320),(1920,1080),(1920,965),(1366,768),(1024,768),(390,844),(375,667),(844,390)]:
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(100)
        rows=page.locator('.shell-art-layer').evaluate_all('(els)=>els.map(el=>{const s=getComputedStyle(el);return {size:s.backgroundSize.split(\" \").map(parseFloat),pos:s.backgroundPosition.split(\" \").map(parseFloat)}})')
        assert len(rows)==len(expected) and all(row==rows[0] for row in rows)
        sw,sh=rows[0]['size']; x,y=rows[0]['pos']
        zoom=sw/640
        assert abs(zoom-max(width/640,height/360))<0.001,rows
        assert abs(sh-360*zoom)<0.1,rows
        assert x<=0.1 and y<=0.1 and x+sw>=width-0.1 and y+sh>=height-0.1,rows
        assert abs(x+sw/2-width/2)<0.1 and abs(y+sh-height)<0.1,rows
        print('PASS',width,height,'zoom',zoom,'art',sw,sh,'offset',x,y,'all seven identical')
    browser.close()
