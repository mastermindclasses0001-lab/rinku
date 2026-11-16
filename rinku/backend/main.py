"""
TitanGrid Retail ERP — Python FastAPI + Face Recognition + OpenPyXL Microservice
Designed for Google Cloud Run deployment alongside PostgreSQL (Cloud SQL / RDS).
"""
import io
import os
import math
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import openpyxl

app = FastAPI(title="TitanGrid Retail ERP FastAPI Service", version="1.0.0")


class FaceVerifyRequest(BaseModel):
    tenant_id: str
    user_id: str
    stored_embedding: List[float]
    probe_embedding: List[float]
    motion_delta: float
    luminance_variance: float


class StockValuationRow(BaseModel):
    branch: str
    sku: str
    name: str
    qty: float
    cost: float
    selling_price: float


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(y * y for y in b))
    return dot / (mag_a * mag_b) if mag_a > 0 and mag_b > 0 else 0.0


@app.get("/health")
def health():
    return {"ok": True, "service": "titangrid-fastapi", "timestamp": datetime.utcnow().isoformat()}


@app.post("/api/v1/face/verify")
def verify_face_liveness(payload: FaceVerifyRequest):
    if payload.motion_delta < 0.015 and payload.luminance_variance < 1.5:
        raise HTTPException(status_code=403, detail="Liveness verification failed: spoof or static photo detected.")
    score = cosine_similarity(payload.stored_embedding, payload.probe_embedding)
    if score < 0.72:
        raise HTTPException(status_code=403, detail=f"Face match confidence {score:.2f} below threshold 0.72")
    return {"verified": True, "confidence": round(score, 4), "liveness_passed": True}


@app.post("/api/v1/exports/openpyxl/stock")
def export_stock_openpyxl(rows: List[StockValuationRow], x_tenant_id: Optional[str] = Header(default=None)):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Stock Valuation"
    ws.append(["Tenant", x_tenant_id or "default", "Generated", datetime.utcnow().isoformat()])
    ws.append(["Branch", "SKU", "Product", "Available Qty", "Purchase Cost", "Selling Price", "Cost Valuation"])
    for r in rows:
        ws.append([r.branch, r.sku, r.name, r.qty, r.cost, r.selling_price, r.qty * r.cost])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=stock_valuation_openpyxl.xlsx"},
    )
