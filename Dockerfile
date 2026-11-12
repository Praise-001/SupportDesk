FROM node:22-slim

# Install poppler-utils for optional pdftotext high-fidelity extraction
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY . .

# Create volume mount point for persistent SQLite and secret data
RUN mkdir -p /app/data

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]

