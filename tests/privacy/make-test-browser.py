#!/usr/bin/env python3
"""Turn a stock Firefox release into a "Mercury-like" test browser.

Usage: make-test-browser.py <stock firefox dir> <output dir>

Without a full Mercury build, this applies Mercury's front-end changes
(JS/prefs/Fluent/policies, no C++) to a copy of a stock Firefox of the same
version, by patching the files inside its omni.ja archives:

- Mercury default prefs: every `pref(...)` line Mercury adds in patch 0003
  (firefox.js) is appended to defaults/preferences/firefox.js (later wins).
- Patches 0024 (BrowserGlue), 0029-0033 (Settings UI and strings).
- Mercury-only modules from browser/components/mercury/.
- policies/policies.json -> distribution/policies.json.

C++ patches (and the de-Google all.js patch) are not applied; they need a
real build.
"""
import os, re, shutil, subprocess, sys, tempfile, zipfile

repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
src, out = sys.argv[1], sys.argv[2]
patches = os.path.join(repo, "patches", "firefox")

if os.path.exists(out):
    shutil.rmtree(out)
shutil.copytree(src, out, symlinks=True)

def unpack(ja, dest):
    # omni.ja is an "optimized" zip; unzip copes with it (warnings only).
    subprocess.run(["unzip", "-q", "-o", ja, "-d", dest], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def pack(dest, ja):
    os.remove(ja)
    with zipfile.ZipFile(ja, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(dest):
            for f in files:
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, dest))

def apply_patch(patch_file, target):
    r = subprocess.run(["patch", "--forward", "-s", target, patch_file],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"patch {os.path.basename(patch_file)} failed on {target}:\n{r.stdout}{r.stderr}")

def find_patch(prefix):
    for f in sorted(os.listdir(patches)):
        if f.startswith(prefix):
            return os.path.join(patches, f)
    sys.exit(f"no patch {prefix}")

work = tempfile.mkdtemp(prefix="mercury-omni-")
gre, app = os.path.join(work, "gre"), os.path.join(work, "app")
unpack(os.path.join(out, "omni.ja"), gre)
unpack(os.path.join(out, "browser", "omni.ja"), app)

# GRE omni.ja: BrowserGlue + Mercury modules (moz-src:///).
apply_patch(find_patch("0024-"), os.path.join(gre, "moz-src/browser/components/BrowserGlue.sys.mjs"))
mdir = os.path.join(gre, "moz-src/browser/components/mercury")
os.makedirs(mdir, exist_ok=True)
for f in os.listdir(os.path.join(repo, "browser/components/mercury")):
    if f.endswith(".sys.mjs"):
        shutil.copy(os.path.join(repo, "browser/components/mercury", f), mdir)

# Browser omni.ja: Settings UI, strings, default prefs.
prefdir = os.path.join(app, "chrome/browser/content/browser/preferences")
apply_patch(find_patch("0029-"), os.path.join(prefdir, "config/privacy.mjs"))
apply_patch(find_patch("0030-"), os.path.join(prefdir, "privacy.js"))
apply_patch(find_patch("0031-"), os.path.join(prefdir, "preferences.xhtml"))  # privacy.inc.xhtml is #included here
apply_patch(find_patch("0032-"), os.path.join(app, "localization/en-US/browser/preferences/preferences.ftl"))
apply_patch(find_patch("0033-"), os.path.join(prefdir, "preferences.js"))

added = []
with open(find_patch("0003-")) as f:
    for line in f:
        if re.match(r"^\+\s*pref\(.*\);", line):
            added.append(line[1:].strip())
with open(os.path.join(app, "defaults/preferences/firefox.js"), "a") as f:
    f.write("\n// Mercury prefs (from patch 0003), appended for testing\n")
    f.write("\n".join(added) + "\n")

pack(gre, os.path.join(out, "omni.ja"))
pack(app, os.path.join(out, "browser", "omni.ja"))
os.makedirs(os.path.join(out, "distribution"), exist_ok=True)
shutil.copy(os.path.join(repo, "policies/policies.json"), os.path.join(out, "distribution/policies.json"))
shutil.rmtree(work)
print(f"test browser in {out}: {len(added)} Mercury prefs, patches 0024 0029-0033, Mercury modules, policies.json")
