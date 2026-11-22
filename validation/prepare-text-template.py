"""Snapshot the locally installed Premiere Basic Title for this local plugin.

Run only when updating the template. Runtime generation uses JavaScript and
does not require Python or access to Premiere's installation directory.
"""
import base64
import gzip
import io
import json
from pathlib import Path
import re
import zipfile

source = Path(r"C:\Program Files\Adobe\Adobe Premiere Pro 2026\Essential Graphics\Basic Title.mogrt")
destination = Path(__file__).resolve().parents[1] / "presets" / "text-layer-template.json"
with zipfile.ZipFile(source) as archive:
    definition = json.loads(archive.read("definition.json"))
    with zipfile.ZipFile(io.BytesIO(archive.read("project.prgraphic"))) as graphic:
        project = gzip.decompress(graphic.read(graphic.namelist()[0])).decode("utf-8")

match = re.search(r"(<Name>Source Text</Name>.*?<StartKeyframeValue)[^>]*>(.*?)</StartKeyframeValue>", project, re.S)
text_value = json.loads(base64.b64decode(match[2])[8:].decode("utf-16-le"))
text_params = text_value["mTextParam"]
text_params.update(mIndic=True, mLigatures=True, mShadowVisible=True, mShadowBlur=8, mShadowOffset=3)
style = text_params["mStyleSheet"]
style["mText"] = ""
style["mFontName"]["mParamValues"] = [[0, "LeelawadeeUI"]]
style["mFontSize"]["mParamValues"] = [[0, 64]]
project = project[:match.start()] + match[1] + ' Encoding="base64">{{TEXT_VALUE}}</StartKeyframeValue>' + project[match.end():]
# Keep the native project structure, but omit machine-specific editor metadata.
project = re.sub(r"<project.settings.lastknowngoodprojectpath>.*?</project.settings.lastknowngoodprojectpath>", "", project, flags=re.S)
project = project.replace("1250160912000", "{{DURATION_TICKS}}")
project = project.replace("Your Title Here", "Khmer caption")
project = re.sub(r"(<Name>Position</Name>.*?<StartKeyframe>[^,]+),0.5,[^,]+", r"\1,0.5,0.88", project, flags=re.S)
definition["capsuleName"] = "Khmer Caption"
definition.pop("capsuleNameLocalized", None)
definition["sourceInfoLocalized"] = {"en_US": definition["sourceInfoLocalized"]["en_US"]}
definition["usedFontsLocalized"] = {"en_US": ["LeelawadeeUI"]}
for control in definition["clientControls"]:
    control["value"] = {"strDB": [{"localeString": "en_US", "str": ""}]}
    if "uiName" in control:
        control["uiName"] = {"strDB": [{"localeString": "en_US", "str": "Caption text"}]}
destination.write_text(json.dumps({"schemaVersion": 1, "origin": str(source), "definition": definition,
                                  "project": project, "textValue": text_value}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Prepared {destination.name}")
