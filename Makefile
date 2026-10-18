# Boxen — common local tasks
# Examples:
#   make up
#   make test
#   make smoke

# Slow-mo delay (ms) for make test-view
SLOWMO ?= 500

# Host path for job workdirs (Docker Desktop must see this for `docker run -v`).
export JOBS_HOST_DATA_DIR ?= $(CURDIR)/.data/jobs

.PHONY: help up down install test smoke test-view test-ui test-unit test-cli reset clean clear readwatch

help:
	@echo "Targets:"
	@echo "  make up         Start oxen-server + web (detached)"
	@echo "  make down       Stop Compose stack (keep volumes)"
	@echo "  make reset      Wipe oxen + auth data volumes, restart stack"
	@echo "  make clean      Stop stack, wipe volumes + deps + test artifacts"
	@echo "  make install    npm install + Playwright Chromium"
	@echo "  make test-unit  Auth + CLI + web unit tests (no stack required)"
	@echo "  make test       Run Playwright E2E headless (stack must be up)"
	@echo "  make test-cli   CLI/PAT/device E2E only (stack must be up)"
	@echo "  make smoke      Run smoke E2E suite only"
	@echo "  make test-view  Run E2E headed + slow-mo (watch in browser)"
	@echo "  make test-ui    Interactive Playwright UI mode"
	@echo "  make readwatch  Build linux boxen-readwatch binaries (jobs input detection)"
	@echo ""
	@echo "Pass extra Playwright flags via ARGS, e.g.:"
	@echo "  make test ARGS='--headed'"
	@echo "  make test-view ARGS='-g smoke' SLOWMO=1000"

# Static inotify helper for job input observation (auth container is Linux).
readwatch:
	cd auth/cmd/boxen-readwatch && \
	  go mod tidy && \
	  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags='-s -w' -o ../../bin/linux-arm64/boxen-readwatch . && \
	  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o ../../bin/linux-amd64/boxen-readwatch .

up:
	@if [ ! -x auth/bin/linux-arm64/boxen-readwatch ] || [ ! -x auth/bin/linux-amd64/boxen-readwatch ]; then \
	  $(MAKE) readwatch; \
	fi
	mkdir -p "$(JOBS_HOST_DATA_DIR)"
	docker compose up -d --build

down:
	docker compose down

install:
	npm install
	npx playwright install chromium

test-unit:
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

# Wipe persisted server data (repos + authz/PATs/audit), keep node_modules.
reset:
	docker compose down --remove-orphans
	-docker volume rm boxen_oxen-data boxen_auth_data
	rm -rf "$(JOBS_HOST_DATA_DIR)"
	mkdir -p "$(JOBS_HOST_DATA_DIR)"
	docker compose up -d --build
	@echo "Reset oxen + auth data volumes and restarted the stack."

# Tear down Compose (including oxen data + web node_modules volumes),
# and remove local install / Playwright artifacts.
clean clear:
	docker compose down -v --remove-orphans
	rm -rf "$(JOBS_HOST_DATA_DIR)"
	rm -rf test-results playwright-report blob-report
	rm -rf node_modules web/node_modules web/dist
	@echo "Cleared stack volumes, node_modules, and test artifacts."
