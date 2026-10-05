"""Reader view: fetches a web page and keeps only the article (text, headings, lists, tables, images), without
scripts, ads, menus, comments or sidebars. Standard library only, so the plugin and the server both use it.

The result's `html` uses a small set of plain tags with no styles or scripts, and only http(s) links and images.
Whatever shows it should still treat it as untrusted and filter it again (the plugin does)."""

import gzip
import html
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from html.parser import HTMLParser

MAX_BYTES = 6 * 1024 * 1024
MAX_HTML = 1_500_000
USER_AGENT = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36")

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
# Never part of an article.
DROP = {"script", "style", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "button",
        "input", "select", "textarea", "label", "nav", "footer", "aside", "svg", "canvas", "video", "audio", "template",
        "dialog", "map", "link", "meta", "head", "title"}
# Starting one of these closes an open <p>.
BLOCK = {"address", "article", "aside", "blockquote", "div", "dl", "fieldset", "figure", "footer", "form", "h1", "h2",
         "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"}

# Class/id words that mark clutter: ads, sharing, comments, related links, cookie banners and the like.
JUNK = re.compile(
    r"(^|[-_])(ads?|adv|advert\w*|adsbygoogle|adslot|adunit|adwrap\w*|dfp|gpt|sponsor\w*|promo\w*|banner|cookie\w*|"
    r"consent|gdpr|newsletter|subscribe|popup|modal|overlay|social|share\w*|sharing|related|recommend\w*|outbrain|"
    r"taboola|comments?|disqus|sidebar|rail|widget|breadcrumbs?|navbox|navigation|menu|toc|editsection|"
    r"mw-editsection|noprint|print-?only|skip|hidden|visually-?hidden|sr-only|signup|login|paywall)([-_]|$)", re.I)
GOOD = re.compile(r"article|body|content|entry|main|page|post|text|blog|story|guide|wiki|mw-parser-output|prose|recipe", re.I)
BAD = re.compile(r"comment|meta|footer|footnote|sidebar|sponsor|related|share|social|widget|promo|nav|menu|masthead|"
                 r"header|banner|popup|subscribe|author-bio|tags?$", re.I)
# Containers sites use for the article itself.
KNOWN = re.compile(r"(^|\s)(mw-parser-output|entry-content|post-content|article-body|article-content|"
                   r"story-body|post-body|content-body|wiki-content|page-content|gamefaqs-guide|faqtext)(\s|$)", re.I)

OUT_TAGS = {"p", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "img", "figure", "figcaption", "blockquote",
            "pre", "code", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "strong", "em", "b", "i",
            "u", "s", "sub", "sup", "br", "hr", "dl", "dt", "dd", "div", "small", "mark", "kbd"}
