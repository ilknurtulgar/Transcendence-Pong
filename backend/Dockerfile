FROM node:20-slim

RUN apt-get update --fix-missing && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install \
    && npm rebuild sqlite3 \
    && rm -f node_modules/.bin/nodemon \
    && ln -sf ../nodemon/bin/nodemon.js node_modules/.bin/nodemon \
    && find node_modules -type f \( -name "*.js" -o -name "*.json" -o -name "*.sh" -o -name "*.cjs" -o -name "*.mjs" -o -name "nodemon*" \) -print0 | xargs -0 -r sed -i 's/\r$//'

ENV PATH=/usr/src/app/node_modules/.bin:$PATH

COPY . .

RUN find /usr/src/app -type f \( -name "*.js" -o -name "*.json" -o -name "*.ts" -o -name "*.sh" -o -name "*.cjs" -o -name "*.mjs" \) -print0 | xargs -0 -r sed -i 's/\r$//'

EXPOSE 3000

# Uygulamayı başlat
CMD ["npm", "run", "dev"]