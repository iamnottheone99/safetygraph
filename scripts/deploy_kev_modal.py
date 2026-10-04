"""
Modal Deployment Script for Kev-0.8B (SafetyGraph System One Guardrail)

Deploys Kev-0.8B as a serverless HTTPS endpoint that auto-scales to zero when idle.
Compatible with TypeSafe's /v1/systemone API specification.

Usage:
  1. pip install modal && modal setup
  2. python scripts/deploy_kev_modal.py
  3. Copy the generated endpoint URL into your .env:
     KEV_ENABLED=true
     KEV_BASE_URL="https://<your-workspace>--safetygraph-kev-serve.modal.run"
     KEV_API_KEY="<your-generated-api-key>"
"""
import os
import secrets
import modal

app = modal.App("safetygraph-kev")

# Docker container image with Python 3.13, uv, torch, and kev
image = (
    modal.Image.debian_slim(python_version="3.13")
    .pip_install("uv")
    .run_commands(
        "git clone https://github.com/jaredpalmer/kev.git /root/kev",
        "cd /root/kev && uv sync --extra serve",
    )
)

MODEL_NAME = os.getenv("KEV_MODEL", "jaredpalmer/kev-0.8b")
# Kev-0.8B can run on a single T4 / L4 or CPU; L4 provides ~20ms inference latency
GPU_TYPE = os.getenv("KEV_GPU", "T4") 


@app.function(
    image=image,
    gpu=GPU_TYPE,
    scaledown_window=300,  # Scales down to zero after 5 minutes of inactivity
    secrets=[
        modal.Secret.from_name("safetygraph-kev-secrets", create_if_missing=True)
    ],
)
@modal.web_server(port=8009, startup_timeout=120)
def serve():
    import subprocess
    cmd = [
        "uv",
        "run",
        "--extra",
        "serve",
        "python",
        "-m",
        "kev.serve",
        "--run",
        MODEL_NAME,
        "--port",
        "8009",
        "--host",
        "0.0.0.0",
    ]
    subprocess.Popen(cmd, cwd="/root/kev")


if __name__ == "__main__":
    print(f"Deploying {MODEL_NAME} to Modal with GPU: {GPU_TYPE}...")
    print("Run: modal deploy scripts/deploy_kev_modal.py")
