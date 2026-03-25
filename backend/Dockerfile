FROM node:18-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

# Generate Prisma client
RUN npx prisma generate

EXPOSE 4000
CMD ["node", "src/index.js"]
