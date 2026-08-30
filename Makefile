# ai-dev-team — local development helpers
# Requires: docker compose v2, a filled .env (see .env.example)

.PHONY: setup build up infra agents down ps logs demo manual-test pin

# Create .env from the example if missing
setup:
	@test -f .env || (cp .env.example .env && echo "Created .env — edit it and set DEEPSEEK_API_KEY")
	@test -f .env && echo ".env present" || true

# Build the DSH agent image (once, shared by all 5 agents) + orchestrator
build: setup
	docker compose build

# Start the whole stack (infra + orchestrator + agents + integrations)
up: setup
	docker compose --profile agents --profile integrations up -d

# Start only infrastructure + orchestrator
infra: setup
	docker compose up -d postgres redis orchestrator

# Start only the headless DSH agent containers (requires infra)
agents: setup
	docker compose --profile agents up -d dsh-pm dsh-backend dsh-frontend dsh-tester dsh-reviewer

# Start only the integrations (Redmine + MCP bridges)
integrations: setup
	docker compose --profile integrations up -d

down:
	docker compose down

ps:
	docker compose ps

logs:
	docker compose logs -f --tail=100

# Seed a demo project + task graph and dispatch the first task
demo: setup
	docker compose exec orchestrator node dist/seed.js

# Prove the Docker -> DSH -> headless -> API -> workspace chain manually:
#   make manual-test AGENT=dsh-backend
manual-test:
	docker compose exec $(AGENT) bash -c 'cd /workspace/project && dsh --profile headless "Inspect the repository and describe the backend architecture. Do not modify files."'

# Show which DSH commit the agent image is pinned to
pin:
	docker compose exec dsh-pm bash -c 'cd /opt/deepseek-harness && git log -1 --format="dsh pinned at %H %s"'
