# -------- deps/build --------
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json* ./
RUN npm ci
COPY . .
RUN npm run build

# -------- runtime --------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# ffmpeg למעבר MP3 -> μ-law
RUN apk add --no-cache ffmpeg

COPY --from=build /app/package*.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# במידה ויש קובץ SA של גוגל:
# COPY sa.json /app/sa.json

CMD ["node", "dist/index.js"]
