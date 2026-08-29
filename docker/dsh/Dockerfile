# ==========================================================
# ai-dev-team — shared DeepSeek Harness agent image
#
# One Dockerfile, five containers. Each compose service only
# varies AGENT_ID / AGENT_ROLE / workspace mount.
#
# DSH is a developer preview with frequent breaking changes,
# so DSH_REF is pinned to a commit by default for reproducible
# builds. Override with:
#   docker compose build --build-arg DSH_REF=<branch|tag|sha>
# ==========================================================
FROM node:24-bookworm

ARG DSH_REPO=https://github.com/deepseek-ai/deepseek-harness.git
ARG DSH_REF=cd5ef8148158c3a752a658978873241fdf8e2bbc

ENV DEBIAN_FRONTEND=noninteractive
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# DSH home (profiles, config, credentials)
ENV DSH_HOME=/home/dsh/.dsh

# Default agent workspace; compose overrides AGENT_WORKSPACE per role
ENV AGENT_WORKSPACE=/workspace/project

# Never prompt for git credentials inside the container
ENV GIT_TERMINAL_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        bash \
        curl \
        ca-certificates \
        openssh-client \
        build-essential \
        python3 \
    && rm -rf /var/lib/apt/lists/*

# Node 24 + pnpm (the DSH monorepo's package manager; npm cannot
# resolve the workspace:^ protocol used by the repo)
RUN corepack enable \
    && corepack prepare pnpm@11.7.0 --activate

# Non-root runtime user. The official node image already ships a
# uid-1000 user named "node" (useradd --uid 1000 would collide), so
# rename it to "dsh". Keeping uid 1000 matches the orchestrator image
# and typical Linux dev hosts whose uid 1000 owns the bind mounts.
RUN usermod -l dsh -d /home/dsh -m -s /bin/bash node \
    && groupmod -n dsh node \
    && getent passwd dsh

WORKDIR /opt/deepseek-harness

# Fetch the pinned revision. `git fetch origin <ref>` resolves a
# branch, a tag, or a commit sha (GitHub allows sha fetches), so
# DSH_REF can be any of the three.
RUN git init -q \
    && git remote add origin ${DSH_REPO} \
    && git fetch -q --depth 1 origin ${DSH_REF} \
    && git checkout -q FETCH_HEAD \
    && git log -1 --format='dsh: pinned %H %s'

# Install + build DSH exactly as upstream documents:
#   pnpm install -> pnpm run build -> pnpm dsh <args>
RUN pnpm install --frozen-lockfile

RUN pnpm run build

# pnpm does not link workspace-member bins (apps/cli -> "dsh") into the
# root node_modules/.bin, and the upstream source-run path is `pnpm dsh`
# (a repo-root script). Our agent runner invokes `dsh` directly from the
# agent workspace, so link the built launcher explicitly. The target is
# absolute on purpose: node_modules/.bin may sit under a pnpm layout
# where a relative target would dangle.
RUN ln -s /opt/deepseek-harness/apps/cli/lib/bin.js /opt/deepseek-harness/node_modules/.bin/dsh

# Runtime directories + the agent runner (copied from the project
# build context; the runner bridges this container to the orchestrator).
# --chown is required: host files may be 0600, and the runtime user
# is dsh (uid 1000), not root.
RUN mkdir -p \
        /home/dsh/.dsh \
        /workspace/project \
        /opt/agent-runner \
    && chown -R dsh:dsh \
        /home/dsh \
        /workspace \
        /opt/agent-runner

COPY --chown=dsh:dsh agent-runner/ /opt/agent-runner/

# dsh source checkout is root-owned; the dsh user only reads it
USER dsh

WORKDIR /workspace/project

ENV PATH="/opt/deepseek-harness/node_modules/.bin:${PATH}"

# Default command: the agent runner loop.
# Override per service in docker-compose when debugging, e.g.:
#   command: ["bash"]
CMD ["node", "/opt/agent-runner/runner.js"]
