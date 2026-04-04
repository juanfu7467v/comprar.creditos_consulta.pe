# UptimePulse - Guía de Despliegue

Este documento proporciona instrucciones completas para desplegar UptimePulse en Fly.io y configurar todos los servicios necesarios.

## 📋 Requisitos Previos

*   Cuenta en [Fly.io](https://fly.io)
*   Flyctl CLI instalado: `curl -L https://fly.io/install.sh | sh`
*   Cuenta en Firebase con un proyecto activo
*   Cuenta en Resend para envío de emails
*   Token de bot de Telegram (opcional)
*   Webhook de Slack (opcional)
*   Acceso a Mercado Pago

## 🚀 Despliegue en Fly.io

### 1. Autenticación en Fly.io

```bash
flyctl auth login
```

### 2. Crear Aplicación Principal

```bash
# Desde la raíz del proyecto
flyctl launch --name uptimepulse-main --region mia
```

Cuando se pregunte, responde:
*   **Copy configuration from existing app?**: No
*   **Would you like to set up a Postgresql database now?**: No
*   **Would you like to set up an Upstash Redis database now?**: No

### 3. Crear Aplicación Worker

```bash
# Desde la carpeta pingpulse/worker
flyctl launch --name uptimepulse-worker --region mia --config fly.toml
```

### 4. Configurar Variables de Entorno

#### Para la aplicación principal:

```bash
flyctl secrets set \
  FIREBASE_PROJECT_ID="tu-proyecto-id" \
  FIREBASE_PRIVATE_KEY="tu-clave-privada" \
  FIREBASE_CLIENT_EMAIL="tu-email@firebase.iam.gserviceaccount.com" \
  FIREBASE_SERVICE_ACCOUNT='{"project_id":"..."}' \
  RESEND_API_KEY="tu-api-key-resend" \
  TELEGRAM_BOT_TOKEN="tu-bot-token" \
  SLACK_WEBHOOK_URL="tu-webhook-url" \
  MERCADOPAGO_ACCESS_TOKEN="tu-access-token" \
  HOST_URL="https://www.masitaprex.com" \
  RECAPTCHA_CLAVE_SECRETA="tu-recaptcha-secret"
```

#### Para el worker:

```bash
flyctl secrets set \
  --app uptimepulse-worker \
  FIREBASE_PROJECT_ID="tu-proyecto-id" \
  FIREBASE_PRIVATE_KEY="tu-clave-privada" \
  FIREBASE_CLIENT_EMAIL="tu-email@firebase.iam.gserviceaccount.com" \
  FIREBASE_SERVICE_ACCOUNT='{"project_id":"..."}' \
  RESEND_API_KEY="tu-api-key-resend" \
  TELEGRAM_BOT_TOKEN="tu-bot-token" \
  SLACK_WEBHOOK_URL="tu-webhook-url"
```

### 5. Desplegar Aplicaciones

```bash
# Desplegar aplicación principal
flyctl deploy

# Desplegar worker
flyctl deploy --config pingpulse/worker/fly.toml --app uptimepulse-worker
```

## 🔐 Configuración de Servicios

### Firebase

1. Ve a [Firebase Console](https://console.firebase.google.com)
2. Selecciona tu proyecto
3. Ve a **Configuración del Proyecto** → **Cuentas de Servicio**
4. Haz clic en **Generar nueva clave privada**
5. Copia los valores:
   *   `project_id`
   *   `private_key`
   *   `client_email`
   *   El JSON completo para `FIREBASE_SERVICE_ACCOUNT`

### Resend (Email)

1. Ve a [Resend](https://resend.com)
2. Crea una cuenta y verifica tu dominio
3. Ve a **API Keys** y copia tu clave API
4. Asigna como `RESEND_API_KEY`

### Telegram Bot

1. Abre [@BotFather](https://t.me/botfather) en Telegram
2. Envía `/newbot` y sigue las instrucciones
3. Copia el token que recibes
4. Asigna como `TELEGRAM_BOT_TOKEN`

### Slack Webhook

1. Ve a [Slack API](https://api.slack.com/apps)
2. Crea una nueva aplicación
3. Ve a **Incoming Webhooks** y actívalo
4. Haz clic en **Add New Webhook to Workspace**
5. Selecciona el canal y autoriza
6. Copia la URL del webhook
7. Asigna como `SLACK_WEBHOOK_URL`

## 📡 Rutas de la API

### Dashboard
*   **URL**: `https://www.masitaprex.com/UptimePulse`
*   **Descripción**: Panel de control del usuario para gestionar monitores

### Status Page Pública
*   **URL**: `https://www.masitaprex.com/UptimePulse-Status?id={monitorId}`
*   **Descripción**: Página pública de estado del monitor

### API Endpoints

#### Monitores
```
GET    /api/pingpulse/monitors              # Obtener todos los monitores
POST   /api/pingpulse/monitors              # Crear nuevo monitor
GET    /api/pingpulse/monitors/:id          # Obtener detalles del monitor
PUT    /api/pingpulse/monitors/:id          # Actualizar monitor
DELETE /api/pingpulse/monitors/:id          # Eliminar monitor
```

#### Logs e Historial
```
GET    /api/pingpulse/monitors/:id/logs     # Obtener logs del monitor
GET    /api/pingpulse/monitors/:id/incidents # Obtener incidentes
```

#### Reportes
```
GET    /api/pingpulse/reports/daily/:id     # Reporte diario
GET    /api/pingpulse/reports/weekly/:id    # Reporte semanal
```

#### Estado Público
```
GET    /api/pingpulse/status/:id            # Estado público del monitor
GET    /api/pingpulse/badge/:id             # Badge SVG de uptime
```

## 🗄️ Modelo de Datos Firebase

### Colecciones Requeridas

```
pp_monitors/
  - userId: string
  - name: string
  - url: string
  - type: string (http, ssl)
  - frequency: number (minutos)
  - status: string (up, down, unknown)
  - uptime: number (porcentaje)
  - active: boolean
  - lastCheck: timestamp
  - lastDown: timestamp
  - lastResponseTime: number
  - notifications: object
  - sslDaysRemaining: number (opcional)
  - createdAt: timestamp

pp_logs/
  - monitorId: string
  - status: string
  - responseTime: number
  - timestamp: timestamp
  - error: string (opcional)
  - sslDaysRemaining: number (opcional)

pp_incidents/
  - monitorId: string
  - monitorName: string
  - startTime: timestamp
  - endTime: timestamp (opcional)
  - duration: number (ms)
  - errorMessage: string
  - status: string (ongoing, resolved)

pp_subscriptions/
  - userId: string
  - plan: string (free_trial, starter, pro, business, agency)
  - status: string (active, expired, cancelled)
  - maxMonitors: number
  - frequency: number
  - startDate: timestamp
  - endDate: timestamp
  - mercadoPagoId: string (opcional)
```

## 🔄 CI/CD con GitHub Actions

El workflow automático se ejecuta cuando hay cambios en la rama `main`:

```yaml
# .github/workflows/deploy-uptimepulse.yml
```

### Configurar Secrets en GitHub

1. Ve a tu repositorio en GitHub
2. **Settings** → **Secrets and variables** → **Actions**
3. Agrega los siguientes secrets:
   *   `FLY_API_TOKEN`: Token de Fly.io (obtén con `flyctl auth token`)
   *   `SLACK_WEBHOOK`: (Opcional) Webhook de Slack para notificaciones

## 📊 Monitoreo

### Logs en Fly.io

```bash
# Ver logs de la aplicación principal
flyctl logs --app uptimepulse-main

# Ver logs del worker
flyctl logs --app uptimepulse-worker
```

### Métricas

```bash
# Ver métricas de la aplicación
flyctl status --app uptimepulse-main
flyctl status --app uptimepulse-worker
```

## 🔧 Troubleshooting

### Error: "Firebase not initialized"

*   Verifica que `FIREBASE_SERVICE_ACCOUNT` esté correctamente configurado
*   Asegúrate de que el JSON esté escapado correctamente

### Error: "Resend API Key invalid"

*   Verifica que `RESEND_API_KEY` sea correcto
*   Asegúrate de que el dominio esté verificado en Resend

### El worker no está ejecutando checks

*   Verifica los logs: `flyctl logs --app uptimepulse-worker`
*   Asegúrate de que Firebase esté inicializado correctamente
*   Verifica que haya monitores activos en la colección `pp_monitors`

## 📈 Escalado

Para escalar la aplicación:

```bash
# Aumentar máquinas
flyctl scale count 3 --app uptimepulse-main

# Cambiar región
flyctl regions set mia iad --app uptimepulse-main

# Cambiar recursos
flyctl scale vm shared-cpu-2x --app uptimepulse-main
```

## 🛡️ Seguridad

*   Todos los secrets se almacenan de forma segura en Fly.io
*   Las conexiones HTTPS se fuerzan automáticamente
*   CORS está configurado para dominios específicos
*   Rate limiting está habilitado en endpoints públicos

## 📝 Mantenimiento

### Backup de datos

Firebase realiza backups automáticos. Para exportar datos:

```bash
gcloud firestore export gs://tu-bucket/backup-$(date +%Y%m%d)
```

### Actualizar dependencias

```bash
npm update
npm audit fix
git commit -am "Update dependencies"
git push origin main
```

## 🚨 Alertas y Notificaciones

UptimePulse envía alertas a través de:

*   **Email**: Resend (para todos los usuarios)
*   **Telegram**: Bot de Telegram (planes Starter+)
*   **Slack**: Webhooks (planes Pro+)

Las alertas se envían cuando:
*   Un monitor cambia de estado (Up → Down)
*   Un certificado SSL está por vencer (7 días antes)
*   Se genera un reporte diario (8 AM PET)

## 📞 Soporte

Para reportar problemas o sugerencias, abre un issue en el repositorio.

---

**Última actualización**: 2024-01-15  
**Versión**: 1.0.0
