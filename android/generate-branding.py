#!/usr/bin/env python3
"""Generate crisp Android Mercury branding assets (launcher icons, adaptive
foreground, splash/status icons, and home/about wordmarks) from
logos/Mercury_4096.png into android/res/."""

import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
SRC_PNG = REPO / "logos" / "Mercury_4096.png"
OUT_RES = REPO / "android" / "res"

MIPMAP_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

WORDMARK_SIZES = {
    "mdpi": (180, 48),
    "hdpi": (270, 72),
    "xhdpi": (360, 96),
    "xxhdpi": (540, 144),
    "xxxhdpi": (720, 192),
}


def find_font(size: int):
    candidates = [
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/noto/NotoSans-Bold.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/gnu-free/FreeSansBold.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_round_icon(src: Image.Image, size: int) -> Image.Image:
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    plate = Image.new("RGBA", (size, size), (11, 16, 32, 255))
    bg.paste(plate, (0, 0), mask)
    pad = int(size * 0.14)
    fg = src.resize((size - 2 * pad, size - 2 * pad), Image.Resampling.LANCZOS)
    bg.paste(fg, (pad, pad), fg)
    return bg


def make_square_icon(src: Image.Image, size: int) -> Image.Image:
    bg = Image.new("RGBA", (size, size), (11, 16, 32, 255))
    pad = int(size * 0.12)
    fg = src.resize((size - 2 * pad, size - 2 * pad), Image.Resampling.LANCZOS)
    bg.paste(fg, (pad, pad), fg)
    return bg


def render_wordmark_text(color, height=160) -> Image.Image:
    font = find_font(int(height * 0.68))
    dummy = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), "Mercury", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pad_x = int(height * 0.08)
    img = Image.new("RGBA", (tw + pad_x * 2, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = (height - th) // 2 - bbox[1]
    d.text((pad_x - bbox[0], y), "Mercury", font=font, fill=color)
    return img


def render_combined_wordmark(src: Image.Image, width: int, height: int, text_color) -> Image.Image:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    icon_sz = int(height * 0.84)
    icon = src.resize((icon_sz, icon_sz), Image.Resampling.LANCZOS)
    font = find_font(int(height * 0.56))
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), "Mercury", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    gap = int(height * 0.18)
    total_w = icon_sz + gap + tw
    start_x = max(0, (width - total_w) // 2)
    img.paste(icon, (start_x, (height - icon_sz) // 2), icon)
    text_y = (height - th) // 2 - bbox[1]
    d.text((start_x + icon_sz + gap - bbox[0], text_y), "Mercury", font=font, fill=text_color)
    return img


def main():
    src = Image.open(SRC_PNG).convert("RGBA")

    # 1. Adaptive launcher foreground PNG (432x432 xxxhdpi with safe-zone padding)
    d_xxx = OUT_RES / "drawable-xxxhdpi"
    d_xxx.mkdir(parents=True, exist_ok=True)
    fg_canvas = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    fg_scaled = src.resize((276, 276), Image.Resampling.LANCZOS)
    fg_canvas.paste(fg_scaled, ((432 - 276) // 2, (432 - 276) // 2), fg_scaled)
    fg_canvas.save(d_xxx / "ic_mercury_launcher_fg.png", "PNG")

    # Monochrome silhouette for Android 13+ themed icons & status bar
    mono = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    alpha = fg_canvas.getchannel("A")
    white = Image.new("RGBA", (432, 432), (255, 255, 255, 255))
    mono.paste(white, (0, 0), alpha)
    mono.save(d_xxx / "ic_mercury_monochrome.png", "PNG")

    # 2. Adaptive XML drawables (replace Firefox fox vectors in main & release)
    d_xml = OUT_RES / "drawable"
    d_xml.mkdir(parents=True, exist_ok=True)
    (d_xml / "ic_launcher_foreground.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<bitmap xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:src="@drawable/ic_mercury_launcher_fg"\n'
        '    android:gravity="center" />\n'
    )
    (d_xml / "ic_launcher_monochrome.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<bitmap xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:src="@drawable/ic_mercury_monochrome"\n'
        '    android:gravity="center" />\n'
    )
    (d_xml / "ic_splash_logo.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<bitmap xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:src="@drawable/ic_mercury_launcher_fg"\n'
        '    android:gravity="center" />\n'
    )
    (d_xml / "ic_status_logo.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<bitmap xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:src="@drawable/ic_mercury_monochrome"\n'
        '    android:gravity="center" />\n'
    )

    m_any = OUT_RES / "mipmap-anydpi"
    m_any.mkdir(parents=True, exist_ok=True)
    adaptive_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/mercury_launcher_bg" />\n'
        '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
        '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n'
        '</adaptive-icon>\n'
    )
    (m_any / "ic_launcher.xml").write_text(adaptive_xml)
    (m_any / "ic_launcher_round.xml").write_text(adaptive_xml)

    v_dir = OUT_RES / "values"
    v_dir.mkdir(parents=True, exist_ok=True)
    (v_dir / "mercury_colors.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <color name="mercury_launcher_bg">#0B1020</color>\n'
        '</resources>\n'
    )

    # 3. Legacy & round mipmaps
    for dpi, sz in MIPMAP_SIZES.items():
        mdir = OUT_RES / f"mipmap-{dpi}"
        mdir.mkdir(parents=True, exist_ok=True)
        make_square_icon(src, sz).save(mdir / "ic_launcher.webp", "WEBP", lossless=True)
        make_round_icon(src, sz).save(mdir / "ic_launcher_round.webp", "WEBP", lossless=True)

    # 4. Home Screen logo + "Mercury" wordmark (drawable-nodpi)
    d_nodpi = OUT_RES / "drawable-nodpi"
    d_nodpi.mkdir(parents=True, exist_ok=True)
    src.resize((160, 160), Image.Resampling.LANCZOS).save(
        d_nodpi / "ic_wordmark_logo.webp", "WEBP", lossless=True
    )
    render_wordmark_text((21, 20, 26, 255), height=160).save(
        d_nodpi / "ic_wordmark_text_normal.webp", "WEBP", lossless=True
    )
    render_wordmark_text((251, 251, 254, 255), height=160).save(
        d_nodpi / "ic_wordmark_text_private.webp", "WEBP", lossless=True
    )

    # Dark-mode normal wordmark text (white on dark background)
    d_night = OUT_RES / "drawable-night-nodpi"
    d_night.mkdir(parents=True, exist_ok=True)
    render_wordmark_text((251, 251, 254, 255), height=160).save(
        d_night / "ic_wordmark_text_normal.webp", "WEBP", lossless=True
    )

    # 5. Combined Logo + Wordmark banners for About screen across all densities
    for dpi, (w, h) in WORDMARK_SIZES.items():
        ddir = OUT_RES / f"drawable-{dpi}"
        ddir.mkdir(parents=True, exist_ok=True)
        render_combined_wordmark(src, w, h, (21, 20, 26, 255)).save(
            ddir / "ic_logo_wordmark_normal.webp", "WEBP", lossless=True
        )
        render_combined_wordmark(src, w, h, (251, 251, 254, 255)).save(
            ddir / "ic_logo_wordmark_private.webp", "WEBP", lossless=True
        )
        ndir = OUT_RES / f"drawable-night-{dpi}"
        ndir.mkdir(parents=True, exist_ok=True)
        render_combined_wordmark(src, w, h, (251, 251, 254, 255)).save(
            ndir / "ic_logo_wordmark_normal.webp", "WEBP", lossless=True
        )

    print(f"Generated Mercury Android branding assets in {OUT_RES}")


if __name__ == "__main__":
    main()
