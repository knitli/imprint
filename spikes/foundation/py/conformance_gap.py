# How far is the Python slice from OpenSCG? Run the published validation cases
# (conformance/manifest.json, section 4 of the procedure) against server.py's
# parse_strict() and validate(). Synthetic data only.
import json, sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from server import PKG, parse_strict, validate, approval_ready
m = json.loads((PKG / "conformance/manifest.json").read_text())
passed, failed = 0, []
for c in m["cases"]:
    exp = c["expected"]
    raw = (PKG / "conformance" / c["file"]).read_bytes()
    try:
        doc = parse_strict(raw)
    except Exception:
        ok = "parse_error" in exp
        passed += ok; (None if ok else failed.append(c["id"])); continue
    if "parse_error" in exp:
        failed.append(c["id"]); continue
    f = validate(doc)
    structural = "invalid" if any(x["code"] == "OSCG-S001" for x in f) else "valid"
    ok = structural == exp["structure"] and approval_ready(f) == exp["approval_ready"]
    if ok and structural == "valid" and "findings" in exp:
        ok = {(x["code"], x["pointer"]) for x in f} == {(x["code"], x["pointer"]) for x in exp["findings"]}
    passed += ok
    if not ok: failed.append(c["id"])
print(f"{passed}/{len(m['cases'])} validation cases pass")
print("failing:", ", ".join(failed))
