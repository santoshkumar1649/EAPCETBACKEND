# Step 1: Base Image
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS base

# Step 2: Establish working directory
WORKDIR /app

# Step 3: Copy packages and install dependencies
COPY package*.json ./
RUN npm ci

# Step 4: Copy source code
COPY . .

# Step 5: Expose default port
EXPOSE 5000

# Step 6: Start application
CMD ["npm", "start"]
