#!/usr/bin/env python3
"""Extract CSS embedded in archived Pivotal Tracker webpack bundles.

Tracker's app bundles ship CSS as style-loader/css-loader modules: the stylesheet
text lives inside ordinary JS string literals (`exports.push([module.id, "...css..."])`,
`exports = "..."`, or JSON-escaped CSS inside template literals). This scans every
string literal in a bundle, keeps the ones that look like CSS, un-escapes them and
writes one pretty-printed .css per input file.

Usage: python3 extract-css.py <file-or-dir> [...]  (defaults to the archived asset tree)
Output: docs/reference/tracker/assets/extracted/<basename>.css  (idempotent)
"""
import os, re, sys, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..",
                                    "docs", "reference", "tracker", "assets"))
OUT = os.path.join(ROOT, "extracted")

CSSY = re.compile(r"[.#\[:a-zA-Z@][^{}]{0,300}\{[^{}]*[a-z-]+\s*:", re.S)


# css-loader emits `exports.push([module.id, "<css>", ""])`; other loaders assign
# the stylesheet straight to `exports`. Anchoring on a literal's opening quote (rather
# than tokenizing the whole bundle) keeps a stray apostrophe in minified JS from
# desynchronising the scan and swallowing megabytes of code.
ANCHOR = re.compile(r"""[,\(\[:=]\s*"|exports\s*=\s*"|`""")


def read_literal(src, i):
    """Parse the JS string literal whose opening quote is at src[i]; return (body, end)."""
    q, j, n, buf = src[i], i + 1, len(src), []
    while j < n:
        d = src[j]
        if d == "\\":
            buf.append(src[j:j + 2]); j += 2; continue
        if d == q:
            return "".join(buf), j
        if d == "\n" and q != "`":
            return None, j
        buf.append(d); j += 1
    return None, n


CONCAT = re.compile(r'\s*\+\s*[^"\'`+]{1,300}\+\s*"')


def scan_literals(src):
    """Yield (quote, body) pairs, re-joining `"...css..." + n(42) + "...css..."`
    concatenations that css-loader uses to splice in asset URLs."""
    for m in ANCHOR.finditer(src):
        i = m.end() - 1
        body, end = read_literal(src, i)
        if not body:
            continue
        if src[i] == '"':
            while True:
                c = CONCAT.match(src, end + 1)
                if not c:
                    break
                more, end = read_literal(src, c.end() - 1)
                if more is None:
                    break
                body += "__ASSET_URL__" + more
        yield src[i], body


_ESC = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def _unesc_sub(m):
    e = m.group(1)
    if e[0] == "u":
        try:
            ch = chr(int(e[1:], 16))
            return "" if 0xD800 <= ord(ch) <= 0xDFFF else ch
        except ValueError:
            return e
    if e[0] == "x":
        try:
            return chr(int(e[1:], 16))
        except ValueError:
            return e
    if e == "\n":
        return ""  # line continuation
    return _ESC.get(e, e)


def unescape(q, body):
    if q == '"':
        try:
            return json.loads('"' + body + '"').encode("utf-8", "replace").decode("utf-8")
        except Exception:
            pass
    return re.sub(r"\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\n|.)", _unesc_sub, body, flags=re.S)


def looks_like_css(s):
    if len(s) < 60 or "{" not in s or "}" not in s:
        return False
    if not CSSY.search(s):
        return False
    # reject JS/JSON blobs that merely contain braces
    if s.count(";") < 1:
        return False
    # reject minified JS that merely contains braces
    return not re.search(r"function\s*\([\w,$ ]*\)\s*\{|;\s*return[ (]|=>\s*[{(]", s)


def prettify(css):
    if css.count("\n") * 200 < len(css):  # minified-ish: re-break it
        css = re.sub(r"\s*\{\s*", " {\n  ", css)
        css = re.sub(r";\s*", ";\n  ", css)
        css = re.sub(r"\s*\}\s*", "\n}\n", css)
    css = re.sub(r"[ \t]+\n", "\n", css)
    css = re.sub(r"\n{3,}", "\n\n", css)
    return css.strip() + "\n"


def extract(path):
    src = open(path, "r", encoding="utf-8", errors="replace").read()
    seen, parts = set(), []
    for q, body in scan_literals(src):
        if "{" not in body:
            continue
        s = unescape(q, body)
        if looks_like_css(s) and s not in seen:
            seen.add(s)
            parts.append(prettify(s))
    return parts


def main(argv):
    targets = []
    for a in (argv or [ROOT]):
        a = os.path.abspath(a)
        if os.path.isdir(a):
            for dp, _, fs in os.walk(a):
                if os.path.abspath(dp).startswith(OUT):
                    continue
                for f in fs:
                    if f.endswith(".js"):
                        targets.append(os.path.join(dp, f))
        else:
            targets.append(a)
    os.makedirs(OUT, exist_ok=True)
    for t in sorted(targets):
        parts = extract(t)
        if not parts:
            print("%-70s no CSS" % os.path.relpath(t, ROOT))
            continue
        name = os.path.basename(t)[:-3] + ".css"
        dest = os.path.join(OUT, name)
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write("/* Extracted from %s by scripts/tracker-corpus/extract-css.py */\n"
                     % os.path.relpath(t, ROOT))
            for i, p in enumerate(parts):
                fh.write("\n/* ---- css module %d ---- */\n" % (i + 1))
                fh.write(p)
        print("%-70s %d modules -> extracted/%s (%d bytes)"
              % (os.path.relpath(t, ROOT), len(parts), name, os.path.getsize(dest)))


if __name__ == "__main__":
    main(sys.argv[1:])
