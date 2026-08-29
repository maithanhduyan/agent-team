# ─── Dev Container ─────────────────────────────────────
# Ubuntu + Bun + TypeScript + Docker CLI
# Full-autonomy environment for AI agents building
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# ─── System packages ────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build essentials
    build-essential \
    curl \
    wget \
    ca-certificates \
    git \
    pkg-config \
    # Network & debugging
    iputils-ping \
    net-tools \
    dnsutils \
    htop \
    # Process management
    procps \
    # Shell & scripting
    bash \
    jq \
    # File tools
    sudo \
    unzip \
    zip \
    tar \
    # Docker CLI (for nested container builds & deployment)
    docker.io \
    docker-compose \
    # Python (for tooling scripts if needed)
    python3 \
    python3-pip \
    # Playwright system deps (for E2E testing)
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2t64 \
    libxshmfence1 \
    # Image processing (for asset pipeline)
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

# ─── Agent user with FULL sudo (passwordless) ───────────────────────
# Agents have complete root autonomy — no prompts, no restrictions
ARG USERNAME=agent-awesome
ARG USER_UID=1000
ARG USER_GID=1000

RUN if id -u ${USER_UID} >/dev/null 2>&1; then \
        OLD_USER=$(getent passwd ${USER_UID} | cut -d: -f1); \
        userdel -r "$OLD_USER" 2>/dev/null || true; \
    fi \
    && groupadd --force --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} -m -s /bin/bash ${USERNAME} \
    && echo "${USERNAME} ALL=(ALL:ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} \
    && chmod 0440 /etc/sudoers.d/${USERNAME} \
    # Add to docker group for Docker-in-Docker
    && usermod -aG docker ${USERNAME}

USER ${USERNAME}
WORKDIR /home/${USERNAME}

# ─── Bun runtime (primary runtime for server + tooling) ─────────────
RUN curl -fsSL https://bun.sh/install | bash

ENV BUN_INSTALL="/home/${USERNAME}/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"


# ─── Node.js compatibility ───────────────────────────────────────────
# Playwright and other tools require a real Node.js with npx.
# Install Node.js LTS via NodeSource.
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - \
    && sudo apt-get install -y --no-install-recommends nodejs \
    && sudo rm -rf /var/lib/apt/lists/*

# ─── pnpm + DeepSeek Harness source ────────────────────────────────
# pnpm is required to run the harness from source checkout in .dsh/deepseek-harness.
RUN sudo npm install -g pnpm@11.7.0 \
    && pnpm --version \
    && sudo npm install -g @deepseek-ai/dsh

# ─── Global Bun tools ───────────────────────────────────────────────
# Pre-install commonly needed global tools so agents don't wait
RUN bun install -g \
    typescript@^7.0.2 \
    @biomejs/biome \
    concurrently \
    wrangler

# ─── Git config (agents can commit autonomously) ────────────────────
RUN git config --global user.name "Agent Awesome" \
    && git config --global user.email "agent-awesome@agent-awesome.dev" \
    && git config --global init.defaultBranch main \
    && git config --global pull.rebase false \
    && git config --global core.autocrlf input

# ─── Shell environment ──────────────────────────────────────────────
RUN echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc \
    && echo 'export EDITOR=code' >> ~/.bashrc \
    && echo 'alias ll="ls -alF"' >> ~/.bashrc \
    && echo 'alias gs="git status"' >> ~/.bashrc \
    && echo 'alias dev="bun run dev"' >> ~/.bashrc

# ─── Verify installation ───────────────────────────────────────────
RUN echo "--- Bun ---" && bun --version \
    && echo "--- Git ---" && git --version \
    && echo "--- TypeScript ---" && tsc --version \
    && echo "--- Biome ---" && biome --version \
    && echo "--- DeepSeek Harness ---" && dsh --version \
    && echo "✅ Agent Awesome dev environment ready"

# ─── Ports ──────────────────────────────────────────────────────────
# 3080 = DeepSeek Harness Web UI
# 3000 = Bun WebSocket game server
# 5173 = Vite dev server (Phaser client)
# 5174 = VitePress docs (if used)
EXPOSE 3080 3000 5173 5174

# ─── Workspace ──────────────────────────────────────────────────────
WORKDIR /workspace/agent-awesome
