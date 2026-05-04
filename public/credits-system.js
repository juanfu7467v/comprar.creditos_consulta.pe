/**
 * Sistema de Créditos Mejorado para PeliPREX
 * Gestiona el consumo de créditos basado en la URL de reproducción
 * y la duración de visualización
 */

// Configuración de créditos por tipo de URL
const CREDITS_CONFIG = {
    GOOGLE_DRIVE: 5,      // Google Drive: 5 créditos
    FLYIO: 20,            // Fly.io: 20 créditos
    DEFAULT: 5            // Por defecto: 5 créditos
};

// Tiempo de vista previa gratuita (en segundos)
const PREVIEW_DURATION = 10 * 60; // 10 minutos

// Rastreador de reproducción
const playbackTracker = {
    currentMovie: null,
    startTime: null,
    playbackStarted: false,
    creditsDeducted: false,
    watchDuration: 0,
    player: null,
    interval: null,
    
    /**
     * Inicia el rastreamiento de reproducción
     */
    start(movie, player) {
        this.currentMovie = movie;
        this.player = player;
        this.startTime = Date.now();
        this.playbackStarted = true; // Asumimos que empieza al abrir el modal/iframe
        this.creditsDeducted = false;
        this.watchDuration = 0;
        
        console.log(`[CreditsSystem] Iniciando rastreo para: ${movie.titulo}`);
        
        // Iniciar intervalo para rastrear duración
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => this.updateWatchDuration(), 1000);
    },
    
    /**
     * Actualiza la duración de visualización
     */
    async updateWatchDuration() {
        if (this.playbackStarted) {
            this.watchDuration = Math.floor((Date.now() - this.startTime) / 1000);
            
            // Si ha pasado el tiempo de vista previa y no se han descontado créditos
            if (this.watchDuration >= PREVIEW_DURATION && !this.creditsDeducted) {
                await this.checkAndDeductCredits();
            }
        }
    },
    
    /**
     * Marca que la reproducción ha comenzado (para reproductores con eventos)
     */
    markPlaybackStarted() {
        this.playbackStarted = true;
        // No reiniciamos el startTime aquí para que los 10 min cuenten desde que se abrió
    },
    
    /**
     * Detiene el rastreamiento
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.playbackStarted = false;
    },
    
    /**
     * Obtiene el número de créditos a descontar basado en la URL
     */
    getCreditsToDeduct(url) {
        if (!url) return CREDITS_CONFIG.DEFAULT;
        
        if (url.includes('drive.google.com')) {
            return CREDITS_CONFIG.GOOGLE_DRIVE;
        } else if (url.includes('peliprex-31wrsa.fly.dev') || url.includes('fly.dev')) {
            return CREDITS_CONFIG.FLYIO;
        }
        
        return CREDITS_CONFIG.DEFAULT;
    },
    
    /**
     * Verifica créditos y descuenta si es necesario
     */
    async checkAndDeductCredits() {
        if (!this.currentMovie || this.creditsDeducted) return;
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) return;
            
            // Usar la colección 'usuarios' que es la que usa el repo
            const userRef = firebase.firestore().collection('usuarios').doc(user.uid);
            const userDoc = await userRef.get();
            
            if (!userDoc.exists) return;
            
            const userData = userDoc.data();
            const tipoPlan = userData.tipoPlan || 'creditos';
            
            // No descontar si el plan es ilimitado
            if (tipoPlan === 'ilimitado') {
                this.creditsDeducted = true;
                return;
            }
            
            const creditsToDeduct = this.getCreditsToDeduct(this.currentMovie.pelicula_url);
            const creditosActuales = parseInt(userData.creditos) || 0;
            
            // Verificar si el usuario tiene créditos suficientes
            if (creditosActuales < creditsToDeduct) {
                // Bloquear reproductor y mostrar modal
                this.blockPlayerAndShowModal(creditsToDeduct);
                return;
            }
            
            // Descontar créditos
            await userRef.update({
                creditos: firebase.firestore.FieldValue.increment(-creditsToDeduct)
            });
            
            this.creditsDeducted = true;
            console.log(`✓ ${creditsToDeduct} créditos descontados por "${this.currentMovie.titulo}"`);
            
            // Actualizar UI si existe función global
            if (typeof updateProfileUI === 'function') {
                const updatedDoc = await userRef.get();
                updateProfileUI(updatedDoc.data());
            }
        } catch (error) {
            console.error('Error al gestionar créditos:', error);
        }
    },

    /**
     * Bloquea el reproductor y muestra el modal de créditos insuficientes
     */
    blockPlayerAndShowModal(creditsNeeded) {
        this.stop();
        
        // Limpiar el reproductor (iframe o video)
        const modalPlayer = document.getElementById('modal-player-container') || document.querySelector('.modal-player');
        if (modalPlayer) {
            modalPlayer.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; background:#000; color:#fff; padding:20px; text-align:center;">
                    <i class="fa-solid fa-lock" style="font-size:48px; color:var(--accent); margin-bottom:15px;"></i>
                    <h3 style="margin:0 0 10px 0;">Contenido Bloqueado</h3>
                    <p style="font-size:14px; color:var(--muted); max-width:300px;">Has alcanzado el límite de vista previa gratuita.</p>
                </div>
            `;
        }
        
        showPreviewExpiredModal(creditsNeeded, this.currentMovie);
    }
};

/**
 * Muestra un modal cuando la vista previa de 10 minutos ha expirado
 */
function showPreviewExpiredModal(creditsNeeded, movie) {
    // Eliminar modal anterior si existe
    const oldModal = document.getElementById('preview-expired-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'preview-expired-modal';
    modal.style.zIndex = '9999';
    modal.innerHTML = `
        <div class="modal-panel" style="height:auto;max-height:90vh;max-width:380px;border-radius:20px;overflow:hidden;background:var(--surface);align-self:center;padding:0;box-shadow:0 10px 40px rgba(0,0,0,0.9);transition:transform 0.3s ease-out;transform:scale(1);">
            <div style="height:110px;background:linear-gradient(135deg,var(--accent),#b1060f);display:flex;justify-content:center;align-items:center;position:relative;">
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:72px;height:72px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center;font-size:32px;color:var(--accent);border:4px solid var(--bg);box-shadow:0 4px 15px rgba(0,0,0,0.5);">
                    <i class="fa-solid fa-gem"></i>
                </div>
            </div>
            <div style="padding:52px 22px 28px;text-align:center;background:var(--surface);">
                <h4 style="margin:0 0 10px 0;font-size:20px;font-weight:800;color:var(--text);">Créditos Insuficientes</h4>
                <p style="color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:16px;">
                    Para seguir viendo <strong style="color:var(--text);">"${movie.titulo}"</strong>, necesitas créditos o un plan ilimitado.
                </p>
                <p style="color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:28px;">
                    Revisa nuestras promociones disponibles.
                </p>
                <button onclick="window.location.href='planes.html'" style="display:block;width:100%;padding:15px;background:var(--accent);color:#fff;font-weight:800;font-size:16px;border:none;border-radius:12px;cursor:pointer;transition:opacity 0.2s;box-shadow:0 4px 14px rgba(229,9,20,0.4);margin-bottom:12px;letter-spacing:0.3px;">
                    <i class="fa-solid fa-cart-shopping" style="margin-right:6px;"></i> Ver Planes
                </button>
                <button onclick="document.getElementById('preview-expired-modal').remove(); if(typeof closeMovieModalAndRefresh === 'function') closeMovieModalAndRefresh();" style="display:block;width:100%;padding:12px;background:var(--card);color:var(--muted);font-weight:600;font-size:14px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;transition:background 0.2s;">
                    Volver
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

/**
 * Inicializa el sistema de créditos para un reproductor
 */
function initializeCreditsSystem(movie, player) {
    playbackTracker.start(movie, player);
    
    // Si hay un objeto de reproductor (como Plyr), podemos escuchar eventos
    if (player && typeof player.on === 'function') {
        player.on('play', () => playbackTracker.markPlaybackStarted());
    }
}

/**
 * Limpia el rastreamiento al cerrar el reproductor
 */
function cleanupCreditsSystem() {
    playbackTracker.stop();
}
