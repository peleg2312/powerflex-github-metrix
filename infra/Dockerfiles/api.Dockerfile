FROM node:22-alpine

RUN apk add --no-cache libressl openssl

WORKDIR /app

COPY . .

RUN npm install
RUN npm run db:generate
RUN npm run build

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]