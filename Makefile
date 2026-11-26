# Mice — common local tasks
# Examples:
#   make up
#   make test
#   make smoke
#
# Container engine: auto-detects podman, else docker. Override with:
#   CONTAINER=docker make up

# Slow-mo delay (ms) for make test-view
SLOWMO ?= 500

# Prefer Podman when installed (this machine often has no `docker` binary).
CONTAINER ?= $(shell command -v podman >/dev/null 2>&1 && echo podman || echo docker)

# Host path for job workdirs (runner must see this for `run -v`).
export JOBS_HOST_DATA_DIR ?= $(CURDIR)/.data/jobs
# Host path for session workspace mounts.
export SESSIONS_HOST_DATA_DIR ?= $(CURDIR)/.data/sessions

# Docker Desktop: real Linux desktop guests + docker.sock via compose.docker.yaml.
# Podman: host docker.sock cannot be bind-mounted into the machine (statfs EOPNOTSUPP),
# so default to mock sessions and no jobs runner unless the user overrides.
ifeq ($(CONTAINER),podman)
export SESSIONS_PROVISIONER ?= mock
export JOBS_RUNNER ?= none
COMPOSE_FILES := -f compose.yaml -f compose.override.yaml
else
export SESSIONS_PROVISIONER ?= docker
export JOBS_RUNNER ?= docker
COMPOSE_FILES := -f compose.yaml -f compose.override.yaml -f compose.docker.yaml
endif

COMPOSE ?= $(CONTAINER) compose $(COMPOSE_FILES)

# How long `make seed` waits for Postgres/immudb/Keycloak/auth after compose up.
SEED_WAIT_SECONDS ?= 180

# Podman Desktop often leaves a stale machine SSH connection after sleep; `podman compose`
# then fails with "could not find a matching machine for connection" while plain
# `podman ps`/`exec` may still work. Start/refresh the machine before compose.
ifeq ($(CONTAINER),podman)
ensure-engine:
	@podman machine start >/dev/null 2>&1 || true
	@podman info >/dev/null 2>&1 || { \
	  echo "Podman machine is not reachable."; \
	  echo "  Fix: podman machine start"; \
	  echo "  If that fails: podman machine stop && podman machine start"; \
	  exit 1; \
	}
else
ensure-engine:
	@:
endif

.PHONY: db-secrets help up down install test smoke test-view test-ui test-unit test-cli reset clean clear readwatch wait-stack seed ensure-engine

help:
	@echo "Targets:"
	@echo "  make db-secrets Generate dev passwords for PostgreSQL, immudb and Novu (.secrets/)"
	@echo "  make up         Start the stack, then seed formal RBAC roles"
	@echo "  make seed       Wait for stack readiness, seed roles (only mice_pending stays role-less)"
	@echo "  make down       Stop Compose stack (keep volumes)"
	@echo "  make reset      Wipe app data volumes, then full bootstrap via make up (+ seed)"
	@echo "  make clean      Stop stack, wipe volumes + deps + test artifacts"
	@echo "  make install    npm install + Playwright Chromium"
	@echo "  make test-unit  Auth + CLI + web unit tests (no stack required)"
	@echo "  make test       Run Playwright E2E headless (stack must be up)"
	@echo "  make test-cli   CLI/PAT/device E2E only (stack must be up)"
	@echo "  make test-sessions  Sessions E2E only (stack must be up; mock provisioner)"
	@echo "  make smoke      Run smoke E2E suite only"
	@echo "  make test-view  Run E2E headed + slow-mo (watch in browser)"
	@echo "  make test-ui    Interactive Playwright UI mode"
	@echo "  make readwatch  Build linux mice-readwatch binaries (jobs input detection)"
	@echo ""
	@echo "Engine: CONTAINER=$(CONTAINER)  (override: CONTAINER=docker|podman)"
	@echo "  Podman omits compose.docker.yaml; defaults SESSIONS_PROVISIONER=mock JOBS_RUNNER=none"
	@echo "  Docker includes compose.docker.yaml (docker.sock) and real session/job runners"
	@echo ""
	@echo "Pass extra Playwright flags via ARGS, e.g.:"
	@echo "  make test ARGS='--headed'"
	@echo "  make test-view ARGS='-g smoke' SLOWMO=1000"

# Static inotify helper for job input observation (auth container is Linux).
readwatch:
	cd auth/cmd/mice-readwatch && \
	  go mod tidy && \
	  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags='-s -w' -o ../../bin/linux-arm64/mice-readwatch . && \
	  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o ../../bin/linux-amd64/mice-readwatch .

# Dev passwords for PostgreSQL and immudb (kept outside the data volumes; gitignored; never overwritten).
db-secrets:
	node scripts/gen-db-secrets.mjs

