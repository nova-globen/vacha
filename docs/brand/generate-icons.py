#!/usr/bin/env python3
"""Derives every shipped Windows asset from docs/brand/icon.png.

icon.png is a 2x render of icon.svg (the #CC4411 hexagon mark) with a
transparent background. Run from the repo root:

    python docs/brand/generate-icons.py

Requires Pillow only. Re-run whenever the brand mark changes; the outputs are
committed so a normal build needs no image tooling.
"""

from pathlib import Path

from PIL import Image

BRAND = (0xCC, 0x44, 0x11, 0xFF)
WIZARD_DARK = (0x1B, 0x1B, 0x1B, 0xFF)
WHITE = (0xFF, 0xFF, 0xFF, 0xFF)

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "brand" / "icon.png"
WIN32 = ROOT / "resources" / "win32"

# The hexagon is taller than it is wide; leaving a little air around it keeps
# the mark from crowding the tile edges at large sizes. Small sizes get none of
# that air — at 16px the inner glyph needs every pixel it can have.
MARK_HEIGHT_RATIO = 0.92


def height_ratio_for(size: int) -> float:
    if size <= 24:
        return 1.0
    if size <= 40:
        return 0.96
    return MARK_HEIGHT_RATIO

APP_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
TRAY_ICON_SIZES = [16, 20, 24, 32, 40, 48]

# Inno Setup picks the closest image for the user's DPI; these are the sizes the
# stock VS Code assets used, so the .iss keeps the same file names.
INNO_BIG = {
    100: (164, 314), 125: (192, 386), 150: (246, 459), 175: (273, 556),
    200: (328, 604), 225: (355, 700), 250: (410, 797),
}
INNO_SMALL = {
    100: (55, 55), 125: (64, 68), 150: (83, 80), 175: (92, 97),
    200: (110, 106), 225: (119, 123), 250: (138, 140),
}


def mark() -> Image.Image:
    return Image.open(SOURCE).convert("RGBA")


def square(size: int, height_ratio: float | None = None) -> Image.Image:
    """The mark centred on a transparent square canvas."""
    source = mark()
    target_height = max(1, round(size * (height_ratio or height_ratio_for(size))))
    target_width = max(1, round(source.width * target_height / source.height))
    scaled = source.resize((target_width, target_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, ((size - target_width) // 2, (size - target_height) // 2), scaled)
    return canvas


def write_ico(path: Path, sizes: list[int]) -> None:
    frames = [square(size) for size in sizes]
    # Pillow resamples internally otherwise; supplying the frames keeps every
    # size a LANCZOS reduction of the full-resolution source.
    frames[-1].save(
        path,
        format="ICO",
        sizes=[(size, size) for size in sizes],
        append_images=frames[:-1],
    )
    print(f"  {path.relative_to(ROOT)}  {sizes}")


def write_png(path: Path, size: int) -> None:
    square(size).save(path, format="PNG")
    print(f"  {path.relative_to(ROOT)}  {size}x{size}")


def write_wizard_bmp(path: Path, size: tuple[int, int], background, coverage: float) -> None:
    """Inno wizard images are flat 24-bit BMPs, so the mark gets composited."""
    width, height = size
    canvas = Image.new("RGBA", size, background)

    source = mark()
    target_height = max(1, round(min(width * source.height / source.width, height) * coverage))
    target_width = max(1, round(source.width * target_height / source.height))
    scaled = source.resize((target_width, target_height), Image.Resampling.LANCZOS)

    canvas.alpha_composite(scaled, ((width - target_width) // 2, (height - target_height) // 2))
    canvas.convert("RGB").save(path, format="BMP")
    print(f"  {path.relative_to(ROOT)}  {width}x{height}")


def main() -> None:
    print("app + tray icons")
    write_ico(WIN32 / "code.ico", APP_ICON_SIZES)
    write_ico(WIN32 / "tond-tray.ico", TRAY_ICON_SIZES)

    print("start tile")
    write_png(WIN32 / "code_70x70.png", 70)
    write_png(WIN32 / "code_150x150.png", 150)

    print("installer wizard")
    for scale, size in INNO_BIG.items():
        write_wizard_bmp(WIN32 / f"inno-big-{scale}.bmp", size, WIZARD_DARK, 0.62)
    for scale, size in INNO_SMALL.items():
        write_wizard_bmp(WIN32 / f"inno-small-{scale}.bmp", size, WHITE, 0.86)

    print(f"\nbrand colour {BRAND[:3]} -> #CC4411")


if __name__ == "__main__":
    main()
