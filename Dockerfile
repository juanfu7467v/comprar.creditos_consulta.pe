# syntax=docker/dockerfile:1

# Etapa base
FROM node:20.18.0-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Etapa de compilación
FROM base AS build
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential python-is-python3

COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Imagen final
FROM base
COPY --from=build /app /app
EXPOSE 8080
CMD ["npm", "run", "start"]
