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
s=s.replace('/* init */',marker+'\n'+fix+'\n/* DATA_INTEGRITY_END */\n\n/* init */',1)
p.write_text(s,encoding='utf-8')

