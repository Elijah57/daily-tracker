# ---- Build stage: compile the React client ----
FROM node:22-alpine AS build
WORKDIR /app

# Install all dependencies (root + client). Server deps are not needed in build.
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
# Vite config is read at build time
COPY client/ client/

RUN cd client && npm install

# Build the client into client/dist
RUN cd client && npm run build

# ---- Runtime stage: Express server serves the built client ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install only server production dependencies
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --omit=dev

# Copy server source
COPY server/ server/

# Copy the built client from the build stage
COPY --from=build /app/client/dist ./client/dist

# Data directory (writable)
RUN mkdir -p server/data
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/src/index.js"]
