/**
 * RecoveryOS.js
 * Archivo de configuración centralizado para el sistema Revenue Recovery OS.
 * Maneja URLs de backend y configuraciones generales de manera segura.
 */

const RecoveryOSConfig = {
    /**
     * URL base del backend.
     * Esta URL se utiliza para todas las peticiones a la API del sistema.
     */
    BACKEND_URL: "https://revenue-recovery-os.fly.dev/",

    /**
     * Configuraciones generales del sistema.
     */
    SETTINGS: {
        ENVIRONMENT: "production",
        VERSION: "1.0.0",
        SYSTEM_NAME: "Revenue Recovery OS",
        // Clave para verificar si el usuario ya completó el onboarding en localStorage
        ONBOARDING_COMPLETED_KEY: "recovery_os_onboarding_completed"
    },

    /**
     * Obtiene la URL completa para un endpoint específico.
     * @param {string} endpoint - El endpoint de la API (ej: "api/v1/organization/vault/api-key").
     * @returns {string} - La URL completa.
     */
    getApiUrl: function(endpoint) {
        const base = this.BACKEND_URL.endsWith('/') ? this.BACKEND_URL : this.BACKEND_URL + '/';
        const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        return base + path;
    },

    /**
     * Verifica si el onboarding ha sido completado.
     * @returns {boolean} - True si se completó, false en caso contrario.
     */
    isOnboardingCompleted: function() {
        return localStorage.getItem(this.SETTINGS.ONBOARDING_COMPLETED_KEY) === 'true';
    },

    /**
     * Marca el onboarding como completado.
     */
    completeOnboarding: function() {
        localStorage.setItem(this.SETTINGS.ONBOARDING_COMPLETED_KEY, 'true');
    }
};

// Hacer que la configuración esté disponible globalmente
window.RecoveryOSConfig = RecoveryOSConfig;

// Exportar para entornos de módulos si es necesario
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RecoveryOSConfig;
}
