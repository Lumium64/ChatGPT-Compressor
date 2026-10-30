"""Create an extension ZIP containing runtime files and user documentation."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "manifest.json").read_text())
output = root / "dist" / f"chatgpt-compressor-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
files = ["manifest.json", "core.js", "content.js", "content.css", "popup.html", "popup.js", "popup.css", "README.md"]
if (root / "image.png").is_file():
    files.append("image.png")
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
print(output)
