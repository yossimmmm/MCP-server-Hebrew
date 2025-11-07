# -------- deps/build stage --------
FROM node:20-alpine AS build
WORKDIR /app

# קבצי חבילות (תמיד יתפסו גם אם אין lock)
COPY package*.json* ./
RUN npm ci

# קוד + tsconfig
COPY . .
# קומפילציה ל-TS -> dist
RUN npm run build

# -------- runtime stage --------
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run יזריק PORT; נחשוף גם 8080 מקומית
ENV PORT=8080
EXPOSE 8080

# רק מה שצריך להרצה
COPY --from=build /app/package*.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# הפעלה
CMD ["node", "dist/index.js"]
