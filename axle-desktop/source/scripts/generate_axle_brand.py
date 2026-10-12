"""Regenerate every Axle brand asset from the approved vector mark.

MARK_PATHS holds a two-subpath vector trace of the approved artwork (a petal
above a swoosh). This script is the single source of truth for the mark: icons,
favicons, wordmark SVGs, ICO and ICNS archives across every channel
(production, nightly, development, web, marketing, desktop, mobile) are all
rendered from these two paths. Vector and raster emitters share one flattened
geometry, so shapes never drift between formats.

To rebrand, replace MARK_PATHS (re-trace the dropped artwork, normalize into the
viewBox below) and run:

    python scripts/generate_axle_brand.py
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import icnsutil
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]

MARK_VIEWBOX = (181, 176)
MARK_ASPECT = MARK_VIEWBOX[0] / MARK_VIEWBOX[1]

MARK_PATHS = (
    "M107.5 4.5C114.56 8.5 117.9 15.75 121.54 22.69C122.45 24.41 123.39 26.1 124.34 27.8C127.0 32.73 129.16 37.01 129.2 42.68C127.83 46.25 124.89 48.69 121.65 50.57C119.45 51.65 117.23 52.64 114.98 53.62C114.15 53.99 113.31 54.37 112.45 54.75C109.72 55.97 106.99 57.17 104.25 58.38C101.4 59.64 98.56 60.9 95.71 62.17C93.79 63.02 91.87 63.88 89.94 64.73C83.82 67.45 77.73 70.23 71.66 73.08C70.16 73.78 68.65 74.49 67.15 75.19C65.03 76.18 62.92 77.17 60.81 78.17C47.36 84.59 47.36 84.59 40.5 83.5C38.23 82.09 36.73 80.9 35.5 78.5C34.5 74.41 34.08 71.78 35.85 67.91C36.51 66.64 37.2 65.37 37.9 64.12C38.65 62.7 39.39 61.29 40.14 59.87C40.53 59.15 40.92 58.43 41.33 57.69C42.84 54.87 44.28 52.02 45.73 49.17C47.15 46.36 48.59 43.55 50.04 40.74C50.77 39.32 51.5 37.9 52.22 36.48C66.93 7.7 66.93 7.7 78.61 2.23C88.24 -1.47 98.44 -0.04 107.5 4.5Z",
    "M135.94 59.19C136.51 59.34 137.09 59.48 137.68 59.64C143.73 62.51 145.89 68.87 148.63 74.56C149.61 76.57 150.59 78.57 151.57 80.57C152.07 81.57 152.56 82.57 153.06 83.61C155.12 87.75 157.27 91.85 159.44 95.94C159.84 96.69 160.23 97.45 160.65 98.22C162.44 101.62 164.24 105.01 166.04 108.4C167.66 111.45 169.27 114.51 170.88 117.56C171.38 118.5 171.88 119.44 172.39 120.41C177.64 130.4 181.98 138.98 180.5 150.5C178.52 158.63 174.13 164.98 167.48 170.04C160.73 174.46 154.9 175.72 146.89 175.96C136.77 174.58 127.26 168.47 118.25 163.88C115.6 162.52 112.95 161.18 110.3 159.84C109.7 159.53 109.11 159.23 108.5 158.91C102.71 155.98 97.43 154.19 90.88 154.06C89.77 154.02 88.66 153.98 87.52 153.94C76.73 154.77 65.52 162.39 56.0 167.25C53.35 168.6 50.69 169.95 48.03 171.3C47.43 171.6 46.84 171.91 46.22 172.23C39.31 175.72 33.2 176.17 25.5 175.5C17.38 173.57 11.0 169.1 5.96 162.48C0.89 154.75 -0.39 147.69 0.5 138.5C1.39 134.58 2.81 131.13 4.5 127.5C4.62 127.22 4.62 127.22 5.22 125.79C7.61 120.16 10.23 114.47 15.77 111.41C17.03 110.8 18.29 110.22 19.57 109.65C20.26 109.32 20.96 108.99 21.67 108.65C23.17 107.95 24.67 107.25 26.17 106.57C28.51 105.49 30.85 104.4 33.18 103.29C38.17 100.94 43.18 98.62 48.19 96.31C49.08 95.9 49.98 95.49 50.9 95.06C64.93 88.57 79.01 82.18 93.13 75.9C97.78 73.83 102.42 71.73 107.06 69.63C107.78 69.3 108.5 68.98 109.24 68.65C112.05 67.37 114.87 66.09 117.69 64.81C119.61 63.94 121.53 63.07 123.45 62.2C124.02 61.94 124.59 61.68 125.17 61.42C132.33 58.18 132.33 58.18 135.94 59.19Z",
)

ICON_COLOR = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_RENDITIONS = (
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
    ("ic11", 32),
    ("ic12", 64),
    ("ic13", 256),
    ("ic14", 512),
)

_geometry: tuple[list[list[tuple[float, float]]], float, float] | None = None


def _tokenize(path_data: str) -> list[str]:
    return re.findall(r"[A-Za-z]|-?\d+(?:\.\d+)?", path_data)


def _parse_paths() -> list[list[tuple]]:
    subpaths: list[list[tuple]] = []
    for path_data in MARK_PATHS:
        tokens = _tokenize(path_data)
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token == "M":
                subpaths.append(
                    [("M", (float(tokens[index + 1]), float(tokens[index + 2])))]
                )
                index += 3
            elif token == "C":
                values = [float(tokens[index + offset]) for offset in range(1, 7)]
                subpaths[-1].append(
                    ("C", (values[0], values[1]), (values[2], values[3]), (values[4], values[5]))
                )
                index += 7
            elif token in ("Z", "z"):
                subpaths[-1].append(("Z",))
                index += 1
            else:
                index += 1
    return subpaths


def _flatten(subpaths: list[list[tuple]], steps: int = 64) -> list[list[tuple[float, float]]]:
    polygons: list[list[tuple[float, float]]] = []
    for subpath in subpaths:
        points: list[tuple[float, float]] = []
        current: tuple[float, float] | None = None
        start: tuple[float, float] | None = None
        for segment in subpath:
            if segment[0] == "M":
                current = start = segment[1]
                points = [current]
            elif segment[0] == "C":
                p0, p1, p2, p3 = current, segment[1], segment[2], segment[3]
                for step in range(1, steps + 1):
                    t = step / steps
                    mt = 1 - t
                    x = (mt**3) * p0[0] + 3 * (mt**2) * t * p1[0] + 3 * mt * (t**2) * p2[0] + (t**3) * p3[0]
                    y = (mt**3) * p0[1] + 3 * (mt**2) * t * p1[1] + 3 * mt * (t**2) * p2[1] + (t**3) * p3[1]
                    points.append((x, y))
                current = p3
            elif segment[0] == "Z":
                if start is not None and points and points[-1] != start:
                    points.append(start)
        if len(points) >= 3:
            polygons.append(points)
    return polygons


def mark_geometry() -> tuple[list[list[tuple[float, float]]], float, float]:
    """Return polygons normalized so the mark bbox starts at the origin, plus its size."""
    global _geometry
    if _geometry is None:
        polygons = _flatten(_parse_paths())
        xs = [x for polygon in polygons for x, _ in polygon]
        ys = [y for polygon in polygons for _, y in polygon]
        min_x, min_y = min(xs), min(ys)
        width, height = max(xs) - min_x, max(ys) - min_y
        normalized = [[(x - min_x, y - min_y) for x, y in polygon] for polygon in polygons]
        _geometry = (normalized, width, height)
    return _geometry


def render(
    size: int,
    *,
    frac: float = 0.90,
    color: tuple[int, int, int, int] = ICON_COLOR,
    supersample: int = 4,
) -> Image.Image:
    """Render the mark centered on a transparent square, occupying frac of it."""
    polygons, mark_width, mark_height = mark_geometry()
    box = size * frac
    scale = min(box / mark_width, box / mark_height)
    big = size * supersample
    offset_x = (big - mark_width * scale * supersample) / 2
    offset_y = (big - mark_height * scale * supersample) / 2
    layer = Image.new("L", (big, big), 0)
    painter = ImageDraw.Draw(layer)
    for polygon in polygons:
        painter.polygon(
            [(offset_x + x * scale * supersample, offset_y + y * scale * supersample) for x, y in polygon],
            fill=255,
        )
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    foreground = Image.new("RGBA", (big, big), color)
    image = Image.composite(foreground, image, layer)
    return image.resize((size, size), Image.LANCZOS)


def render_knockout(size: int, *, radius_frac: float = 10 / 128, supersample: int = 4) -> Image.Image:
    """A filled rounded square with the mark punched out (legacy t3-black style)."""
    polygons, mark_width, mark_height = mark_geometry()
    box = size * 0.62
    scale = min(box / mark_width, box / mark_height)
    big = size * supersample
    offset_x = (big - mark_width * scale * supersample) / 2
    offset_y = (big - mark_height * scale * supersample) / 2
    mark_layer = Image.new("L", (big, big), 0)
    painter = ImageDraw.Draw(mark_layer)
    for polygon in polygons:
        painter.polygon(
            [(offset_x + x * scale * supersample, offset_y + y * scale * supersample) for x, y in polygon],
            fill=255,
        )
    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=int(round(radius_frac * big)), fill=(0, 0, 0, 255)
    )
    tile.putalpha(Image.composite(Image.new("L", (big, big), 0), tile.getchannel("A"), mark_layer))
    return tile.resize((size, size), Image.LANCZOS)


def write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def write_webp(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="WEBP", quality=90, method=6)


def write_ico(path: Path, sizes: tuple[int, ...] = ICO_SIZES) -> None:
    images = [render(size, supersample=8 if size <= 64 else 4) for size in sizes]
    path.parent.mkdir(parents=True, exist_ok=True)
    images[-1].save(
        path,
        format="ICO",
        append_images=images[:-1],
        sizes=[(size, size) for size in sizes],
    )


def write_icns(path: Path, renditions: tuple[tuple[str, int], ...] = ICNS_RENDITIONS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    archive = icnsutil.IcnsFile()
    for file_type, size in renditions:
        buffer = io.BytesIO()
        render(size).save(buffer, format="PNG", optimize=True)
        archive.add_media(file_type, data=buffer.getvalue(), force=True)
    archive.write(str(path))


def _fmt(value: float) -> str:
    return f"{value:g}"


def mark_paths_markup(fill: str, indent: str = "  ") -> str:
    return "\n".join(f'{indent}<path d="{path}" fill="{fill}"/>' for path in MARK_PATHS)


def mark_svg_document(fill: str, title: str = "Axle") -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{MARK_VIEWBOX[0]}" '
        f'height="{MARK_VIEWBOX[1]}" viewBox="0 0 {MARK_VIEWBOX[0]} {MARK_VIEWBOX[1]}" fill="none">\n'
        f"  <title>{title}</title>\n"
        f"{mark_paths_markup(fill)}\n"
        "</svg>\n"
    )


def widget_svg_document(fill: str = "black") -> str:
    return (
        f'<svg width="{MARK_VIEWBOX[0]}" height="{MARK_VIEWBOX[1]}" '
        f'viewBox="0 0 {MARK_VIEWBOX[0]} {MARK_VIEWBOX[1]}" fill="none" '
        'xmlns="http://www.w3.org/2000/svg">\n'
        f"{mark_paths_markup(fill)}\n"
        "</svg>\n"
    )


def tile_svg_document(*, size: int, radius: float, background: str, fill: str, box_frac: float) -> str:
    """A rounded tile (black chip, yellow app tile) with the mark centered."""
    _, mark_width, mark_height = mark_geometry()
    box = size * box_frac
    scale = min(box / mark_width, box / mark_height)
    translate_x = (size - mark_width * scale) / 2
    translate_y = (size - mark_height * scale) / 2
    return (
        f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" fill="none" '
        'xmlns="http://www.w3.org/2000/svg">\n'
        f'  <rect width="{size}" height="{size}" rx="{_fmt(radius)}" fill="{background}"/>\n'
        f'  <g transform="translate({_fmt(translate_x)} {_fmt(translate_y)}) scale({_fmt(scale)})">\n'
        f"{mark_paths_markup(fill, indent='    ')}\n"
        "  </g>\n"
        "</svg>\n"
    )


def icon_composer_svg_document(*, svg_size: int, fill: str, box_frac: float = 0.80) -> str:
    _, mark_width, mark_height = mark_geometry()
    box = 128 * box_frac
    scale = min(box / mark_width, box / mark_height)
    translate_x = (128 - mark_width * scale) / 2
    translate_y = (128 - mark_height * scale) / 2
    return (
        f'<svg width="{svg_size}" height="{svg_size}" viewBox="0 0 128 128" fill="none" '
        'xmlns="http://www.w3.org/2000/svg">\n'
        f'  <g transform="translate({_fmt(translate_x)} {_fmt(translate_y)}) scale({_fmt(scale)})">\n'
        f"{mark_paths_markup(fill, indent='    ')}\n"
        "  </g>\n"
        "</svg>\n"
    )


def write_text(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(contents)


def main() -> None:
    prod = ROOT / "assets" / "prod"
    dev = ROOT / "assets" / "dev"
    nightly = ROOT / "assets" / "nightly"
    web_public = ROOT / "apps" / "web" / "public"
    marketing = ROOT / "apps" / "marketing" / "public"
    desktop_resources = ROOT / "apps" / "desktop" / "resources"
    desktop_assets = ROOT / "apps" / "desktop" / "assets"
    mobile_assets = ROOT / "apps" / "mobile" / "assets"

    icon_1024 = render(1024)
    write_png(prod / "axle-logo-source.png", render(1254, frac=0.5455))
    for name in ("axle-ios-1024.png", "axle-macos-1024.png", "axle-universal-1024.png"):
        write_png(prod / name, icon_1024)
    for name in ("black-ios-1024.png", "black-macos-1024.png", "black-universal-1024.png"):
        write_png(prod / name, icon_1024)
    apple_touch_180 = render(180)
    write_png(prod / "axle-web-apple-touch-180.png", apple_touch_180)
    write_png(prod / "axle-web-favicon-16x16.png", render(16, supersample=8))
    write_png(prod / "axle-web-favicon-32x32.png", render(32, supersample=8))
    write_ico(prod / "axle-windows.ico")
    write_ico(prod / "axle-web-favicon.ico")
    write_icns(prod / "axle-macos.icns")

    write_png(prod / "t3-black-web-apple-touch-180.png", render_knockout(180))
    write_png(prod / "t3-black-web-favicon-16x16.png", render_knockout(16, supersample=8))
    write_png(prod / "t3-black-web-favicon-32x32.png", render_knockout(32, supersample=8))

    def write_knockout_ico(path: Path) -> None:
        images = [render_knockout(size, supersample=8 if size <= 64 else 4) for size in ICO_SIZES]
        images[-1].save(
            path,
            format="ICO",
            append_images=images[:-1],
            sizes=[(size, size) for size in ICO_SIZES],
        )

    write_knockout_ico(prod / "t3-black-web-favicon.ico")
    write_knockout_ico(prod / "t3-black-windows.ico")

    for channel, prefix in ((dev, "blueprint"), (nightly, "nightly")):
        write_png(channel / f"{prefix}-ios-1024.png", icon_1024)
        write_png(channel / f"{prefix}-macos-1024.png", icon_1024)
        write_png(channel / f"{prefix}-universal-1024.png", icon_1024)
        write_png(channel / f"{prefix}-web-apple-touch-180.png", apple_touch_180)
        write_png(channel / f"{prefix}-web-favicon-16x16.png", render(16, supersample=8))
        write_png(channel / f"{prefix}-web-favicon-32x32.png", render(32, supersample=8))
        write_ico(channel / f"{prefix}-windows.ico")
        write_ico(channel / f"{prefix}-web-favicon.ico")

    for path in ("axle-logo.svg", "axle-logo-small.svg"):
        document = mark_svg_document("#000000")
        write_text(prod / path, document)
        write_text(web_public / path, document)

    write_text(
        prod / "logo.svg",
        tile_svg_document(size=128, radius=24, background="#F5B301", fill="#171717", box_frac=0.62),
    )

    write_png(web_public / "axle-logo.png", icon_1024)
    write_png(web_public / "favicon-16x16.png", render(16, supersample=8))
    write_png(web_public / "favicon-32x32.png", render(32, supersample=8))
    write_png(web_public / "apple-touch-icon.png", apple_touch_180)
    write_ico(web_public / "favicon.ico")

    write_png(marketing / "icon.png", icon_1024)
    write_webp(marketing / "icon.webp", icon_1024)
    write_png(marketing / "favicon-16x16.png", render(16, supersample=8))
    write_webp(marketing / "favicon-16x16.webp", render(64, supersample=8))
    write_png(marketing / "favicon-32x32.png", render(32, supersample=8))
    write_webp(marketing / "favicon-32x32.webp", render(64, supersample=8))
    write_png(marketing / "apple-touch-icon.png", apple_touch_180)
    write_webp(marketing / "apple-touch-icon.webp", render(180))
    write_ico(marketing / "favicon.ico")

    write_png(desktop_resources / "icon.png", icon_1024)
    write_ico(desktop_resources / "icon.ico")
    write_icns(desktop_resources / "icon.icns")
    write_png(desktop_assets / "icon.png", icon_1024)
    write_ico(desktop_assets / "icon.ico")

    write_png(mobile_assets / "android-icon-mark.png", render(432, frac=0.646, color=WHITE))
    write_png(mobile_assets / "android-notification-icon.png", render(96, frac=0.667, color=WHITE))

    write_text(
        ROOT / "favicon.svg",
        tile_svg_document(size=128, radius=10, background="#000000", fill="#ffffff", box_frac=0.60),
    )
    write_text(mobile_assets / "widget" / "T3Mark.svg", widget_svg_document())

    for channel, svg_size in ((prod, 77), (dev, 128), (nightly, 128)):
        fill = "#171717" if channel == prod else "#ffffff"
        write_text(
            channel / "app-icon.icon" / "Assets" / "text.svg",
            icon_composer_svg_document(svg_size=svg_size, fill=fill),
        )

    print("Axle brand assets regenerated from MARK_PATHS.")


if __name__ == "__main__":
    main()
