FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production DB_PATH=/data/textback.db
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--no-warnings", "src/server.js"]
