"""Streamlit launcher for the Budzik Invitational static website."""
from pathlib import Path
import base64

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent


def website_html(root: Path = ROOT) -> str:
    """Inline local assets so the website works inside Streamlit's HTML iframe."""
    required = ['index.html', 'bundle.js', 'style.css', 'history.json']
    missing = [name for name in required if not (root / name).is_file()]
    if missing:
        raise FileNotFoundError('Upload these website files: ' + ', '.join(missing))
    html = (root / 'index.html').read_text(encoding='utf-8')
    css = (root / 'style.css').read_text(encoding='utf-8')
    js = (root / 'bundle.js').read_text(encoding='utf-8')
    # HTML parsers recognize closing script tags even inside JavaScript strings.
    js = js.replace('</script', '<\\/script')
    html = html.replace('<link rel="stylesheet" href="./style.css">', '<style>' + css + '</style>')
    html = html.replace('<script src="./bundle.js" defer></script>', '<script>' + js + '</script>')
    for filename, mime in [('history.json', 'application/json'),
                           ('Budzik_League_History_2015-2025.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                           ('favicon.svg', 'image/svg+xml')]:
        asset = root / filename
        if asset.is_file():
            url = 'data:' + mime + ';base64,' + base64.b64encode(asset.read_bytes()).decode('ascii')
            html = html.replace('./' + filename, url)
    return html


st.set_page_config(page_title='Budzik Invitational', page_icon='🏈', layout='wide', initial_sidebar_state='collapsed')
st.markdown('<style>.block-container{padding:0;max-width:100%}header[data-testid="stHeader"]{height:0}iframe{border:0}</style>', unsafe_allow_html=True)
try:
    components.html(website_html(), height=1500, scrolling=True)
except FileNotFoundError as exc:
    st.error(str(exc))
