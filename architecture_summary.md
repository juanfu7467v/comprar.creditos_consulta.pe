# Resumen de Arquitectura y Requisitos para UptimePulse

Este documento consolida la información del archivo de requisitos del usuario (`pasted_content.txt`) y el `README.md` existente en el módulo `pingpulse` para establecer una comprensión clara de la arquitectura actual y las mejoras necesarias.

## 1. Base del Desarrollo y Consideraciones Generales

*   **Base Existente**: El proyecto ya utiliza Firebase y Mercado Pago. El nuevo sistema `UptimePulse` debe reutilizar estas bases.
*   **Modularidad**: Es crucial crear nuevas colecciones independientes en Firebase y mantener toda la lógica del nuevo sistema separada para no mezclarla con las colecciones existentes de usuarios, créditos o planes. No se debe modificar el sistema actual ni romper funcionalidades existentes. Todo lo nuevo debe ser modular y separado.
*   **Funcionamiento Real**: El sistema debe ser 100% funcional y real, no simulado.
*   **Diseño**: Todas las interfaces deben tener un diseño intuitivo, fluido y moderno (UX/UI profesional). La navegación debe ser clara y rápida.

## 2. Objetivo del Proyecto (Micro-SaaS "UptimePulse")

Construir un Micro-SaaS de monitoreo de APIs y páginas web, enfocado en agencias y startups, como alternativa a herramientas como BetterStack y StatusPage. El sistema debe:

*   Monitorear endpoints constantemente.
*   Detectar caídas del servicio.
*   Notificar automáticamente al usuario (Email / Telegram / Slack).
*   Generar una página de estado pública con historial de uptime.

## 3. Stack Técnico (Confirmado y Propuesto)

| Componente       | Descripción                                                                 | Estado        |
| :--------------- | :-------------------------------------------------------------------------- | :------------ |
| **Backend**      | Node.js (ya en uso en el proyecto principal)                                | Existente     |
| **Base de Datos**| Firebase Firestore (ya en uso en el proyecto principal)                     | Existente     |
| **Infraestructura**| Fly.io                                                                      | Propuesto     |
| **CI/CD**        | GitHub Actions                                                              | Propuesto     |
| **Notificaciones**| Resend (email), Webhooks (Slack / Telegram)                               | Existente/Propuesto |
| **Pagos**        | Mercado Pago (ya integrado en el proyecto principal)                        | Existente     |
| **Autenticación**| Sistema actual (no modificar)                                               | Existente     |

## 4. MVP (Fase 1 – 30 días) - Funcionalidades Requeridas

El `pingpulse/README.md` ya lista estas funcionalidades como 
implementadas o en proceso. Esto es una excelente base.

*   **Worker de monitoreo**:
    *   Proceso en segundo plano.
    *   Ejecutar checks cada 1 a 5 minutos.
*   **Dashboard de usuario**:
    *   Agregar / editar URLs.
    *   Configurar frecuencia.
    *   Ver estado actual.
*   **Status Page pública**:
    *   Página simple y rápida.
    *   Mostrar uptime de los últimos 30 días.
*   **Sistema de alertas**:
    *   Enviar notificaciones cuando el estado cambie (Up → Down).
*   **Suscripciones**:
    *   Prueba gratuita de 24 horas.
    *   Luego planes de pago.

## 5. Modelo de Datos (Firebase Firestore)

Se crearán nuevas colecciones en Firebase, separadas del sistema principal:

*   `pp_monitors`: Contiene la configuración de cada monitor (URL, frecuencia, tipo, estado, etc.).
*   `pp_logs`: Almacena el historial de checks, optimizado para guardar solo cambios importantes (Up → Down) y un resumen diario.
*   `pp_incidents`: Registra los incidentes de caída del servicio.
*   `pp_subscriptions`: Gestiona las suscripciones de los usuarios a los planes de `UptimePulse`.

## 6. Funcionalidades Clave (Valor Diferencial)

*   **Reporte semanal automático**: Envío de correo tipo “Tu sistema estuvo 99.9% activo esta semana”. Genera valor incluso sin fallos.
*   **Badge de uptime**: Creación de un badge tipo “escudo” (como GitHub) que el usuario puede insertar en su web, generando marketing automático.
*   **Monitoreo SSL**: Detección de vencimiento de certificados y alerta 7 días antes.
*   **Bot de Telegram**: Permite al usuario recibir alertas críticas en Telegram.

## 7. Modelo de Acceso y Planes Sugeridos

*   **Prueba gratuita**: 24 horas.
*   **Planes de suscripción**:

| Plan        | Precio    | Endpoints | Frecuencia  | Notificaciones           | Beneficio         |
| :---------- | :-------- | :-------- | :---------- | :----------------------- | :---------------- |
| **Starter** | $9/mes    | 3–5       | Cada 5 min  | Email + Telegram         | Freelancers       |
| **Pro**     | $24/mes   | 20        | Cada 1 min  | Email + Telegram + Slack | Startups          |
| **Business**| $49/mes   | 75        | Cada 30 seg | Todo + Webhooks          | Reportes + SSL    |
| **Agency**  | $99/mes   | 200       | Cada 30 seg | Prioritarias             | Marca blanca      |

## 8. URL del Panel

El panel de control debe cambiar su acceso de `https://masitaprex.com/pingpulse-dashboard.html` a `https://www.masitaprex.com/UptimePulse` (sin `.html`), optimizado para mejor presencia en Google.

## 9. Consideraciones Adicionales

*   No realizar ningún otro cambio adicional fuera de lo especificado.
*   El dashboard debe ser intuitivo y fácil de usar, integrándose correctamente con secciones como Planes, Estadísticas y Configuración.

Este resumen servirá como guía para la implementación, asegurando que todas las mejoras se realicen de acuerdo con los requisitos y la arquitectura existente.
