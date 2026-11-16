import hashlib
import json
import math
import os
import secrets
import time
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VAULT_RAW = os.environ.get("ERP_VAULT_KEY") or "titangrid-erp-vault-key-2026-default"
VAULT_KEY = hashlib.sha256(VAULT_RAW.encode("utf-8")).digest()
JWT_SECRET = os.environ.get("ERP_JWT_SECRET") or "titangrid-erp-jwt-secret-2026-default"

SENSITIVE_KEYS = [
    "apiKey",
    "accessToken",
    "appSecret",
    "verifyToken",
    "serviceAccountJson",
    "password",
    "dsn",
    "secret",
    "privateKey",
]


def uid(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(10)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def sign_session_token(payload: Dict[str, Any]) -> str:
    now = int(time.time())
    body = {**payload, "iat": now, "exp": now + 86400}
    return jwt.encode(body, JWT_SECRET, algorithm="HS256")


def verify_session_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


def encrypt_json(data: Dict[str, Any]) -> str:
    iv = secrets.token_bytes(12)
    aes = AESGCM(VAULT_KEY)
    plaintext = json.dumps(data).encode("utf-8")
    ct_and_tag = aes.encrypt(iv, plaintext, None)
    ct = ct_and_tag[:-16]
    tag = ct_and_tag[-16:]
    return f"{iv.hex()}:{tag.hex()}:{ct.hex()}"


def decrypt_json(payload: Optional[str]) -> Dict[str, Any]:
    if not payload:
        return {}
    try:
        parts = payload.split(":")
        if len(parts) != 3:
            return json.loads(payload)
        iv = bytes.fromhex(parts[0])
        tag = bytes.fromhex(parts[1])
        ct = bytes.fromhex(parts[2])
        aes = AESGCM(VAULT_KEY)
        plaintext = aes.decrypt(iv, ct + tag, None)
        return json.loads(plaintext.decode("utf-8"))
    except Exception:
        return {}


def mask_secrets(config: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in config.items():
        if isinstance(value, str) and len(value) > 0 and any(k.lower() in key.lower() for k in SENSITIVE_KEYS):
            tail = value[-4:] if len(value) > 4 else "****"
            out[key] = f"••••••••{tail}"
        else:
            out[key] = value
    return out


def merge_masked_config(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(existing)
    for key, value in incoming.items():
        if isinstance(value, str) and value.startswith("••••••••"):
            continue
        merged[key] = value
    return merged


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(y * y for y in b))
    denom = mag_a * mag_b
    return dot / denom if denom > 0 else 0.0
