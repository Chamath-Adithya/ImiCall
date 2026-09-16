FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build frontend bundle
COPY . .
RUN npm run build

# Expose default port
EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

# Start unified static + websocket signaling server
CMD ["node", "server/signaling.js"]
