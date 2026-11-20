"""Draws the Store icon: a briefcase with a check mark. Usage: python store/make_icon.py"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024  # drawn large, saved at 512 for clean edges
NAVY = (18, 44, 84)
WHITE = (255, 255, 255)
GOLD = (240, 176, 32)
SHADE = (196, 208, 226)

image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

# Background, same navy as the other two Actors so the three read as a family
draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=190, fill=NAVY)

# Handle
draw.rounded_rectangle((392, 250, 632, 400), radius=44, outline=WHITE, width=40)

# Body of the briefcase
draw.rounded_rectangle((212, 350, 812, 790), radius=56, fill=WHITE)
# Lid line and clasp
draw.rectangle((212, 520, 812, 544), fill=SHADE)
draw.rounded_rectangle((462, 492, 562, 572), radius=18, fill=NAVY)

# Check mark badge, bottom right
draw.ellipse((640, 620, 900, 880), fill=GOLD, outline=NAVY, width=22)
draw.line([(706, 752), (752, 798), (836, 706)], fill=NAVY, width=36, joint="curve")
for px, py in ((706, 752), (836, 706)):
    draw.ellipse((px - 18, py - 18, px + 18, py + 18), fill=NAVY)

out = Path(__file__).with_name("icon.png")
image.resize((512, 512), Image.LANCZOS).save(out)
print(out, out.stat().st_size, "bytes")
