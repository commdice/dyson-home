#!/usr/bin/env python3
"""Generator for the Warp Drive watch face.

Writes app/src/main/res/raw/watchface.xml (Watch Face Format v1), and can
render preview frames as SVG using the same maths, so the preview and the
watch stay in sync.

  python3 tools/generate.py                        # regenerate watchface.xml
  python3 tools/generate.py --frame 21.5 out.svg   # preview at second 21.5
        [--speed 0|1|2] [--accent 0..3] [--ambient] [--no-ship]
"""
import math
import random
import sys
from pathlib import Path

W = H = 450
C = W / 2
L = 250            # distance a star travels before it wraps (past the edge)
N_STARS = 64
SEED = 1701

# id, label string, seconds per star trip (must divide 60 for a seamless loop),
# streak stretch factor
SPEEDS = [
    ("0", "speed_impulse", 6.0, 0.05),
    ("1", "speed_warp5", 3.0, 0.14),
    ("2", "speed_warp9", 1.5, 0.30),
]
DEFAULT_SPEED = "1"

ACCENTS = [
    ("0", "accent_ice", "#FF7FD4FF"),
    ("1", "accent_gold", "#FFFFCC66"),
    ("2", "accent_red", "#FFFF6F61"),
    ("3", "accent_teal", "#FF66FFCC"),
]

T = "[SECOND_MILLISECOND]"
SHIP_START, SHIP_SPEED, SHIP_X0 = 20, 60, -170   # ship enters at second 20
SHIP_Y = 287
SHIP_SCALE = 1.3


def stars():
    rnd = random.Random(SEED)
    out = []
    for i in range(N_STARS):
        angle = round(i * (360 / N_STARS) + rnd.uniform(-4, 4), 1)
        phase = round(rnd.uniform(0, L), 1)
        thick = rnd.choice([2, 2, 3])
        color = rnd.choice(["#FFFFFFFF", "#FFFFFFFF", "#FFCFE8FF", "#FFE8F0FF"])
        out.append((angle, phase, thick, color))
    return out


# Ship geometry (unscaled), relative to (0, SHIP_Y); faces right. Original design:
# a slim needle hull with twin nacelles and a glowing engine wake.
SHIP = [
    # (kind, x, y, w, h, radius, color)
    ("rrect", -64, 19, 64, 6, 3, "#5566CCFF"),       # engine wake (outer)
    ("rrect", -36, 20, 36, 4, 2, "#9999DDFF"),       # engine wake (inner)
    ("rect", 40, 8, 6, 10, 0, "#FF7A8796"),          # upper pylon
    ("rect", 40, 28, 6, 10, 0, "#FF7A8796"),         # lower pylon
    ("rrect", 0, 0, 64, 9, 4, "#FF8A98A8"),          # upper nacelle
    ("rrect", 4, 2, 52, 5, 2, "#FF66CCFF"),          # upper nacelle glow
    ("rrect", 0, 37, 64, 9, 4, "#FF8A98A8"),         # lower nacelle
    ("rrect", 4, 39, 52, 5, 2, "#FF66CCFF"),         # lower nacelle glow
    ("rect", 58, 2, 6, 5, 0, "#FFFF5544"),           # nacelle front caps
    ("rect", 58, 39, 6, 5, 0, "#FFFF5544"),
    ("rrect", 24, 15, 80, 16, 8, "#FFB8C4D0"),       # main hull
    ("ellipse", 92, 12, 34, 22, 0, "#FFDCE4EC"),     # forward hull
    ("rect", 50, 21, 3, 3, 0, "#FFFFF4C0"),          # windows
    ("rect", 60, 21, 3, 3, 0, "#FFFFF4C0"),
    ("rect", 70, 21, 3, 3, 0, "#FFFFF4C0"),
    ("rect", 80, 21, 3, 3, 0, "#FFFFF4C0"),
    ("ellipse", 112, 19, 8, 8, 0, "#FF99DDFF"),      # deflector
]
SHIP = [(k, *(round(v * SHIP_SCALE, 1) for v in g), c) for k, *g, c in SHIP]


# ----------------------------------------------------------------- XML ---

