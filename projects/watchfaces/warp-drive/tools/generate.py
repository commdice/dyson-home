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
STARDATE_EXPR = ("floor((([YEAR] - 2000) * 1000 + ([DAY_OF_YEAR] - 1 + [HOUR_0_23] / 24) * 1000 / 366)"
                 " * 10) / 10")
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


# ------------------------------------------------------- console strips ---
# Slim LCARS strips above the date and below the stardate, with the same
# animation as Stardate Ops: chasing lights (8 x 0.5 s = 4 s loop), a sensor
# sweep along the top strip (3 s loop) and register numbers that tick each second.
LAVENDER, PERIWINKLE, PEACH = "#FFCC99CC", "#FF9999FF", "#FFFFCC99"
ACC = "[CONFIGURATION.accent.0]"
TOP_Y, TOP_H, BOT_Y, BOT_H = 68, 16, 392, 14
# (x, y, w, h, pill, colour) in chase order: top L->R, then bottom R->L.
CONSOLE_SEGS = [
    (112, TOP_Y, 40, TOP_H, True, ACC), (156, TOP_Y, 70, TOP_H, False, LAVENDER),
    (230, TOP_Y, 70, TOP_H, False, PERIWINKLE), (304, TOP_Y, 40, TOP_H, True, PEACH),
    (288, BOT_Y, 36, BOT_H, True, ACC), (226, BOT_Y, 58, BOT_H, False, PERIWINKLE),
    (164, BOT_Y, 58, BOT_H, False, PEACH), (124, BOT_Y, 36, BOT_H, True, LAVENDER),
]
SWEEP = (112, 344 - 16, TOP_Y + 3, TOP_H - 6, 3.0)   # x0, x1, y, h, seconds
REGISTERS = [  # (x, y, w, h, expression) - drawn in black on segments 1 and 2
    (156, TOP_Y, 66, TOP_H, "([SECOND] * 37 + 3) % 90 + 10"),
    (230, TOP_Y, 66, TOP_H, "([SECOND] * 53 + [MINUTE] * 7 + 47) % 90 + 10"),
]
STATIC_REGISTERS = ["03", "47"]


def _shape(tag_x, x, y, w, h, pill, color, extra=""):
    if pill:
        r = h / 2
        return (f'<RoundRectangle x="{x}" y="{y}" width="{w}" height="{h}" cornerRadiusX="{r}" '
                f'cornerRadiusY="{r}">{extra}<Fill color="{color}" /></RoundRectangle>')
    return f'<Rectangle x="{x}" y="{y}" width="{w}" height="{h}">{extra}<Fill color="{color}" /></Rectangle>'


def _register_xml(x, y, w, h, tpl):
    return f"""          <PartText x="{x}" y="{y}" width="{w}" height="{h}">
            <Text align="END">
              <Font size="12" weight="BOLD" color="#FF000000"><Template>{tpl}</Template></Font>
            </Text>
          </PartText>"""


def console_xml():
    static = "\n".join("        " + _shape(None, x, y, w, h, pill, c) for x, y, w, h, pill, c in CONSOLE_SEGS)
    n = len(CONSOLE_SEGS)
    chase = []
    for i, (x, y, w, h, pill, _c) in enumerate(CONSOLE_SEGS):
        d = f"(floor({T} * 2) % {n} - {i})"
        chase.append(f"""          <PartDraw x="0" y="0" width="{W}" height="{H}">
            <Transform target="alpha" value="(1 - clamp({d} * {d}, 0, 1)) * 130" />
            {_shape(None, x, y, w, h, pill, "#FFFFFFFF")}
          </PartDraw>""")
    x0, x1, sy, sh, period = SWEEP
    sweep = f"""          <PartDraw x="0" y="0" width="{W}" height="{H}">
            <Transform target="alpha" value="170" />
            <Rectangle x="{x0}" y="{sy}" width="16" height="{sh}">
              <Transform target="x" value="{x0} + ({T} % {period:g}) / {period:g} * {x1 - x0}" />
              <Fill color="#FFFFFFFF" />
            </Rectangle>
          </PartDraw>"""
    live = "\n".join(_register_xml(x, y, w, h, f'%s<Parameter expression="{e}" />') for x, y, w, h, e in REGISTERS)
    fixed = "\n".join(_register_xml(x, y, w, h, v) for (x, y, w, h, _e), v in zip(REGISTERS, STATIC_REGISTERS))
    return f"""    <!-- ========== CONSOLE STRIPS (hidden in always-on mode) ========== -->
    <PartDraw x="0" y="0" width="{W}" height="{H}">
      <Variant mode="AMBIENT" target="alpha" value="0" />
{static}
    </PartDraw>
    <BooleanConfiguration id="animate">
      <BooleanOption id="TRUE">
        <Group name="console_anim" x="0" y="0" width="{W}" height="{H}">
          <Variant mode="AMBIENT" target="alpha" value="0" />
{chr(10).join(chase)}
{sweep}
{live}
        </Group>
      </BooleanOption>
      <BooleanOption id="FALSE">
        <Group name="console_static" x="0" y="0" width="{W}" height="{H}">
          <Variant mode="AMBIENT" target="alpha" value="0" />
{fixed}
        </Group>
      </BooleanOption>
    </BooleanConfiguration>
"""


