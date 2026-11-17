#!/usr/bin/env python3
"""Approximate renderer for watchface.xml -> SVG, for previews.

Covers only the WFF subset this face uses (Rectangle, RoundRectangle,
PartText, DigitalClock, Group/Variant, BooleanConfiguration, colour themes).
It is not the real Wear OS renderer, but it validates the XML and gives a
faithful layout preview.

Usage: render_preview.py <watchface.xml> <out.svg> [theme_id] [--ambient] [--t SECONDS]
  --t sets the moment (seconds past the minute, e.g. 32.4) for animated parts.
"""
import math
import re
import sys
import xml.etree.ElementTree as ET
from html import escape

SAMPLE = {
    "DAY_OF_WEEK_S": "Sat", "DAY": "14", "MONTH_S": "Nov",
    "YEAR": 2026, "DAY_OF_YEAR": 318, "HOUR_0_23": 10,
    "BATTERY_PERCENT": "82", "STEP_COUNT": "6402", "HEART_RATE": "71",
    "HOUR_1_12": "10", "HOUR_0_23_Z": "10", "MINUTE_Z": "08", "SECOND_Z": "32",
    "MINUTE": 8, "SECOND": 32, "SECOND_MILLISECOND": 32.4,
}
# Sample complication text per slotId (weather, unread count, altitude).
COMPLICATION_SAMPLE = {"0": "12°", "1": "3", "2": "148m"}
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
    if "--t" in sys.argv:
        t = float(sys.argv[sys.argv.index("--t") + 1])
        SAMPLE.update(SECOND_MILLISECOND=t, SECOND=int(t), SECOND_Z=f"{int(t):02d}")
    root = ET.parse(src).getroot()
    W, H = int(root.get("width")), int(root.get("height"))

    cfg = root.find("UserConfigurations/ColorConfiguration")
    theme = theme or cfg.get("defaultValue")
    colors = next(o for o in cfg if o.get("id") == theme).get("colors").split()

    def color(v):
        m = re.fullmatch(r"\[CONFIGURATION\.theme\.(\d)\]", v)
        return argb(colors[int(m.group(1))] if m else v)

    def evaluate(expr):
        e = re.sub(r"\[([\w.]+)\]", lambda m: str(SAMPLE[m.group(1)]), expr)
        if re.search(r"[+\-*/%]|floor|clamp", e):
            v = eval(e, {"floor": math.floor, "abs": abs,
                         "clamp": lambda x, lo, hi: max(lo, min(hi, x))})  # WFF maths is floating point
            return f"{v:.3f}".rstrip("0").rstrip(".")  # watch prints <= 3 decimals
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

    def walk(node, ox=0.0, oy=0.0):
        for el in node:
            tag = el.tag
            if tag == "Group":
                if not hidden(el):
                    walk(el, ox, oy)
            elif tag == "ListConfiguration":
                for opt in el:
                    if opt.get("id") == "0":
                        walk(opt, ox, oy)
            elif tag == "BooleanConfiguration":
                for opt in el:
                    if opt.get("id") == "TRUE":
                        walk(opt, ox, oy)
            elif tag == "ComplicationSlot":
                SAMPLE["COMPLICATION.TEXT"] = COMPLICATION_SAMPLE.get(el.get("slotId"), "--")
                for comp in el.findall("Complication"):
                    if comp.get("type") == "SHORT_TEXT":
                        walk(comp, ox + float(el.get("x")), oy + float(el.get("y")))
            elif tag == "PartDraw":
                if hidden(el):
                    continue
                part_alpha = 1.0
                for tr in el.findall("Transform"):
                    if tr.get("target") == "alpha":
                        part_alpha = float(evaluate(tr.get("value"))) / 255
                for shape in el:
                    if shape.find("Fill") is None:
                        continue  # Transform / Variant
                    fill, a = color(shape.find("Fill").get("color"))
                    a *= part_alpha
                    if a <= 0:
                        continue
                    x, y, w, h = (float(shape.get(k)) for k in ("x", "y", "width", "height"))
                    for tr in shape.findall("Transform"):
                        if tr.get("target") == "x":
                            x = float(evaluate(tr.get("value")))
                    x, y = x + ox, y + oy
                    if shape.tag == "Ellipse":
                        parts.append(f'<ellipse cx="{x + w / 2}" cy="{y + h / 2}" rx="{w / 2}" ry="{h / 2}" '
                                     f'fill="{fill}" fill-opacity="{a}"/>')
                    else:
                        r = shape.get("cornerRadiusX", "0")
                        parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" '
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
                x, y, w, h = (float(el.get(k)) for k in ("x", "y", "width", "height"))
                text(x + ox, y + oy, w, h, t.get("align", "START"), font, s, dim(el))

    walk(root.find("Scene"))
    bg = root.find("Scene").get("backgroundColor")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
           f'<defs><clipPath id="c"><circle cx="{W/2}" cy="{H/2}" r="{W/2}"/></clipPath></defs>'
           f'<g clip-path="url(#c)"><rect width="{W}" height="{H}" fill="{argb(bg)[0]}"/>'
           + "".join(parts) + "</g></svg>")
    open(out, "w").write(svg)


if __name__ == "__main__":
    main()
