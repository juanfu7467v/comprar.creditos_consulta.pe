# PingPulse - Micro-SaaS de Monitoreo de APIs y Páginas Web

PingPulse es un sistema modular de monitoreo de APIs y páginas web diseñado para agencias y startups que buscan una alternativa profesional y económica a herramientas como BetterStack o StatusPage.

## 📋 Características

### MVP (Fase 1)
- ✅ **Worker de Monitoreo**: Proceso en segundo plano que ejecuta checks cada 1-5 minutos
- ✅ **Dashboard de Usuario**: Interfaz para agregar/editar URLs y configurar frecuencia
- ✅ **Status Page Pública**: Página simple y rápida que muestra uptime de los últimos 30 días
- ✅ **Sistema de Alertas**: Notificaciones automáticas cuando el estado cambia (Up → Down)
- ✅ **Suscripciones**: Prueba gratuita de 24 horas + planes de pago
- ✅ **Badge de Uptime**: Escudo tipo GitHub que muestra uptime en tiempo real
- ✅ **Monitoreo SSL**: Detecta vencimiento de certificados y alerta 7 días antes
- ✅ **Bot de Telegram**: Recibe alertas críticas en Telegram
- ✅ **Reporte Semanal Automático**: Email con estadísticas de uptime

## 🏗️ Arquitectura

```
pingpulse/
├── worker/           # Proceso de monitoreo en segundo plano
│   ├── monitor.js    # Worker principal
│   └── fly.toml      # Configuración para Fly.io
├── api/              # API REST para dashboard y status page
│   ├── index.js      # Rutas principales
│   └── badge.js      # Generador de badges SVG
├── shared/           # Código compartido
│   ├── firebase.js   # Configuración de Firebase
│   └── alerts.js     # Sistema de alertas (Email, Telegram, Slack)
└── public/           # Páginas públicas (en /public del proyecto)
    ├── pingpulse-dashboard.html
    └── pingpulse-status.html
```

## 🗄️ Modelo de Datos (Firebase Firestore)

### Colección: `pp_monitors`
```json
{
  "userId": "user123",
  "name": "API Principal",
  "url": "https://api.ejemplo.com/health",
  "type": "http",
  "frequency": 5,
  "status": "up",
  "uptime": 99.98,
  "active": true,
  "lastCheck": "2024-01-15T10:30:00Z",
  "lastDown": "2024-01-14T14:20:00Z",
  "notifications": {
    "email": "user@ejemplo.com",
    "telegram": "123456789",
    "slack": "https://hooks.slack.com/..."
  },
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Colección: `pp_logs`
```json
{
  "monitorId": "monitor123",
  "status": "up",
  "responseTime": 245,
  "timestamp": "2024-01-15T10:30:00Z",
  "error": null
}
```

### Colección: `pp_incidents`
```json
{
  "monitorId": "monitor123",
  "startTime": "2024-01-14T14:20:00Z",
  "endTime": "2024-01-14T14:35:00Z",
  "duration": 900,
  "errorMessage": "Connection timeout"
}
```

### Colección: `pp_subscriptions`
```json
{
  "userId": "user123",
  "plan": "pro",
  "status": "active",
  "maxMonitors": 20,
  "frequency": 1,
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-02-01T00:00:00Z",
  "mercadoPagoId": "mp123456"
}
```

## 💰 Planes de Suscripción

| Plan | Precio | Endpoints | Frecuencia | Notificaciones | Beneficio |
|------|--------|-----------|-----------|---|---|
| **Starter** | $9/mes | 3-5 | Cada 5 min | Email + Telegram | Freelancers |
| **Pro** | $24/mes | 20 | Cada 1 min | Email + Telegram + Slack | Startups |
| **Business** | $49/mes | 75 | Cada 30 seg | Todo + Webhooks | Reportes + SSL |
| **Agency** | $99/mes | 200 | Cada 30 seg | Prioritarias | Marca blanca |

**Prueba Gratuita**: 24 horas con acceso a plan Pro

## 🚀 Instalación y Configuración

### Requisitos
- Node.js 20+
- Firebase Admin SDK
- Resend API Key (para emails)
- Fly.io CLI (para despliegue)

### Variables de Entorno

```bash
# Firebase
FIREBASE_PROJECT_ID=tu-proyecto
FIREBASE_PRIVATE_KEY=tu-clave-privada
FIREBASE_CLIENT_EMAIL=tu-email@firebase.iam.gserviceaccount.com
FIREBASE_SERVICE_ACCOUNT={"project_id":"..."}

