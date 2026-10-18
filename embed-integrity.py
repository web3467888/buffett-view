from pathlib import Path
root=Path(__file__).parent
p=root/'index.html'
s=p.read_text(encoding='utf-8')
marker='/* DATA_INTEGRITY_START */'
if marker in s:
    a=s.index(marker);b=s.index('/* DATA_INTEGRITY_END */',a)+len('/* DATA_INTEGRITY_END */')
    s=s[:a]+s[b:]
s=s.replace('<script src="data-integrity.js"></script>','')
fix=(root/'data-integrity.js').read_text(encoding='utf-8')
if (root/'screener-v2.js').exists():
    fix+='\n'+(root/'screener-v2.js').read_text(encoding='utf-8')
s=s.replace('/* init */',marker+'\n'+fix+'\n/* DATA_INTEGRITY_END */\n\n/* init */',1)
if 'id="research-style"' not in s:
    s=s.replace('</head>','<style id="research-style">.scr-scan-body input[type=number]{display:inline-block;width:72px;margin:4px 8px;padding:5px 7px}.scr-stock-detail input[type=url]{width:min(100%,380px);padding:8px;border:1px solid var(--line);border-radius:8px}.scr-stock-detail details{margin-top:12px;overflow-wrap:anywhere}.scr-stock-detail details a{margin-right:8px}.scr-stock-head button{color:var(--navy);font:inherit;cursor:pointer}.scr-cond-head:focus-visible,.scr-stock-head button:focus-visible{outline:2px solid var(--green);outline-offset:3px}.scr-cond-head:disabled{opacity:.65;cursor:not-allowed}.scr-cond input[type=range]{width:90%;margin:12px 5%}.scr-signal small{display:block;line-height:1.7;margin-top:5px}</style></head>')
if 'id="screener-controls-style"' not in s:
    s=s.replace('</head>','<style id="screener-controls-style">@media(min-width:861px){.scr-side{top:76px;max-height:calc(100dvh - 92px);overflow-y:auto;overscroll-behavior:contain}}.scr-stock.expanded .scr-stock-detail{display:block}.scr-cond input[type=range]{margin-top:8px;margin-bottom:8px}</style></head>')
p.write_text(s,encoding='utf-8')
