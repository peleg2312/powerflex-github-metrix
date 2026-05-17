FROM node:22-alpine

RUN apk add --no-cache libressl openssl

ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

WORKDIR /app

COPY . .

RUN npm install
RUN npm run db:generate
RUN npm run build

EXPOSE 5173

CMD ["npm", "run", "preview", "-w", "apps/web", "--", "--host", "0.0.0.0", "--port", "5173"]
