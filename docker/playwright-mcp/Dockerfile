# ==========================================================
# ai-dev-team — Playwright MCP server image
#
# Serves browser automation for the tester agent over MCP
# Streamable HTTP (JSON-RPC at /mcp, port 8931). The tester's
# DSH mcp-client connects with transport: streamable-http, so
# no agent image rebuild is needed when this server changes.
#
# Pin @playwright/mcp (Microsoft official, Apache-2.0):
#   https://github.com/microsoft/playwright-mcp
# ==========================================================
FROM node:24-bookworm

# Pin the MCP server version for reproducible builds.
ARG PLAYWRIGHT_MCP_VERSION=0.0.79

ENV DEBIAN_FRONTEND=noninteractive

# Install the server plus Chromium and its system dependencies.
# The container runs as root and the browser is driven headless,
# so --no-sandbox is required (matching the upstream Dockerfile).
# IMPORTANT: browsers must be installed with the playwright-core
# version SHIPPED INSIDE @playwright/mcp — a bare `npx playwright
# install` pulls the latest stable playwright and installs a
# different browser build, which the server then reports missing.
RUN npm install -g @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
    && PW_CORE=/usr/local/lib/node_modules/@playwright/mcp/node_modules/.bin/playwright-core \
    && $PW_CORE install-deps chromium \
    && $PW_CORE install chromium \
    && rm -rf /root/.npm /tmp/*

# Output dir for screenshots/traces; the tester container mounts
# the same directory (./workspaces/tester/artifacts) read-write,
# so evidence files land on the tester's workspace.
RUN mkdir -p /artifacts && chmod 777 /artifacts

WORKDIR /artifacts

# Headless Chromium over Streamable HTTP. --allowed-hosts * is
# required because agents reach the server by its compose service
# name (http://playwright-mcp:8931), not localhost. --isolated
# keeps browser state per session. --caps testing enables the
# browser_verify_* assertion tools.
CMD ["playwright-mcp", \
     "--port", "8931", \
     "--host", "0.0.0.0", \
     "--allowed-hosts", "*", \
     "--headless", \
     "--no-sandbox", \
     "--browser", "chromium", \
     "--isolated", \
     "--caps", "testing", \
     "--output-dir", "/artifacts"]