up: ensure-engine db-secrets
	@if [ ! -x auth/bin/linux-arm64/mice-readwatch ] || [ ! -x auth/bin/linux-amd64/mice-readwatch ]; then \
	  $(MAKE) readwatch; \
	fi
	mkdir -p "$(JOBS_HOST_DATA_DIR)" "$(SESSIONS_HOST_DATA_DIR)"
	$(COMPOSE) up -d --build
	@$(MAKE) seed

# Wait until host-reachable Postgres/immudb + Keycloak realm + auth /readyz answer.
wait-stack:
	@echo "Waiting for Postgres, immudb, Keycloak, and auth (up to $(SEED_WAIT_SECONDS)s)…"
	@i=0; \
	while [ $$i -lt $(SEED_WAIT_SECONDS) ]; do \
	  if node scripts/check-databases.mjs >/dev/null 2>&1 \
	    && curl -sf -o /dev/null "http://127.0.0.1:$${KEYCLOAK_PORT:-8180}/realms/mice" \
	    && curl -sf -o /dev/null "http://127.0.0.1:$${AUTH_PORT:-8080}/readyz"; then \
	    echo "Stack is ready."; \
	    exit 0; \
	  fi; \
	  i=$$((i + 1)); \
	  sleep 1; \
	done; \
	echo "Timed out waiting for the stack. Check: $(COMPOSE) ps && $(COMPOSE) logs --tail=80"; \
	exit 1

# Assign formal roles so only mice_pending lands on /pending after a wipe.
# Runs inside auth so Postgres/Keycloak/Oxen hostnames and secrets match compose.
# Prefer `$(CONTAINER) exec` over `compose exec` — Podman Desktop's compose path
# can fail looking up the machine URI while plain exec against the container works.
seed: wait-stack
	@cid=$$($(CONTAINER) ps -q --filter label=com.docker.compose.service=auth | head -n1); \
	if [ -z "$$cid" ]; then \
	  cid=$$($(CONTAINER) ps -q --filter label=io.podman.compose.service=auth | head -n1); \
	fi; \
	if [ -z "$$cid" ]; then \
	  echo "auth container not running. Start the stack with: make up"; \
	  exit 1; \
	fi; \
	$(CONTAINER) exec $$cid npm run seed:dev

test-sessions: install
	SESSIONS_PROVISIONER=mock npm test -- e2e/tests/sessions.spec.ts $(ARGS)

down: ensure-engine
	$(COMPOSE) down

install:
	npm install
	npx playwright install chromium

test-unit:
	node scripts/check-databases.mjs
	npm run test:unit
	npm run test:cli:integration

test: install
	npm test -- $(ARGS)

test-cli: install
	npm run test:e2e:cli -- $(ARGS)

smoke: install
	npm test -- -g smoke $(ARGS)

# Visible browser, slowed actions so you can follow along.
test-view: install
	SLOWMO=$(SLOWMO) npm test -- --headed $(ARGS)

test-ui: install
	npm run test:e2e:ui -- $(ARGS)

# Wipe every persisted app datastore, then bootstrap via `make up`
# (db-secrets, readwatch, compose up --build, wait-stack, seed:dev).
# Removes: Postgres, immudb, Novu (mongo/redis), oxen repos, auth /data,
# workspace store/overlays, host job/session dirs, leftover probe volumes.
# Keeps: node_modules volumes, .secrets/ (dev passwords).
reset: ensure-engine
	$(COMPOSE) down --remove-orphans
	@for v in \
		mice_postgres-data \
		mice_immudb-data \
		mice_novu-mongodb \
		mice_novu-redis \
		mice_oxen-data \
		mice_auth_data \
		$${WORKSPACES_STORE_VOLUME:-mice-store} \
		$${WORKSPACES_VOLUME:-mice-workspaces} \
		$$($(CONTAINER) volume ls -q --filter name=mice-probe); do \
		$(CONTAINER) volume rm "$$v" 2>/dev/null || true; \
	done
	rm -rf "$(JOBS_HOST_DATA_DIR)" "$(SESSIONS_HOST_DATA_DIR)" auth/data
	@$(MAKE) up
	@echo "Reset all app data volumes and completed bootstrap (up + seed)."

# Tear down Compose (including data + node_modules volumes),
# and remove local install / Playwright artifacts.
clean clear: ensure-engine
	$(COMPOSE) down -v --remove-orphans
	-@for v in $$($(CONTAINER) volume ls -q --filter name=mice-probe); do $(CONTAINER) volume rm "$$v"; done
	-@for v in mice-store mice-workspaces; do $(CONTAINER) volume rm "$$v" 2>/dev/null || true; done
	rm -rf "$(JOBS_HOST_DATA_DIR)" "$(SESSIONS_HOST_DATA_DIR)" auth/data
	rm -rf test-results playwright-report blob-report
	rm -rf node_modules web/node_modules web/dist
	@echo "Cleared stack volumes, node_modules, and test artifacts."
