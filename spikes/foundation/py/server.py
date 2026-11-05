# SPDX-License-Identifier: AGPL-3.0-only
# SP-01 candidate 2: the same thin slice in Python/FastAPI. There is no
# published Python OpenSCG library, so everything OpenSCG does has to be
# re-created here. This file does only what the slice needs:
#   - strict parsing (partial: duplicate keys, BOM, NaN/Infinity, depth, size)
#   - structural validation with the published JSON Schema
#   - TWO of OpenSCG's 34 semantic rules (V010, V046)
#   - payload digest (RFC 8785 via the `rfc8785` package) and approval text
# Missing compared with @knitli/openscg: 32 semantic rules, lone-surrogate and
# number-range checks, approval statement bytes, CMS attestation creation and
# verification, release manifests, loss reports. Synthetic data only.
import hashlib, json, os, pathlib
import jsonschema, rfc8785, uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

PKG = pathlib.Path(__file__).parent.parent / "ts/node_modules/@knitli/openscg"
SCHEMA = json.loads((PKG / "schema/0.1/guide.schema.json").read_text())
VALIDATOR = jsonschema.Draft202012Validator(SCHEMA, format_checker=jsonschema.FormatChecker())
DATA = pathlib.Path(os.environ.get("IMPRINT_DATA", "data"))
MAX_BYTES, MAX_DEPTH = 16 << 20, 64
CLASSIFIED = {"C", "S", "TS"}

def _no_dupes(pairs):
    keys = [k for k, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate member name")
    return dict(pairs)

def _bad_constant(name):
    raise ValueError(f"non-JSON number {name}")

def _depth(v, d=0):
    if d > MAX_DEPTH:
        raise ValueError("too deep")
    if isinstance(v, dict):
        for x in v.values(): _depth(x, d + 1)
    elif isinstance(v, list):
        for x in v: _depth(x, d + 1)

def parse_strict(raw: bytes):
    if len(raw) > MAX_BYTES or raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError("size or BOM")
    v = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_dupes, parse_constant=_bad_constant)
    _depth(v)
    return v

def pointer(path):
    return "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in path)

def validate(guide):
    errs = sorted(VALIDATOR.iter_errors(guide), key=lambda e: list(e.absolute_path))
    if errs:  # OpenSCG reports structural failures as one code; approximate it.
        return [{"code": "OSCG-S001", "severity": "error", "pointer": pointer(e.absolute_path), "message": e.message} for e in errs]
    out = []
    for i, e in enumerate(guide["entries"]):
        levels = [e.get("level")] if "level" in e else [e.get("level_range", {}).get("high")]
        if any(l in CLASSIFIED for l in levels) and e.get("regime") != "aea" and "reason" not in e:
            out.append({"code": "OSCG-V010", "severity": "error", "pointer": f"/entries/{i}/reason",
                        "message": "A classified entry needs a concise reason."})
    if guide.get("document_markings", {}).get("review", {}).get("status") != "complete":
        out.append({"code": "OSCG-V046", "severity": "policy_review", "pointer": "/document_markings/review",
                    "message": "An authorized person must review the guide's own markings."})
    return out

def approval_ready(findings):
    return not any(f["severity"] in ("error", "unsupported", "policy_review") for f in findings)

def payload_digest(guide):
    payload = {k: v for k, v in guide.items() if k not in ("attestations", "review")}
    return {"alg": "sha-256", "value": hashlib.sha256(rfc8785.dumps(payload)).hexdigest()}

def approval_text(g, d):
    return (f"I approve revision {g['revision_id']} of the security classification guide "
            f"\"{g['title']}\" ({g['guide_id']}), whose OpenSCG payload has SHA-256 digest "
            f"{d['value']}. This approval covers exactly that content.")

guide = parse_strict((PKG / "examples/synthetic-lantern.json").read_bytes())
EDITABLE = {"description", "level", "reason", "declassification"}
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)  # no exposed API docs

async def body(req: Request):
    raw = await req.body()
    try:
        return parse_strict(raw)
    except Exception:
        raise HTTPException(400, "bad request")  # never echo content

@app.get("/api/guide")
def get_guide():
    return guide

@app.get("/api/findings")
def get_findings():
    f = validate(guide)
    return {"approval_ready": approval_ready(f), "findings": f}

@app.patch("/api/entries/{entry_id}")
async def patch_entry(entry_id: str, req: Request):
    patch = await body(req)
    entry = next((e for e in guide["entries"] if e["entry_id"] == entry_id), None)
    if entry is None:
        raise HTTPException(404, "no such entry")
    for k, v in patch.items():
        if k not in EDITABLE:
            raise HTTPException(400, f"field {k} is not editable here")
        if v is None: entry.pop(k, None)
        else: entry[k] = v
    return {"findings": validate(guide)}

@app.post("/api/markings-review")
async def markings_review(req: Request):
    guide["document_markings"]["review"] = {"status": (await body(req))["status"]}
    return {"findings": validate(guide)}

@app.post("/api/freeze")
def freeze():
    f = validate(guide)
    if not approval_ready(f):
        return JSONResponse({"error": "not approval-ready", "findings": f}, status_code=409)
    d = payload_digest(guide)
    DATA.mkdir(parents=True, exist_ok=True)
    path = DATA / f"{guide['revision_id']}.{d['value'][:12]}.json"
    with open(path, "xb") as fh:
        fh.write(rfc8785.dumps(guide))
    return JSONResponse({"file": str(path), "digest": d, "statement_text": approval_text(guide, d)}, status_code=201)

@app.get("/", response_class=HTMLResponse)
def index():
    return (pathlib.Path(__file__).parent.parent / "ts/index.html").read_text()

if __name__ == "__main__":
    import socket
    s = socket.socket(); s.bind(("127.0.0.1", int(os.environ.get("PORT", "0")))); port = s.getsockname()[1]; s.close()
    print(f"listening on http://127.0.0.1:{port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
