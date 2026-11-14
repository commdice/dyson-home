#!/usr/bin/env python3
"""Approximate renderer for watchface.xml -> SVG, for previews.

Covers only the WFF subset this face uses (Rectangle, RoundRectangle,
PartText, DigitalClock, Group/Variant, BooleanConfiguration, colour themes).
It is not the real Wear OS renderer, but it validates the XML and gives a
faithful layout preview.

Usage: render_preview.py <watchface.xml> <out.svg> [theme_id] [--ambient]
"""
import re
import sys
import xml.etree.ElementTree as ET
from html import escape

SAMPLE = {
    "DAY_OF_WEEK_S": "Sat", "DAY": "14", "MONTH_S": "Nov",
    "YEAR": 2026, "DAY_OF_YEAR": 318, "HOUR_0_23": 10,
    "BATTERY_PERCENT": "82", "STEP_COUNT": "6402", "HEART_RATE": "71",
}
TIME = {"hh:mm": "10:08", "ss": "32"}
FONT = "'Antonio','Inter','Liberation Sans',sans-serif"


def argb(c):
    c = c.lstrip("#")
    a, rgb = int(c[:2], 16) / 255, c[2:]
    return f"#{rgb}", a


def main():
    src, out = sys.argv[1], sys.argv[2]
    theme = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else None
    ambient = "--ambient" in sys.argv
    root = ET.parse(src).getroot()
    W, H = int(root.get("width")), int(root.get("height"))

    cfg = root.find("UserConfigurations/ColorConfiguration")
    theme = theme or cfg.get("defaultValue")
    colors = next(o for o in cfg if o.get("id") == theme).get("colors").split()

    def color(v):
        m = re.fullmatch(r"\[CONFIGURATION\.theme\.(\d)\]", v)
        return argb(colors[int(m.group(1))] if m else v)

    def evaluate(expr):
        e = re.sub(r"\[(\w+)\]", lambda m: str(SAMPLE[m.group(1)]), expr)
        if re.fullmatch(r"[\d\s+\-*/()]+", e):
            return str(int(eval(e.replace("/", "//"))))  # WFF int maths
        return e

    parts = []

    def hidden(el):
        v = el.find("Variant")
        return ambient and v is not None and v.get("mode") == "AMBIENT" and v.get("value") == "0"

    def dim(el):
        v = el.find("Variant")
        if ambient and v is not None and v.get("mode") == "AMBIENT":
            return int(v.get("value")) / 255
        return 1.0

    def text(x, y, w, h, align, font, s, opacity):
        size = float(font.get("size"))
        fill, a = color(font.get("color"))
        anchor = {"START": "start", "CENTER": "middle", "END": "end"}[align]
        tx = {"start": x, "middle": x + w / 2, "end": x + w}[anchor]
        weight = "700" if font.get("weight") == "BOLD" else "400"
        parts.append(
            f'<text x="{tx}" y="{y + h / 2}" font-family="{FONT}" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" fill-opacity="{a * opacity:.2f}" '
            f'text-anchor="{anchor}" dominant-baseline="central">{escape(s)}</text>')

    def walk(node):
        for el in node:
            tag = el.tag
            if tag == "Group":
                if not hidden(el):
                    walk(el)
            elif tag == "BooleanConfiguration":
                for opt in el:
                    if opt.get("id") == "TRUE":
                        walk(opt)
            elif tag == "PartDraw":
                if hidden(el):
                    continue
                for shape in el:
                    fill, a = color(shape.find("Fill").get("color"))
                    g = {k: shape.get(k) for k in ("x", "y", "width", "height")}
                    r = shape.get("cornerRadiusX", "0")
                    parts.append(
                        f'<rect x="{g["x"]}" y="{g["y"]}" width="{g["width"]}" height="{g["height"]}" '
                        f'rx="{r}" fill="{fill}" fill-opacity="{a}"/>')
            elif tag == "PartText":
                if hidden(el):
                    continue
                t = el.find("Text")
                font = t.find("Font")
                tpl = font.find("Template")
                s = (tpl.text or "").replace("%%", "\0")
                for p in tpl.findall("Parameter"):
                    s = s.replace("%s", evaluate(p.get("expression")), 1)
                s = s.replace("\0", "%")
                text(*(float(el.get(k)) for k in ("x", "y", "width", "height")),
                     t.get("align", "START"), font, s, dim(el))
            elif tag == "DigitalClock":
                if hidden(el):
                    continue
                tt = el.find("TimeText")
                text(*(float(el.get(k)) for k in ("x", "y", "width", "height")),
                     tt.get("align", "START"), tt.find("Font"), TIME[tt.get("format")], dim(el))

    walk(root.find("Scene"))
    bg = root.find("Scene").get("backgroundColor")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
           f'<defs><clipPath id="c"><circle cx="{W/2}" cy="{H/2}" r="{W/2}"/></clipPath></defs>'
           f'<g clip-path="url(#c)"><rect width="{W}" height="{H}" fill="{argb(bg)[0]}"/>'
           + "".join(parts) + "</g></svg>")
    open(out, "w").write(svg)


if __name__ == "__main__":
    main()
