FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates wget

COPY package*.json ./
RUN npm install --omit=dev

RUN mkdir -p /app/certs \
    && wget -O /app/certs/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

COPY src ./src

EXPOSE 3000

CMD ["node", "src/index.js"]
