FROM node:20-slim

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install \
	&& find node_modules/.bin -type f -print0 | xargs -0 -r sed -i 's/\r$//' \
	&& find node_modules -type f -name "*.sh" -print0 | xargs -0 -r sed -i 's/\r$//'

ENV PATH=/usr/src/app/node_modules/.bin:$PATH

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
