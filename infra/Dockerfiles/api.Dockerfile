FROM node:22-alpine

RUN apk add --no-cache libressl openssl

WORKDIR /app

COPY . .

RUN npm install
RUN npm run db:generate
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "echo 'Running migrations...' && npx prisma migrate deploy --schema packages/db/prisma/schema.prisma && echo 'Migrations done, starting API...' && node apps/api/dist/main.js"]