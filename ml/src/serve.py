from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from freshchain_model import predict


class InferenceRequest(BaseModel):
    features: dict


app = FastAPI(title="FreshChain AI Core Serving")


@app.get("/health")
def health():
    return {"status": "ready"}


@app.post("/")
def infer(request: InferenceRequest):
    if not request.features.get("zone"):
        raise HTTPException(status_code=400, detail="features.zone is required")
    return predict(request.features)
