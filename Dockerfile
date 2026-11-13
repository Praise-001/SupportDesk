FROM node:22-slim

# Install poppler-utils for optional pdftotext high-fidelity extraction
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Ensure non-root node user has ownership of app and data directories
RUN mkdir -p /app/data && chown -R node:node /app

COPY --chown=node:node package.json ./
COPY --chown=node:node . .

# Run as non-root user
USER node

ENV PORT=3000
ENV NODE_ENV=production
ENV DEMO_COMPANIES=off

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
