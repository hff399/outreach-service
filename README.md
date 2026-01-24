# Telegram Outreach Service

Автоматизированный сервис для аутрича в Telegram с CRM-системой, кампаниями рассылок и автоответчиками.

## Возможности

- **Управление TG аккаунтами** - подключение множества аккаунтов через GramJS
- **Кампании рассылок** - автоматическая отправка сообщений в группы
- **Автоответчик (Sequences)** - цепочки автоматических ответов
- **CRM система** - управление лидами с real-time чатом
- **Шаблоны сообщений** - переиспользуемые шаблоны с переменными

## Технологии

- **Frontend**: Next.js 14, React, Tailwind CSS, shadcn/ui
- **Backend**: Fastify, GramJS (Telegram MTProto)
- **Database**: Supabase (PostgreSQL)
- **Real-time**: WebSocket, Supabase Realtime

## Структура проекта

```
outreach-service/
├── apps/
│   ├── backend/          # Fastify API сервер
│   │   ├── src/
│   │   │   ├── routes/       # API endpoints
│   │   │   ├── services/     # Бизнес-логика
│   │   │   ├── jobs/         # Scheduled jobs
│   │   │   └── lib/          # Утилиты
│   │   └── sessions/         # Telegram сессии
│   │
│   └── frontend/         # Next.js приложение
│       └── src/
│           ├── app/          # Страницы (App Router)
│           ├── components/   # React компоненты
│           ├── lib/          # Утилиты и API клиент
│           └── hooks/        # React hooks
│
├── packages/
│   └── shared/           # Общие типы и утилиты
│
└── supabase/
    └── migrations/       # SQL миграции
```

## Установка

### 1. Клонирование и установка зависимостей

```bash
cd outreach-service
npm install
```

### 2. Настройка Supabase

1. Создайте проект на [supabase.com](https://supabase.com)
2. Выполните миграции:
   ```bash
   npx supabase db push
   ```
3. Сгенерируйте типы:
   ```bash
   npm run db:generate-types
   ```

### 3. Настройка Telegram API

1. Зарегистрируйте приложение на [my.telegram.org](https://my.telegram.org)
2. Получите `api_id` и `api_hash`

### 4. Конфигурация

Создайте `.env.local` в корне проекта:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_PROJECT_ID=your-project-id

# Backend
BACKEND_PORT=3001
BACKEND_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:3000

# Frontend
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001

# Telegram
TG_API_ID=your-api-id
TG_API_HASH=your-api-hash

# Security
JWT_SECRET=your-32-char-secret-key
ENCRYPTION_KEY=your-32-byte-hex-key
```

### 5. Запуск в режиме разработки

```bash
# Запуск backend
npm run dev:backend

# Запуск frontend (в другом терминале)
npm run dev:frontend
```

Приложение будет доступно:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## API Endpoints

### Аккаунты
- `GET /api/accounts` - список аккаунтов
- `POST /api/accounts` - добавить аккаунт
- `POST /api/accounts/:id/auth/start` - начать авторизацию
- `POST /api/accounts/:id/auth/complete` - завершить авторизацию
- `GET /api/accounts/health/all` - статус подключения

### Кампании
- `GET /api/campaigns` - список кампаний
- `POST /api/campaigns` - создать кампанию
- `POST /api/campaigns/:id/start` - запустить
- `POST /api/campaigns/:id/pause` - приостановить

### Секвенции
- `GET /api/sequences` - список секвенций
- `POST /api/sequences` - создать секвенцию
- `POST /api/sequences/:id/activate` - активировать

### Лиды
- `GET /api/leads` - список лидов с фильтрацией
- `PATCH /api/leads/:id/status` - обновить статус

### Сообщения
- `GET /api/messages/lead/:leadId` - история сообщений
- `POST /api/messages/send` - отправить сообщение

## WebSocket Events

### Client -> Server
- `subscribe` - подписка на каналы
- `unsubscribe` - отписка
- `ping` - keepalive

### Server -> Client
- `message:new` - новое сообщение
- `message:sent` - сообщение отправлено
- `account:status_changed` - изменение статуса аккаунта
- `lead:typing` - индикатор печати
- `campaign:message_sent` - прогресс кампании

## Production Deployment

### Backend (pm2)

```bash
cd apps/backend
npm run build
npm run start:pm2
```

### Frontend (pm2 или Vercel)

```bash
cd apps/frontend
npm run build
npm start
```

## Лицензия

MIT
