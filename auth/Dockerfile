FROM node:22-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json* ./
COPY . .
EXPOSE 8080
# Install Linux deps in the container (host macOS node_modules are not portable).
# --strict-ssl=false: some corp networks intercept TLS to the npm registry.
CMD ["sh", "-c", "npm install --strict-ssl=false && npm run dev"]
