# ==========================================================
# ai-dev-team — Odoo MCP bridge image
#
# Serves read access to an Odoo 16+ instance over MCP
# Streamable HTTP (JSON-RPC at /mcp, port 8000). The accountant
# agent's DSH mcp-client connects with transport: streamable-http,
# so no agent image rebuild is needed when this server changes.
#
# The bridge holds the Odoo credentials (ODOO_URL / ODOO_DB /
# ODOO_USERNAME / ODOO_PASSWORD) — agents never see them, exactly
# like the redmine-mcp and github-mcp bridges.
#
# Pin odoo-mcp (erpipe-org, MIT):
#   https://github.com/erpipe-org/mcp-odoo
# ==========================================================
FROM python:3.12-slim

# Pin the PyPI version for reproducible builds.
ARG ODOO_MCP_VERSION=1.3.0

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install the Odoo MCP server. It speaks XML-RPC for Odoo 16-18
# and External JSON-2 for Odoo 19+ (ODOO_TRANSPORT / ODOO_API_KEY).
# Writes stay DISABLED by default (ODOO_MCP_ENABLE_WRITES unset):
# the accountant agent only reads accounting data.
RUN pip install --no-cache-dir "odoo-mcp==${ODOO_MCP_VERSION}"

EXPOSE 8000

# Streamable HTTP on 0.0.0.0. --allow-remote-http is required
# because agents reach the server by its compose service name
# (http://odoo-mcp:8000), not localhost. The endpoint is internal
# to the ai-team docker network only (never published to the host).
CMD ["odoo-mcp", \
     "--transport", "streamable-http", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--path", "/mcp", \
     "--allow-remote-http"]