RENAME = {"h1": "h2", "section": "div", "article": "div", "main": "div", "header": "div", "center": "div",
          "font": None, "span": None, "abbr": None, "cite": "em", "var": "em", "tt": "code", "strike": "s", "del": "s",
          "ins": "u", "big": None, "time": None, "picture": None, "details": "div", "summary": "strong", "q": None}


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children = []
        self.parent = parent

    def text(self) -> str:
        out = []
        stack = [self]
        while stack:
            n = stack.pop()
            if isinstance(n, str):
                out.append(n)
            else:
                stack.extend(reversed(n.children))
        return re.sub(r"\s+", " ", "".join(out)).strip()

    def iter(self):
        stack = [self]
        while stack:
            n = stack.pop()
            if isinstance(n, Node):
                yield n
                stack.extend(reversed(n.children))

    def words(self) -> str:
        return f"{self.attrs.get('class', '')} {self.attrs.get('id', '')}"


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root
        self.meta = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content"):
                self.meta.setdefault(key, a["content"])
            return
        if tag == "title":
            self._in_title = True
            return
        if tag in BLOCK or tag in ("li", "dt", "dd", "tr", "td", "th"):
            self._close_implied(tag)
        node = Node(tag, a, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def _close_implied(self, tag):
        closes = {"li": {"li"}, "dt": {"dt", "dd"}, "dd": {"dt", "dd"}, "tr": {"tr", "td", "th"},
                  "td": {"td", "th"}, "th": {"td", "th"}}.get(tag, set()) | ({"p"} if tag in BLOCK else set())
        n = self.cur
        while n is not self.root:
            if n.tag in closes:
                self.cur = n.parent
                return
            if n.tag in ("div", "table", "ul", "ol", "dl", "section", "article", "td", "th", "blockquote", "body"):
                return
            n = n.parent

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.cur.tag == tag:
            self.cur = self.cur.parent

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
            return
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif data:
            self.cur.children.append(data)


# ---- fetching ----

def fetch(url: str, timeout: int = 20, context=None):
    """Returns (final URL, HTML text)."""
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
    })
    with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
        ctype = resp.headers.get("Content-Type", "")
        if ctype and not re.search(r"html|xml|text/plain", ctype, re.I):
            raise ValueError("That link isn't a web page")
        raw = resp.read(MAX_BYTES + 1)
        enc = (resp.headers.get("Content-Encoding") or "").lower()
        final = resp.geturl()
    if enc == "gzip":
        raw = gzip.decompress(raw)
    elif enc == "deflate":
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    charset = None
    m = re.search(r"charset=([\w-]+)", ctype, re.I) or re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", raw[:4096], re.I)
    if m:
        charset = m.group(1).decode() if isinstance(m.group(1), bytes) else m.group(1)
    try:
        text = raw.decode(charset or "utf-8", errors="replace")
    except LookupError:
        text = raw.decode("utf-8", errors="replace")
    if "text/plain" in ctype.lower():
        text = "<pre>" + html.escape(text) + "</pre>"
    return final, text


# ---- picking the article ----

def _hidden(n: Node) -> bool:
    a = n.attrs
    style = a.get("style", "").replace(" ", "").lower()
    return ("hidden" in a or a.get("aria-hidden") == "true" or "display:none" in style or "visibility:hidden" in style
            or a.get("role") in ("navigation", "complementary", "banner", "contentinfo", "dialog", "search"))


def _junk(n: Node) -> bool:
    if n.tag in ("html", "body", "article", "main") or KNOWN.search(n.attrs.get("class", "")):
        return False
    if not any(JUNK.search(w) for w in n.words().split()):
        return False
    # Page-wide wrappers get names like "has-sidebar" too; never throw away something holding the article.
    for d in n.iter():
        if d is not n and (d.tag in ("article", "main") or KNOWN.search(d.attrs.get("class", ""))
                           or d.attrs.get("itemprop") == "articleBody"):
            return False
    text = len(n.text())
    return text < 4000 or _link_density(n, text) > 0.4


def _clean(node: Node):
    keep = []
    for c in node.children:
        if isinstance(c, Node) and (c.tag in DROP or _hidden(c) or _junk(c)):
            continue
        if isinstance(c, Node):
            _clean(c)
        keep.append(c)
    node.children = keep


def _link_density(n: Node, text_len: int) -> float:
    if not text_len:
        return 1.0
    links = sum(len(a.text()) for a in n.iter() if a.tag == "a")
    return min(1.0, links / text_len)


def _class_weight(n: Node) -> int:
    w = 0
    for value in (n.attrs.get("class", ""), n.attrs.get("id", "")):
        if not value:
            continue
        if GOOD.search(value):
            w += 25
        if BAD.search(value):
            w -= 25
    return w


