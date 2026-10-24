# Official CLI binary — avoids `apk` (corp TLS often breaks Alpine mirrors).
FROM docker:27-cli AS dockercli

FROM node:22-alpine AS dev
ARG TARGETARCH=amd64
WORKDIR /app
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
# Prebuilt by `make readwatch` (static inotify helper; apk inotify-tools often blocked).
COPY bin/linux-${TARGETARCH}/mice-readwatch /usr/local/bin/mice-readwatch
# Overlay marker reader (getfattr replacement; `apk add attr` is often blocked).
COPY bin/linux-${TARGETARCH}/mice-xattr /usr/local/bin/mice-xattr
RUN chmod +x /usr/local/bin/mice-readwatch /usr/local/bin/mice-xattr
COPY package.json package-lock.json* ./
COPY . .
EXPOSE 8080
# Install Linux deps in the container (host macOS node_modules are not portable).
# --strict-ssl=false: some corp networks intercept TLS to the npm registry.
# mice-readwatch observes job input file opens for lineage.
CMD ["sh", "-c", "npm install --strict-ssl=false && npm run dev"]
