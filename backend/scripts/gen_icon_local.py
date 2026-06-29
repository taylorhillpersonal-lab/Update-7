"""
Code-drawn 'Idle Business Tycoon' logo/icon set (HypnoFusions).
No external API / budget needed. Draws a gold royal crown emblem on a deep
navy->black radial glow, then exports the full Expo asset set.
"""
import math, pathlib
from PIL import Image, ImageDraw, ImageFilter

IMG = pathlib.Path("/app/frontend/assets/images")
S = 1024
SS = 4                      # supersample factor
W = S * SS                  # working size

GOLD_TOP = (255, 224, 130)
GOLD_MID = (240, 184, 64)
GOLD_LOW = (176, 120, 24)
OUTLINE  = (90, 60, 10)


def radial_bg(size, inner, outer, cx=0.5, cy=0.42):
    """Vertical-biased radial gradient."""
    img = Image.new("RGB", (size, size), outer)
    px = img.load()
    cxp, cyp = size * cx, size * cy
    maxd = math.hypot(size, size) * 0.62
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cxp, y - cyp) / maxd
            d = min(1.0, d)
            px[x, y] = (
                int(inner[0] + (outer[0] - inner[0]) * d),
                int(inner[1] + (outer[1] - inner[1]) * d),
                int(inner[2] + (outer[2] - inner[2]) * d),
            )
    return img


def vgrad_fill(mask_img, top, mid, low):
    """Fill the alpha mask with a vertical 3-stop gradient."""
    w, h = mask_img.size
    grad = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gp = grad.load()
    ys = mask_img.getbbox()
    y0, y1 = (ys[1], ys[3]) if ys else (0, h)
    span = max(1, y1 - y0)
    for y in range(h):
        t = min(1.0, max(0.0, (y - y0) / span))
        if t < 0.5:
            f = t / 0.5
            c = tuple(int(top[i] + (mid[i] - top[i]) * f) for i in range(3))
        else:
            f = (t - 0.5) / 0.5
            c = tuple(int(mid[i] + (low[i] - mid[i]) * f) for i in range(3))
        for x in range(w):
            gp[x, y] = (c[0], c[1], c[2], 255)
    grad.putalpha(mask_img)
    return grad


def crown_layer(size, with_glow=True):
    """Return RGBA crown emblem (transparent bg)."""
    w = size
    layer = Image.new("RGBA", (w, w), (0, 0, 0, 0))

    def sx(x): return int(x / 1024 * w)
    def sy(y): return int(y / 1024 * w)

    # Crown silhouette (5 tips + band) centered.
    pts = [
        (256, 660), (256, 392), (336, 520), (416, 348),
        (512, 300), (608, 348), (688, 520), (768, 392),
        (768, 660),
    ]
    poly = [(sx(x), sy(y)) for x, y in pts]
    band = [sx(238), sy(648), sx(786), sy(792)]  # rounded band

    mask = Image.new("L", (w, w), 0)
    md = ImageDraw.Draw(mask)
    md.polygon(poly, fill=255)
    md.rounded_rectangle(band, radius=sx(34), fill=255)

    gold = vgrad_fill(mask, GOLD_TOP, GOLD_MID, GOLD_LOW)

    # outline
    outl = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    od = ImageDraw.Draw(outl)
    od.line(poly + [poly[0]], fill=OUTLINE + (255,), width=sx(7), joint="curve")
    od.rounded_rectangle(band, radius=sx(34), outline=OUTLINE + (255,), width=sx(7))

    emblem = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    emblem.alpha_composite(gold)
    emblem.alpha_composite(outl)

    # band divider line + gems
    gd = ImageDraw.Draw(emblem)
    gd.line([sx(252), sy(688), sx(772), sy(688)], fill=OUTLINE + (200,), width=sx(5))
    gems = [
        (sx(360), sy(730), (220, 60, 70)),     # ruby
        (sx(512), sy(730), (70, 150, 230)),    # sapphire
        (sx(664), sy(730), (70, 200, 130)),    # emerald
    ]
    for gx, gy, col in gems:
        r = sx(26)
        gd.ellipse([gx - r, gy - r, gx + r, gy + r], fill=col + (255,), outline=(255, 240, 200, 230), width=sx(4))
    # tip jewels
    for tx, ty in [(256, 392), (416, 348), (512, 300), (608, 348), (768, 392)]:
        r = sx(20)
        gd.ellipse([sx(tx) - r, sy(ty) - r, sx(tx) + r, sy(ty) + r],
                   fill=(255, 245, 215, 255), outline=OUTLINE + (255,), width=sx(4))

    out = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    if with_glow:
        glow = Image.new("RGBA", (w, w), (0, 0, 0, 0))
        gdr = ImageDraw.Draw(glow)
        gdr.ellipse([sx(300), sy(300), sx(724), sy(724)], fill=(255, 190, 90, 130))
        glow = glow.filter(ImageFilter.GaussianBlur(sx(70)))
        out.alpha_composite(glow)
    # soft drop shadow
    sh = emblem.split()[3].point(lambda a: int(a * 0.6))
    shadow = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    shadow.putalpha(sh)
    shadow = shadow.filter(ImageFilter.GaussianBlur(sx(14)))
    out.alpha_composite(shadow, (0, sx(10)))
    out.alpha_composite(emblem)
    return out


# ---- compose full icon (bg + crown) ----
bg = radial_bg(W, inner=(22, 38, 92), outer=(5, 7, 16)).convert("RGBA")
crown = crown_layer(W, with_glow=True)
icon_full = bg.copy()
icon_full.alpha_composite(crown)
icon_full = icon_full.resize((S, S), Image.LANCZOS).convert("RGB")
icon_full.save(IMG / "icon.png")
icon_full.save(IMG / "adaptive-icon.png")
icon_full.resize((64, 64), Image.LANCZOS).save(IMG / "favicon.png")

# transparent crown for splash + loading logo
crown_only = crown_layer(W, with_glow=True).resize((S, S), Image.LANCZOS)
crown_only.save(IMG / "splash-image.png")
crown_only.save(IMG / "app-image.png")

for f in ["icon.png", "adaptive-icon.png", "favicon.png", "splash-image.png", "app-image.png"]:
    p = IMG / f
    print(f"{f:20s} {Image.open(p).size}  {p.stat().st_size} bytes")
print("done")