def _pick(root: Node) -> Node:
    # A container the site itself marks as the article wins outright when it holds real text.
    for n in root.iter():
        if KNOWN.search(n.attrs.get("class", "")) or n.attrs.get("itemprop") == "articleBody":
            if len(n.text()) > 300:
                return n
    scores = {}
    base = {"div": 5, "article": 10, "main": 8, "section": 3, "pre": 3, "td": 3, "blockquote": 3,
            "ol": -3, "ul": -3, "dl": -3, "form": -3, "th": -5, "h2": -5, "h3": -5, "h4": -5}

    def init(n: Node):
        if id(n) not in scores:
            scores[id(n)] = [n, base.get(n.tag, 0) + _class_weight(n)]
        return scores[id(n)]

    for p in root.iter():
        if p.tag not in ("p", "pre", "td", "li", "blockquote"):
            continue
        t = p.text()
        if len(t) < 25:
            continue
        score = 1 + t.count(",") + min(len(t) // 100, 3)
        parent, grand = p.parent, p.parent.parent if p.parent else None
        if parent is not None:
            init(parent)[1] += score
        if grand is not None:
            init(grand)[1] += score / 2
    best, best_score = None, 0.0
    for n, s in scores.values():
        t = len(n.text())
        final = s * (1 - _link_density(n, t))
        if final > best_score:
            best, best_score = n, final
    if best is None:
        body = next((n for n in root.iter() if n.tag == "body"), root)
        return body
    # Articles split over sibling blocks: climb while the parent adds a lot of text without adding links.
    while best.parent is not None and best.parent.tag not in ("body", "#root", "html"):
        mine, theirs = len(best.text()), len(best.parent.text())
        if theirs > mine * 1.6 or _link_density(best.parent, theirs) > 0.35:
            break
        best = best.parent
    return best


# ---- writing it out ----

def _abs(base: str, url: str):
    url = (url or "").strip()
    if not url or url.startswith(("data:", "javascript:", "#", "mailto:", "tel:")):
        return None
    full = urllib.parse.urljoin(base, url)
    return full if full.startswith(("http://", "https://")) else None


def _img_src(base: str, a: dict):
    for key in ("data-src", "data-lazy-src", "data-original", "data-url", "src"):
        src = _abs(base, a.get(key, ""))
        if src:
            return src
    srcset = a.get("data-srcset") or a.get("srcset") or ""
    first = srcset.split(",")[0].strip().split(" ")[0] if srcset else ""
    return _abs(base, first)


def _render(n, base: str, out: list):
    if isinstance(n, str):
        out.append(html.escape(n, quote=False))
        return
    tag = n.tag
    tag = RENAME.get(tag, tag) if tag in RENAME else tag
    if tag not in OUT_TAGS:  # unknown wrapper: keep what's inside
        for c in n.children:
            _render(c, base, out)
        return
    a = n.attrs
    if tag == "img":
        src = _img_src(base, a)
        try:
            tiny = int(a.get("width", "99")) <= 2 or int(a.get("height", "99")) <= 2
        except ValueError:
            tiny = False
        if src and not tiny:
            alt = html.escape(a.get("alt", "")[:300])
            out.append(f'<img src="{html.escape(src)}" alt="{alt}">')
        return
    if tag in ("br", "hr"):
        out.append(f"<{tag}>")
        return
    if tag == "div" and _link_farm(n):
        return
    attrs = ""
    if tag == "a":
        href = _abs(base, a.get("href", ""))
        if not href:  # in-page or script link: keep the words only
            for c in n.children:
                _render(c, base, out)
            return
        attrs = f' href="{html.escape(href)}"'
    elif tag in ("td", "th"):
        for k in ("colspan", "rowspan"):
            if a.get(k, "").isdigit():
                attrs += f' {k}="{min(int(a[k]), 50)}"'
    out.append(f"<{tag}{attrs}>")
    for c in n.children:
        _render(c, base, out)
    out.append(f"</{tag}>")


def _link_farm(n: Node) -> bool:
    """Short blocks that are nothing but links: breadcrumbs, tag clouds, "more guides" strips."""
    t = n.text()
    if not t or len(t) > 300:
        return False
    links = [a for a in n.iter() if a.tag == "a"]
    return len(links) >= 2 and _link_density(n, len(t)) > 0.8


def _tidy(markup: str) -> str:
    # Drop empty paragraphs/containers left behind once clutter is gone.
    for _ in range(3):
        markup = re.sub(r"<(p|div|li|figure|blockquote|strong|em|b|i|span|ul|ol|h\d)>\s*</\1>", "", markup)
    return re.sub(r"\n{3,}", "\n\n", markup)


# Wikis (Fandom, wiki.gg, Wikipedia) put their pages behind bot checks but answer MediaWiki's API, which also
# gives just the article.
WIKI_HOSTS = re.compile(r"(\.|^)(fandom\.com|wiki\.gg|wikipedia\.org|wiktionary\.org|wikia\.org)$", re.I)


def _wiki(url: str, context=None):
    parts = urllib.parse.urlsplit(url)
    m = re.match(r"^/(?:[a-z-]+/)?wiki/(.+)$", parts.path)
    if not m:
        return None
    title = urllib.parse.unquote(m.group(1))
    lang = re.match(r"^/([a-z-]+)/wiki/", parts.path)
    for api in ([f"/{lang.group(1)}/api.php"] if lang else []) + ["/api.php", "/w/api.php"]:
        q = urllib.parse.urlencode({"action": "parse", "page": title, "format": "json", "formatversion": "2",
                                    "prop": "text|displaytitle", "redirects": "1", "disableeditsection": "1"})
        req = urllib.request.Request(f"{parts.scheme}://{parts.netloc}{api}?{q}", headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=20, context=context) as resp:
                data = __import__("json").loads(resp.read(MAX_BYTES))
        except Exception:
            continue
        parsed = data.get("parse") if isinstance(data, dict) else None
        if not parsed or not parsed.get("text"):
            continue
        name = re.sub(r"<[^>]+>", "", parsed.get("displaytitle") or parsed.get("title") or title)
        site = re.sub(r"^www\.", "", parts.hostname or "")
        page = (f"<html><head><title>{html.escape(name)}</title><meta property=\"og:site_name\" content=\"{site}\">"
                f"</head><body><article>{parsed['text']}</article></body></html>")
        return extract_html(url, page)
    return None


def extract(url: str, context=None) -> dict:
    """Fetches `url` and returns {url, title, site, image, excerpt, html, length, fetchedAt}."""
    if not re.match(r"^https?://", url or "", re.I):
        raise ValueError("Only web links (http or https) can be opened")
    host = urllib.parse.urlsplit(url).hostname or ""
    if WIKI_HOSTS.search(host):
        r = _wiki(url, context)
        if r:
            return r
    try:
        final, page = fetch(url, context=context)
    except urllib.error.HTTPError as e:
        r = _wiki(url, context) if e.code in (403, 429, 503) else None
        if r:
            return r
        raise ValueError(f"The site answered {e.code}" + (" (it blocks reader views)" if e.code in (403, 429, 503) else ""))
    except urllib.error.URLError as e:
        raise ValueError(f"Couldn't reach the site: {e.reason}")
    return extract_html(final, page)


def extract_html(url: str, page: str) -> dict:
    tb = TreeBuilder()
    try:
        tb.feed(page)
        tb.close()
    except Exception:
        pass  # html.parser copes with nearly anything; keep whatever it built
    root = tb.root
    _clean(root)
    best = _pick(root)
    out = []
    _render(best, url, out)
    body = _tidy("".join(out))[:MAX_HTML]
    meta = tb.meta
    title = (meta.get("og:title") or tb.title or "").strip()
    host = urllib.parse.urlsplit(url).hostname or ""
    site = html.unescape(meta.get("og:site_name") or re.sub(r"^www\.", "", host)).strip()
    image = _abs(url, meta.get("og:image", "")) or None
    text = best.text()
    return {"url": url, "title": html.unescape(title)[:300], "site": site[:100], "image": image,
            "excerpt": html.unescape(meta.get("og:description") or meta.get("description") or text[:200]).strip()[:300],
            "html": body, "length": len(text), "fetchedAt": int(time.time() * 1000)}


if __name__ == "__main__":  # python3 reader.py <url>
    import json
    import sys
    r = extract(sys.argv[1])
    print(json.dumps({k: v for k, v in r.items() if k != "html"}, indent=2))
    print(r["html"][:3000])
