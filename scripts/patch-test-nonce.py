import re, glob, pathlib
# keyed on a nonce so a random port collision never reopens a previous run's IndexedDB
pat = re.compile(r'(chrome-[a-z]+-\$\{port\})')
n = 0
for f in glob.glob("test/*.mjs"):
    p = pathlib.Path(f)
    t = p.read_text(encoding="utf-8")
    if '${Date.now().toString(36)}' in t:
        continue
    new = pat.sub(lambda m: m.group(1) + '-${Date.now().toString(36)}', t)
    if new != t:
        p.write_text(new, encoding="utf-8")
        n += 1
print("patched", n, "files")
