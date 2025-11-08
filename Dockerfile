# -------- build --------
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build  # מייצר dist/

# -------- runtime --------
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# ffmpeg נדרש להמרת MP3 -> μ-law 8k
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# אם יש SA לגוגל: COPY sa.json /app/sa.json

CMD ["node","dist/index.js"]
