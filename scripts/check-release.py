"""Require the pushed release tag to match every package version."""
import json
import os
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "manifest.json").read_text())
package = json.loads((root / "package.json").read_text())
lock = json.loads((root / "package-lock.json").read_text())
version = manifest["version"]
if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,3}", version):
    raise SystemExit("Invalid extension version")
if any(value != version for value in [package["version"], lock["version"], lock["packages"][""]["version"]]):
    raise SystemExit("Package versions must match manifest.json")
if os.environ.get("GITHUB_REF_TYPE") != "tag" or os.environ.get("GITHUB_REF_NAME") != "v" + version:
    raise SystemExit("Release tag must be v" + version)
print("Release version verified:", version)