def star_xml(angle, phase, thick, color, trip, stretch):
    speed = round(L / trip, 4)
    d = f"(({T} * {speed} + {phase}) % {L})"
    y = C - thick / 2
    return f"""        <PartDraw x="0" y="0" width="{W}" height="{H}" pivotX="0.5" pivotY="0.5" angle="{angle}">
          <Transform target="alpha" value="clamp(({d} - 50) * 3, 0, 235)" />
          <Rectangle x="{C}" y="{y}" width="4" height="{thick}">
            <Transform target="x" value="{C} + {d}" />
            <Transform target="width" value="3 + {d} * {stretch}" />
            <Fill color="{color}" />
          </Rectangle>
        </PartDraw>"""


def ship_xml():
    shapes = []
    for kind, x, y, w, h, r, color in SHIP:
        tag = {"rect": "Rectangle", "rrect": "RoundRectangle", "ellipse": "Ellipse"}[kind]
        radius = f' cornerRadiusX="{r}" cornerRadiusY="{r}"' if kind == "rrect" else ""
        shapes.append(
            f'          <{tag} x="{x + 100}" y="{y + SHIP_Y}" width="{w}" height="{h}"{radius}>'
            f'<Fill color="{color}" /></{tag}>')
    # Shapes are drawn 100px right of the group origin so the wake (x < 0) stays inside the part.
    x_expr = f"({T} - {SHIP_START}) * {SHIP_SPEED} + {SHIP_X0 - 100}"
    return f"""      <BooleanOption id="TRUE">
        <Group name="starship" x="0" y="0" width="{W}" height="{H}">
          <Variant mode="AMBIENT" target="alpha" value="0" />
          <Transform target="x" value="{x_expr}" />
          <PartDraw x="0" y="0" width="{W}" height="{H}">
{chr(10).join(shapes)}
          </PartDraw>
        </Group>
      </BooleanOption>"""


def text_xml(x, y, w, h, size, color, template, ambient_alpha=None, weight="BOLD"):
    variant = (f'\n      <Variant mode="AMBIENT" target="alpha" value="{ambient_alpha}" />'
               if ambient_alpha is not None else "")
    return f"""    <PartText x="{x}" y="{y}" width="{w}" height="{h}">{variant}
      <Text align="CENTER">
        <Font size="{size}" weight="{weight}" color="{color}">
          <Template>{template}</Template>
        </Font>
      </Text>
    </PartText>"""


def build_xml():
    star_list = stars()
    speed_opts = []
    for sid, _label, trip, stretch in SPEEDS:
        body = "\n".join(star_xml(*s, trip, stretch) for s in star_list)
        speed_opts.append(f"""      <ListOption id="{sid}">
        <Group name="stars_{sid}" x="0" y="0" width="{W}" height="{H}">
          <Variant mode="AMBIENT" target="alpha" value="0" />
{body}
        </Group>
      </ListOption>""")

    accent_opts = "\n".join(
        f'      <ColorOption id="{aid}" displayName="{label}" colors="{col}" />'
        for aid, label, col in ACCENTS)
    speed_cfg = "\n".join(
        f'        <ListOption id="{sid}" displayName="{label}" />'
        for sid, label, _t, _s in SPEEDS)
    accent = "[CONFIGURATION.accent.0]"

    stardate = ('STARDATE %s.%s'
                '<Parameter expression="([YEAR] - 2000) * 1000 + ([DAY_OF_YEAR] * 1000) / 366" />'
                '<Parameter expression="([HOUR_0_23] * 10) / 24" />')

    return f"""<?xml version="1.0" encoding="utf-8"?>
<!--
  Warp Drive - animated warp-speed starfield with a starship flyby.
  GENERATED by tools/generate.py - edit the generator, not this file.
  Watch Face Format v1, 450x450 canvas (scales to Galaxy Watch 7 40/44mm).

  Animation is driven by {T}: every star loop length divides 60 s so
  the minute rollover is seamless. The ship enters at second {SHIP_START}.
  All animated layers are hidden in always-on mode to save battery.
-->
<WatchFace width="{W}" height="{H}">
  <Metadata key="CLOCK_TYPE" value="DIGITAL" />
  <Metadata key="PREVIEW_TIME" value="10:08:24" />

  <UserConfigurations>
    <ColorConfiguration id="accent" displayName="accent_label" defaultValue="0">
{accent_opts}
    </ColorConfiguration>
    <ListConfiguration id="warpSpeed" displayName="speed_label" defaultValue="{DEFAULT_SPEED}">
{speed_cfg}
    </ListConfiguration>
    <BooleanConfiguration id="showShip" displayName="ship_label" defaultValue="TRUE" />
  </UserConfigurations>

  <Scene backgroundColor="#FF000208">

    <!-- ========== WARP STARFIELD ========== -->
    <ListConfiguration id="warpSpeed">
{chr(10).join(speed_opts)}
    </ListConfiguration>

    <!-- ========== STARSHIP FLYBY ========== -->
    <BooleanConfiguration id="showShip">
{ship_xml()}
    </BooleanConfiguration>

    <!-- ========== TEXT ========== -->
{text_xml(80, 100, 290, 34, 24, accent, '%s  %s %s<Parameter expression="[DAY_OF_WEEK_S]" /><Parameter expression="[DAY]" /><Parameter expression="[MONTH_S]" />', 170)}

    <DigitalClock x="75" y="136" width="300" height="116">
      <TimeText format="hh:mm" hourFormat="SYNC_TO_DEVICE" align="CENTER">
        <Font size="100" weight="BOLD" color="#FFFFFFFF" />
      </TimeText>
    </DigitalClock>

{text_xml(90, 254, 270, 30, 20, accent, 'WARP CORE %s%%<Parameter expression="[BATTERY_PERCENT]" />', 0)}

{text_xml(70, 352, 310, 30, 20, accent, stardate, 170)}

  </Scene>
</WatchFace>
"""


