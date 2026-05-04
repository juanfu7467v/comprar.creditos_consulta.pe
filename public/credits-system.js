/**
 * Sistema de Créditos Mejorado para PeliPREX
 * Gestiona el consumo de créditos basado en la URL de reproducción
 * y la duración de visualización
 */

// Configuración de créditos por tipo de URL
const CREDITS_CONFIG = {
    GOOGLE_DRIVE: 5,      // Google Drive: 5 créditos
    FLYIO: 20,            // Fly.io: 20 créditos
    YOUTUBE: 3,           // YouTube: 3 créditos (por defecto)
    DEFAULT: 3            // Por defecto: 3 créditos
};

// Tiempo mínimo de visualización para descontar créditos (en segundos)
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
        this.playbackStarted = false;
        this.creditsDeducted = false;
        this.watchDuration = 0;
        
        // Iniciar intervalo para rastrear duración
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => this.updateWatchDuration(), 1000);
    },
    
    /**
     * Actualiza la duración de visualización
     */
    updateWatchDuration() {
        if (this.playbackStarted && this.player) {
            this.watchDuration = Math.floor((Date.now() - this.startTime) / 1000);
            
            // Si ha pasado el tiempo de vista previa y no se han descontado créditos
            if (this.watchDuration >= PREVIEW_DURATION && !this.creditsDeducted) {
                this.deductCredits();
            }
        }
    },
    
    /**
     * Marca que la reproducción ha comenzado
     */
    markPlaybackStarted() {
        this.playbackStarted = true;
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
        } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
            return CREDITS_CONFIG.YOUTUBE;
        }
        
        return CREDITS_CONFIG.DEFAULT;
    },
    
    /**
     * Descuenta los créditos del usuario
     */
    async deductCredits() {
        if (!this.currentMovie || this.creditsDeducted) return;
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) return;
            
            const userRef = firebase.firestore().collection('users').doc(user.uid);
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
            
            // Verificar que haya suficientes créditos
            if (creditosActuales < creditsToDeduct) {
                // Mostrar modal de créditos insuficientes
                showPreviewExpiredModal(creditsToDeduct, this.currentMovie);
                return;
            }
            
            // Descontar créditos
            await userRef.update({
                creditos: firebase.firestore.FieldValue.increment(-creditsToDeduct),
                ultimaVisualizacion: firebase.firestore.FieldValue.serverTimestamp(),
                peliculasVistas: firebase.firestore.FieldValue.arrayUnion({
                    titulo: this.currentMovie.titulo,
                    url: this.currentMovie.pelicula_url,
                    creditosGastados: creditsToDeduct,
                    fecha: new Date().toISOString()
                })
            });
            
            this.creditsDeducted = true;
            
            // Actualizar UI de créditos si existe
            updateCreditsDisplay();
            
            console.log(`✓ ${creditsToDeduct} créditos descontados por "${this.currentMovie.titulo}"`);
        } catch (error) {
            console.error('Error al descontar créditos:', error);
        }
    }
};

/**
 * Detecta si una URL es de Fly.io
 */
function isFlyioUrl(url) {
    return url && (url.includes('fly.dev') || url.includes('peliprex-31wrsa.fly.dev'));
}

/**
 * Detecta si una URL es de Google Drive
 */
function isGoogleDriveUrl(url) {
    return url && url.includes('drive.google.com');
}

/**
 * Muestra un modal cuando la vista previa de 10 minutos ha expirado
 */
function showPreviewExpiredModal(creditsNeeded, movie) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'preview-expired-modal';
    modal.innerHTML = `
        <div class="modal-panel" style="height:auto;max-height:90vh;max-width:380px;border-radius:20px;overflow:hidden;background:var(--surface);align-self:center;padding:0;box-shadow:0 10px 40px rgba(0,0,0,0.9);transition:transform 0.3s ease-out;transform:scale(1);">
            <div style="height:110px;background:linear-gradient(135deg,#1abc9c,#0d9b8a);display:flex;justify-content:center;align-items:center;position:relative;">
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:72px;height:72px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center;font-size:32px;color:#1abc9c;border:4px solid var(--bg);box-shadow:0 4px 15px rgba(0,0,0,0.5);">
                    <i class="fa-solid fa-play"></i>
                </div>
            </div>
            <div style="padding:52px 22px 28px;text-align:center;background:var(--surface);">
                <h4 style="margin:0 0 10px 0;font-size:20px;font-weight:800;color:var(--text);">Vista previa finalizada</h4>
                <p style="color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:16px;">
                    Disfrutaste <strong style="color:var(--text);">10 minutos gratis</strong> de "${movie.titulo}".
                </p>
                <p style="color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:28px;">
                    Para seguir viendo, necesitas <strong style="color:var(--text);">${creditsNeeded} créditos</strong>. 
                    <br>Revisa nuestras promociones disponibles.
                </p>
                <button onclick="window.location.href='planes.html'" style="display:block;width:100%;padding:15px;background:linear-gradient(135deg,#1abc9c,#0d9b8a);color:#000;font-weight:800;font-size:16px;border:none;border-radius:12px;cursor:pointer;transition:opacity 0.2s;box-shadow:0 4px 14px rgba(26,188,156,0.45);margin-bottom:12px;letter-spacing:0.3px;">
                    <i class="fa-solid fa-gem" style="margin-right:6px;"></i> Obtener créditos
                </button>
                <button onclick="this.closest('.modal').remove(); playbackTracker.stop();" style="display:block;width:100%;padding:12px;background:var(--card);color:var(--muted);font-weight:600;font-size:14px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;transition:background 0.2s;">
                    Volver
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Cerrar al hacer clic fuera
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
            playbackTracker.stop();
        }
    });
}

/**
 * Actualiza la visualización de créditos en la UI
 */
async function updateCreditsDisplay() {
    try {
        const user = firebase.auth().currentUser;
        if (!user) return;
        
        const userDoc = await firebase.firestore().collection('users').doc(user.uid).get();
        if (!userDoc.exists) return;
        
        const userData = userDoc.data();
        const creditos = parseInt(userData.creditos) || 0;
        
        // Actualizar cualquier elemento que muestre créditos
        const creditElements = document.querySelectorAll('[data-credits-display]');
        creditElements.forEach(el => {
            el.textContent = creditos;
        });
    } catch (error) {
        console.error('Error al actualizar créditos:', error);
    }
}

/**
 * Inicializa el sistema de créditos para un reproductor
 */
function initializeCreditsSystem(movie, player) {
    // Iniciar rastreamiento
    playbackTracker.start(movie, player);
    
    // Detectar cuando comienza la reproducción
    if (player && player.on) {
        player.on('play', () => {
            playbackTracker.markPlaybackStarted();
        });
        
        player.on('pause', () => {
            playbackTracker.stop();
        });
        
        player.on('ended', () => {
            playbackTracker.stop();
        });
    }
}

/**
 * Limpia el rastreamiento al cerrar el reproductor
 */
function cleanupCreditsSystem() {
    playbackTracker.stop();
}
