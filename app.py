"""Streamlit entry point for the Budzik Invitational static website."""
from pathlib import Path
import base64
import re
import runpy

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="Budzik Invitational", page_icon="🏈", layout="wide")
ROOT = Path(__file__).resolve().parent


def make_page():
    # Rebuild from the editable sources so updated history.json reaches the page.
    if (ROOT / "build.py").exists():
        runpy.run_path(str(ROOT / "build.py"), run_name="__main__")
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "style.css").read_text(encoding="utf-8")
    javascript = (ROOT / "bundle.js").read_text(encoding="utf-8")
    page = page.replace('<link rel="stylesheet" href="./style.css">', '<style>' + css + '</style>')
    page = page.replace('<script src="./bundle.js" defer></script>', '<script>' + javascript.replace('</script', '<\\/script') + '</script>')
    # Relative downloads and icons need embedded URLs inside the Streamlit iframe.
    def embed(match):
        name = match.group(1)
        file = ROOT / name
        if not file.is_file():
            return match.group(0)
        mime = {'json': 'application/json', 'svg': 'image/svg+xml', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}.get(file.suffix[1:])
        if not mime:
            return match.group(0)
        encoded = base64.b64encode(file.read_bytes()).decode('ascii')
        return 'href="data:' + mime + ';base64,' + encoded + '"'
    return re.sub(r'href="\./([^"#?]+)"', embed, page)


try:
    page = make_page()
except Exception as exc:
    st.error(f"Could not load the league files: {exc}")
    st.info("Keep app.py in the same folder as build.py, index.html, bundle.js, style.css, and history.json.")
    st.stop()

components.html(page, height=1000, scrolling=True)