# ------------------------------------------------------------- preview ---

def frame_svg(t, speed_id=DEFAULT_SPEED, accent_id="0", ambient=False, ship=True):
    accent = next(c for a, _l, c in ACCENTS if a == accent_id)
    acc = "#" + accent[3:]
    _sid, _l, trip, stretch = next(s for s in SPEEDS if s[0] == speed_id)
    parts = []
    if not ambient:
        speed = L / trip
        for angle, phase, thick, color in stars():
            d = (t * speed + phase) % L
            alpha = max(0, min(235, (d - 50) * 3)) / 255
            parts.append(
                f'<g transform="rotate({angle} {C} {C})" opacity="{alpha:.3f}">'
                f'<rect x="{C + d}" y="{C - thick / 2}" width="{3 + d * stretch}" height="{thick}" '
                f'fill="#{color[3:]}"/></g>')
        if ship:
            gx = (t - SHIP_START) * SHIP_SPEED + SHIP_X0
            shapes = []
            for kind, x, y, w, h, r, color in SHIP:
                a = int(color[1:3], 16) / 255
                fill = f'fill="#{color[3:]}" fill-opacity="{a:.2f}"'
                if kind == "ellipse":
                    shapes.append(f'<ellipse cx="{x + w / 2}" cy="{y + h / 2}" rx="{w / 2}" ry="{h / 2}" {fill}/>')
                else:
                    shapes.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" {fill}/>')
            parts.append(f'<g transform="translate({gx} {SHIP_Y})">{"".join(shapes)}</g>')

    dim = 170 / 255 if ambient else 1
    font = "font-family=\"'Inter','Liberation Sans',sans-serif\" font-weight=\"700\" text-anchor=\"middle\" dominant-baseline=\"central\""
    parts.append(f'<text x="{C}" y="117" font-size="24" fill="{acc}" opacity="{dim:.2f}" {font}>Sat  14 Nov</text>')
    parts.append(f'<text x="{C}" y="194" font-size="100" fill="#FFFFFF" {font}>10:08</text>')
    if not ambient:
        parts.append(f'<text x="{C}" y="269" font-size="20" fill="{acc}" {font}>WARP CORE 82%</text>')
    parts.append(f'<text x="{C}" y="367" font-size="20" fill="{acc}" opacity="{dim:.2f}" {font}>STARDATE 26868.4</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
            f'<defs><clipPath id="c"><circle cx="{C}" cy="{C}" r="{C}"/></clipPath></defs>'
            f'<g clip-path="url(#c)"><rect width="{W}" height="{H}" fill="#000208"/>'
            + "".join(parts) + "</g></svg>")


def main(argv):
    if "--frame" in argv:
        i = argv.index("--frame")
        t, out = float(argv[i + 1]), argv[i + 2]
        opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
        Path(out).write_text(frame_svg(t, opt("--speed", DEFAULT_SPEED), opt("--accent", "0"),
                                       "--ambient" in argv, "--no-ship" not in argv))
        return
    out = Path(__file__).resolve().parent.parent / "app/src/main/res/raw/watchface.xml"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_xml())
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
