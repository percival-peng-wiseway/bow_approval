FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv tesseract-ocr tesseract-ocr-eng ca-certificates && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/ocr
COPY ocr/requirements.txt /tmp/requirements.txt
RUN /opt/ocr/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV INVOICE_PYTHON=/opt/ocr/bin/python3 INVOICE_TESSERACT=/usr/bin/tesseract NODE_ENV=production
WORKDIR /srv
COPY ocr/ ./ocr/
USER node
EXPOSE 8080
CMD ["node", "ocr/container-server.mjs"]
