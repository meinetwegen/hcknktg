# Этап 1: Сборка
FROM node:22-alpine AS builder

WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# Собираем проект (Vite создаст папку dist)
RUN npm run build

# Этап 2: Запуск
FROM node:22-alpine

WORKDIR /app

# Копируем только необходимые файлы из сборщика
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts

# Устанавливаем tsx глобально или используем из node_modules для запуска .ts файла
ENV NODE_ENV=production

EXPOSE 3000

# Запуск сервера
CMD ["npx", "tsx", "server.ts"]