# Mice — common local tasks
# Examples:
#   make up
#   make test
#   make smoke

# Slow-mo delay (ms) for make test-view
SLOWMO ?= 500

# Host path for job workdirs (Docker Desktop must see this for `docker run -v`).
export JOBS_HOST_DATA_DIR ?= $(CURDIR)/.data/jobs
# Host path for session workspace mounts.
export SESSIONS_HOST_DATA_DIR ?= $(CURDIR)/.data/sessions
# Default: real Linux desktop guests. Use mock for fast unit/e2e only:
#   SESSIONS_PROVISIONER=mock make up
export SESSIONS_PROVISIONER ?= docker

.PHONY: db-secrets help up down install test smoke test-view test-ui test-unit test-cli reset clean clear readwatch

help:
	@echo "Targets:"
	@echo "  make db-secrets Generate dev passwords for PostgreSQL, immudb and Novu (.secrets/)"
	@echo "  make up         Start the stack (PostgreSQL, immudb, Novu, oxen-server, auth, web)"
	@echo "  make down       Stop Compose stack (keep volumes)"
	@echo "  make reset      Wipe all app data volumes + host job/session dirs, restart stack"
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

up: db-secrets
	@if [ ! -x auth/bin/linux-arm64/mice-readwatch ] || [ ! -x auth/bin/linux-amd64/mice-readwatch ]; then \
	  $(MAKE) readwatch; \
	fi
	mkdir -p "$(JOBS_HOST_DATA_DIR)" "$(SESSIONS_HOST_DATA_DIR)"
	docker compose up -d --build

test-sessions: install
	SESSIONS_PROVISIONER=mock npm test -- e2e/tests/sessions.spec.ts $(ARGS)

down:
	docker compose down

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

# Wipe every persisted app datastore, then bring the stack back up.
# Removes: Postgres, immudb, Novu (mongo/redis), oxen repos, auth /data,
# workspace store/overlays, host job/session dirs, leftover probe volumes.
# Keeps: node_modules volumes, .secrets/ (dev passwords).
reset:
	docker compose down --remove-orphans
	@for v in \
		mice_postgres-data \
		mice_immudb-data \
		mice_novu-mongodb \
		mice_novu-redis \
		mice_oxen-data \
		mice_auth_data \
		$${WORKSPACES_STORE_VOLUME:-mice-store} \
		$${WORKSPACES_VOLUME:-mice-workspaces} \
		$$(docker volume ls -q --filter name=mice-probe); do \
		docker volume rm "$$v" 2>/dev/null || true; \
	done
	rm -rf "$(JOBS_HOST_DATA_DIR)" "$(SESSIONS_HOST_DATA_DIR)" auth/data
	mkdir -p "$(JOBS_HOST_DATA_DIR)" "$(SESSIONS_HOST_DATA_DIR)"
	docker compose up -d --build
	@echo "Reset all app data volumes and restarted the stack."

# Tear down Compose (including data + node_modules volumes),
# and remove local install / Playwright artifacts.
clean clear:
	docker compose down -v --remove-orphans
	-@for v in $$(docker volume ls -q --filter name=mice-probe); do docker volume rm "$$v"; done
	-@for v in mice-store mice-workspaces; do docker volume rm "$$v" 2>/dev/null || true; done
	rm -rf "$(JOBS_HOST_DATA_DIR)" "$(SESSIONS_HOST_DATA_DIR)" auth/data
	rm -rf test-results playwright-report blob-report
	rm -rf node_modules web/node_modules web/dist
	@echo "Cleared stack volumes, node_modules, and test artifacts."
