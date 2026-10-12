FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM deps AS dev
WORKDIR /app
COPY . .
EXPOSE 5173
# Reconcile volume-mounted node_modules with package.json on start
CMD ["sh", "-c", "npm install && npm run dev -- --host 0.0.0.0 --port 5173"]

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