# Notificaciones
RESEND_API_KEY=tu-api-key-resend
TELEGRAM_BOT_TOKEN=tu-bot-token
SLACK_WEBHOOK_URL=tu-webhook-url

# Mercado Pago
MERCADOPAGO_ACCESS_TOKEN=tu-access-token

# Entorno
NODE_ENV=production
```

### Instalación Local

```bash
# Instalar dependencias
npm install

# Ejecutar worker en desarrollo
npm run dev:worker

# Ejecutar servidor principal
npm run dev
```

## 📡 API Endpoints

### Autenticación
```
POST /api/pingpulse/auth/login
POST /api/pingpulse/auth/logout
```

### Monitores
```
GET    /api/pingpulse/monitors           # Obtener todos los monitores del usuario
POST   /api/pingpulse/monitors           # Crear nuevo monitor
GET    /api/pingpulse/monitors/:id       # Obtener detalles de un monitor
PUT    /api/pingpulse/monitors/:id       # Actualizar monitor
DELETE /api/pingpulse/monitors/:id       # Eliminar monitor
```

### Status Page Pública
```
GET    /api/pingpulse/status/:id         # Estado público de un monitor
GET    /api/pingpulse/badge/:id          # Badge SVG de uptime
```

### Reportes
```
GET    /api/pingpulse/reports/daily/:id  # Reporte diario
GET    /api/pingpulse/reports/weekly/:id # Reporte semanal
```

## 🔧 Despliegue

### En Fly.io

```bash
# Login en Fly.io
flyctl auth login

# Crear aplicación
flyctl launch --config pingpulse/worker/fly.toml

# Desplegar
flyctl deploy --config pingpulse/worker/fly.toml

# Ver logs
flyctl logs
```

### CI/CD con GitHub Actions

El workflow automático se ejecuta cuando hay cambios en la rama `main` en la carpeta `pingpulse/`:

```bash
.github/workflows/pingpulse-deploy.yml
```

## 🔐 Seguridad

- Autenticación integrada con el sistema existente de Masitaprex
- Validación de URLs antes de monitorear
- Rate limiting en endpoints públicos
- Encriptación de credenciales de notificación
- CORS configurado para dominios específicos

## 📊 Monitoreo y Logs

El sistema registra:
- Cambios de estado (Up → Down)
- Tiempo de respuesta de cada check
- Errores y excepciones
- Resumen diario de uptime

Los logs se almacenan en Firestore con optimización para minimizar costos.

## 🎯 Roadmap Futuro

- [ ] Fase 2: Webhooks personalizados
- [ ] Fase 3: Marca blanca (White Label)
- [ ] Fase 4: Integración con PagerDuty
- [ ] Fase 5: Analytics avanzado
- [ ] Fase 6: Monitoreo de performance (Lighthouse)

## 📝 Notas Importantes

- **No modifica el sistema existente**: Todo el código de PingPulse está en la carpeta `/pingpulse/`
- **Reutiliza Firebase**: Usa la misma instancia de Firebase que el proyecto principal
- **Reutiliza Mercado Pago**: Integración de pagos ya configurada
- **Modular y escalable**: Cada componente puede funcionar de forma independiente

## 🤝 Contribuciones

Para agregar nuevas funcionalidades:
1. Crea una rama desde `main`
2. Desarrolla en `/pingpulse/`
3. Prueba localmente
4. Abre un Pull Request

## 📞 Soporte

Para reportar bugs o sugerencias, abre un issue en el repositorio.

---

**Desarrollado por**: Manus AI  
**Última actualización**: 2024-01-15
