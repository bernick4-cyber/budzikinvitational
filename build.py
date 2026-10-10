from pathlib import Path
import json,re
root=Path(__file__).parent
core=re.sub(r'(?m)^export ', '', (root/'core.js').read_text())
app=re.sub(r"^import[^\n]+\n", '', (root/'app.js').read_text())
app=app.replace("  const response=await fetch('./history.json');if(!response.ok)throw new Error('Archive unavailable');\n  archive=normalize(await response.json());", "  archive=normalize(JSON.parse(document.getElementById('archive-data').textContent));")
(root/'bundle.js').write_text('(async()=>{\n'+core+'\n'+app+'\n})();\n')
data=json.dumps(json.loads((root/'history.json').read_text()),ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
index=(root/'index.template.html').read_text().replace('<script type="module" src="./app.js"></script>', '<script id="archive-data" type="application/json">'+data+'</script>\n  <script src="./bundle.js" defer></script>')
(root/'index.html').write_text(index)
print('Built portable index.html and bundle.js')
