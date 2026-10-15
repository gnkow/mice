# Dev: install at container start (named volume overlays node_modules).
# --strict-ssl=false: corp TLS intercepts break npm inside the image.
FROM node:22-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json* ./
COPY . .
EXPOSE 5173
CMD ["sh", "-c", "npm install --strict-ssl=false && npm run dev -- --host 0.0.0.0 --port 5173"]

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --strict-ssl=false

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
