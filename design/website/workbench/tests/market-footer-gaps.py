from playwright.sync_api import sync_playwright

MEASURE = """card => {
 const r=card.getBoundingClientRect();
 const bounds=canvas=>{const c=canvas.getBoundingClientRect(),ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let x0=canvas.width,y0=canvas.height,x1=0,y1=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}return {left:c.left+x0*3,right:c.left+x1*3,top:c.top+y0*3,bottom:c.top+y1*3};};
 const [a,b]=[...card.querySelectorAll('.market-card-actions > button > .pixel-panel-art')].map(bounds);
 return {left:a.left-r.left,right:r.right-b.right,gap:b.left-a.right,bottom:r.bottom-a.bottom,bidBottom:r.bottom-b.bottom};
}"""
with sync_playwright() as p:
    browser=p.chromium.launch()
    for width in [1280,1920]:
        page=browser.new_page(viewport={'width':width,'height':1000})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://localhost:4275/#/market')
        page.wait_for_selector('.market-card:visible [data-pixel-panel=marketBidButton][data-pixel-ready=true]')
        page.wait_for_timeout(500)
        results=[]
        for card in page.locator('.market-card:visible').all():
            result=card.evaluate(MEASURE)
            expected={'left':12,'right':12,'gap':6,'bottom':12,'bidBottom':12}
            assert all(abs(result[k]-v)<0.1 for k,v in expected.items()), (width,result,expected)
            results.append(result)
        assert not errors,errors
        print(width,'PASS exact opaque-art gaps:',results)
        if width==1920:
            page.locator('.market-card:visible').first.screenshot(path='/tmp/clawbada-footer-gaps-fixed.png')
        page.close()
    browser.close()