def console_svg(t, accent_hex, animate=True):
    out = []
    col = lambda c: "#" + (accent_hex[3:] if c == ACC else c[3:])
    for x, y, w, h, pill, c in CONSOLE_SEGS:
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2 if pill else 0}" fill="{col(c)}"/>')
    second, minute = int(t), 8
    if animate:
        n = len(CONSOLE_SEGS)
        x, y, w, h, pill, _c = CONSOLE_SEGS[math.floor(t * 2) % n]
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2 if pill else 0}" '
                   f'fill="#FFFFFF" fill-opacity="{130 / 255:.2f}"/>')
        x0, x1, sy, sh, period = SWEEP
        out.append(f'<rect x="{x0 + (t % period) / period * (x1 - x0)}" y="{sy}" width="16" height="{sh}" '
                   f'fill="#FFFFFF" fill-opacity="{170 / 255:.2f}"/>')
        values = [str(eval(e.replace("[SECOND]", str(second)).replace("[MINUTE]", str(minute))))
                  for *_g, e in REGISTERS]
    else:
        values = STATIC_REGISTERS
    font = "font-family=\"'Inter','Liberation Sans',sans-serif\" font-weight=\"700\" text-anchor=\"end\" dominant-baseline=\"central\""
    for (x, y, w, h, _e), v in zip(REGISTERS, values):
        out.append(f'<text x="{x + w}" y="{y + h / 2}" font-size="12" fill="#000000" {font}>{v}</text>')
    return "".join(out)


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

    # WFF division is floating point and floats print with up to 3 decimals,
    # so round down to one decimal place ourselves.
    stardate = ('STARDATE %s'
                f'<Parameter expression="{STARDATE_EXPR}" />')
    time_12 = '%s:%s<Parameter expression="[HOUR_1_12]" /><Parameter expression="[MINUTE_Z]" />'
    time_24 = '%s:%s<Parameter expression="[HOUR_0_23_Z]" /><Parameter expression="[MINUTE_Z]" />'

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
    <BooleanConfiguration id="animate" displayName="animate_label" defaultValue="TRUE" />
    <ListConfiguration id="clockFormat" displayName="clock_label" defaultValue="0">
      <ListOption id="0" displayName="clock_12" />
      <ListOption id="1" displayName="clock_24" />
    </ListConfiguration>
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

{console_xml()}
    <!-- ========== TEXT ========== -->
{text_xml(80, 100, 290, 34, 24, accent, '%s  %s %s<Parameter expression="[DAY_OF_WEEK_S]" /><Parameter expression="[DAY]" /><Parameter expression="[MONTH_S]" />', 170)}

    <!-- Time is drawn as plain text: DigitalClock did not render on Galaxy Watch 7. -->
    <ListConfiguration id="clockFormat">
      <ListOption id="0">
{text_xml(60, 136, 330, 116, 100, "#FFFFFFFF", time_12)}
      </ListOption>
      <ListOption id="1">
{text_xml(60, 136, 330, 116, 100, "#FFFFFFFF", time_24)}
      </ListOption>
    </ListConfiguration>

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

    if not ambient:
        parts.append(console_svg(t, accent))
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
