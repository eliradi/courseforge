# Playwright's own image already carries Chromium + every system library it needs.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS base

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# ---- deps + build -----------------------------------------------------------
FROM base AS build
ENV NODE_ENV=development
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM base AS runtime
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist

# The Playwright image ships a non-root `pwuser`; run as it.
USER pwuser

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
