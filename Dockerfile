# Debian (not Alpine): the OCR packages for screenshot import ship glibc wheels only.
FROM node:22-bookworm-slim

# Python + the screenshot reader's packages in a venv; loading RapidOCR once here puts its models
# in the image, so reading screenshots never downloads anything at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/ocr \
  && /opt/ocr/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
  && /opt/ocr/bin/python -c "from rapidocr import RapidOCR; RapidOCR(params={'Global.log_level': 'error'})"

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3077 \
    DATA_DIR=/data \
    REQUIRE_PASSWORD=1 \
    PYTHON=/opt/ocr/bin/python

COPY package.json server.js read_tooltips.py ./
COPY public ./public
COPY Textures ./Textures
# Seed data: copied into /data on the first start, when the volume is still empty.
COPY Items ./Items
COPY Data ./Data

# /data is the persistent volume; owned by "node" so a new named volume inherits that owner.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3077
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3077/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server.js"]
