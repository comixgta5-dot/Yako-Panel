# YAKO HUB — Squad Admin Panel (zero-dependency Node.js app)
FROM node:20-alpine

WORKDIR /app

# App code
COPY package.json ./
COPY server.js rcon.js store.js auth.js plugins.js bm.js ./
COPY public ./public
# Default config baked in (override with a volume mount and/or env vars)
COPY config.json ./config.json

# Persistent data (users, roles, chat log, bans, etc.)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Listen on all interfaces inside the container so the published port works
ENV PANEL_HOST=0.0.0.0 \
    PANEL_PORT=8973

EXPOSE 8973
CMD ["node", "server.js"]
