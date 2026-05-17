FROM node:22-alpine

RUN apk add --no-cache libressl openssl

WORKDIR /app

COPY . .

RUN npm install
RUN npm run db:generate
RUN npm run build

CMD ["node", "apps/worker/dist/main.js"]
