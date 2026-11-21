FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV BRAIN_VAULT=/vault BRAIN_HOST=0.0.0.0 BRAIN_PORT=7777 NODE_OPTIONS=--no-warnings
VOLUME /vault
EXPOSE 7777
USER node
CMD ["node", "src/http.js"]
