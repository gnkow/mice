# Boxen — common local tasks
# Examples:
#   make up
#   make test
#   make smoke

# Slow-mo delay (ms) for make test-view
SLOWMO ?= 500

.PHONY: help up down install test smoke test-view test-ui reset clean clear

help:
	@echo "Targets:"
	@echo "  make up         Start oxen-server + web (detached)"
	@echo "  make down       Stop Compose stack (keep volumes)"
	@echo "  make reset      Wipe oxen + auth data volumes, restart stack"
	@echo "  make clean      Stop stack, wipe volumes + deps + test artifacts"
	@echo "  make install    npm install + Playwright Chromium"
	@echo "  make test       Run Playwright E2E headless (stack must be up)"
	@echo "  make smoke      Run smoke E2E suite only"
	@echo "  make test-view  Run E2E headed + slow-mo (watch in browser)"
	@echo "  make test-ui    Interactive Playwright UI mode"
	@echo ""
	@echo "Pass extra Playwright flags via ARGS, e.g.:"
	@echo "  make test ARGS='--headed'"
	@echo "  make test-view ARGS='-g smoke' SLOWMO=1000"

up:
	docker compose up -d --build

down:
	docker compose down

install:
	npm install
	npx playwright install chromium

test: install
	npm test -- $(ARGS)

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
	docker compose up -d --build
	@echo "Reset oxen + auth data volumes and restarted the stack."

# Tear down Compose (including oxen data + web node_modules volumes),
# and remove local install / Playwright artifacts.
clean clear:
	docker compose down -v --remove-orphans
	rm -rf test-results playwright-report blob-report
	rm -rf node_modules web/node_modules web/dist
	@echo "Cleared stack volumes, node_modules, and test artifacts."
