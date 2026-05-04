/**
 * Sistema de Créditos Mejorado para PeliPREX
 * Gestiona el consumo de créditos basado en la URL de reproducción
 * y la duración de visualización real.
 */

// Configuración de créditos por tipo de URL
const GREEN_GRADIENT = 'linear-gradient(45deg, #1abc9c, #10ac84)';
const CREDITS_CONFIG = {
    GOOGLE_DRIVE: 5,      // Google Drive: 5 créditos
    FLYIO: 20,            // Fly.io: 20 créditos
    DEFAULT: 5            // Por defecto: 5 créditos
};

// Tiempo de vista previa gratuita (en segundos)
const PREVIEW_DURATION = 10 * 60; // 10 minutos reales

// Rastreador de reproducción
const playbackTracker = {
    currentMovie: null,
    startTime: null,
    playbackStarted: false,
    creditsDeducted: false,
    watchDuration: 0,
    player: null,
    interval: null,
    lastTick: null,
    
    /**
     * Inicia el rastreamiento de reproducción
     */
    start(movie, player) {
        this.currentMovie = movie;
        this.player = player;
        this.startTime = Date.now();
        this.lastTick = Date.now();
        this.playbackStarted = true; 
        this.creditsDeducted = false;
        this.watchDuration = 0;
        
        console.log(`[CreditsSystem] Iniciando rastreo real para: ${movie.titulo}`);
        
        // Iniciar intervalo para rastrear duración real
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => this.updateWatchDuration(), 1000);
    },
    
    /**
     * Actualiza la duración de visualización validando actividad real
     */
    async updateWatchDuration() {
        if (!this.playbackStarted || this.creditsDeducted) return;

        const now = Date.now();
        const delta = (now - this.lastTick) / 1000;
        this.lastTick = now;

        // Validar que la pestaña sea visible y el reproductor esté activo
        const isVisible = document.visibilityState === 'visible';
        
        // Si es un reproductor de video (Plyr/HTML5), verificar que no esté pausado
        let isPlaying = true;
        if (this.player) {
            if (typeof this.player.paused !== 'undefined') {
                isPlaying = !this.player.paused;
            } else if (this.player.playing === false) {
                isPlaying = false;
            }
        }

        // Solo sumar tiempo si se está viendo realmente
        if (isVisible && isPlaying) {
            this.watchDuration += delta;
            
            // Log cada minuto para depuración
            if (Math.floor(this.watchDuration) % 60 === 0 && Math.floor(this.watchDuration) > 0) {
                console.log(`[CreditsSystem] Tiempo de visualización real: ${Math.floor(this.watchDuration / 60)} min`);
            }

            // Si ha pasado el tiempo de vista previa
            if (this.watchDuration >= PREVIEW_DURATION) {
                await this.checkAndDeductCredits();
            }
        }
    },
    
    /**
     * Marca que la reproducción ha comenzado
     */
    markPlaybackStarted() {
        this.playbackStarted = true;
        this.lastTick = Date.now();
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
        
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes('drive.google.com')) {
            return CREDITS_CONFIG.GOOGLE_DRIVE;
        } else if (lowerUrl.includes('fly.dev') || lowerUrl.includes('fly.io')) {
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
            if (!user) {
                this.blockPlayerAndShowModal(0);
                return;
            }
            
            const userRef = firebase.firestore().collection('usuarios').doc(user.uid);
            
            // Usar una transacción para asegurar consistencia real
            await firebase.firestore().runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists) throw "Usuario no existe";

                const userData = userDoc.data();
                const tipoPlan = userData.tipoPlan || 'creditos';
                
                // 1. Validar Plan Ilimitado
                if (tipoPlan === 'ilimitado') {
                    console.log("[CreditsSystem] Plan ilimitado detectado. Sin cargo.");
                    this.creditsDeducted = true;
                    return;
                }

                // 2. Calcular costo
                const creditsToDeduct = this.getCreditsToDeduct(this.currentMovie.pelicula_url);
                const creditosActuales = parseInt(userData.creditos) || 0;

                // 3. Verificar saldo
                if (creditosActuales < creditsToDeduct) {
                    throw { code: 'INSUFFICIENT_CREDITS', needed: creditsToDeduct };
                }

                // 4. Descontar realmente
                transaction.update(userRef, {
                    creditos: firebase.firestore.FieldValue.increment(-creditsToDeduct)
                });

                this.creditsDeducted = true;
                console.log(`[CreditsSystem] Éxito: ${creditsToDeduct} créditos descontados.`);
            });

            // Actualizar UI si el descuento fue exitoso
            if (this.creditsDeducted && typeof updateProfileUI === 'function') {
                const updatedDoc = await userRef.get();
                updateProfileUI(updatedDoc.data());
            }

        } catch (error) {
            if (error.code === 'INSUFFICIENT_CREDITS') {
                this.blockPlayerAndShowModal(error.needed);
            } else {
                console.error('[CreditsSystem] Error crítico:', error);
                // En caso de error de red o similar, pausamos por seguridad
                if (this.player && typeof this.player.pause === 'function') this.player.pause();
            }
        }
    },

    /**
     * Bloquea el reproductor y muestra el modal de créditos insuficientes
     */
    blockPlayerAndShowModal(creditsNeeded) {
        this.stop();
        
        // 1. Pausar y remover el reproductor físicamente para evitar bypass
        const modalPlayer = document.getElementById('modal-player-container') || document.querySelector('.modal-player');
        if (modalPlayer) {
            // Detener cualquier video/iframe existente
            const existingIframe = modalPlayer.querySelector('iframe');
            if (existingIframe) existingIframe.src = 'about:blank';
            
            if (this.player && typeof this.player.destroy === 'function') {
                this.player.destroy();
            }

            // Insertar bloqueo visual profesional
            modalPlayer.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; width:100%; background:#000; color:#fff; padding:20px; text-align:center; position:absolute; top:0; left:0; z-index:100;">
                    <div style="width:80px; height:80px; border-radius:50%; background:rgba(229,9,20,0.1); display:flex; align-items:center; justify-content:center; margin-bottom:20px; border:2px solid var(--accent);">
                        <i class="fa-solid fa-lock" style="font-size:32px; color:var(--accent);"></i>
                    </div>
                    <h3 style="margin:0 0 10px 0; font-size:22px; font-weight:800;">Contenido Bloqueado</h3>
                    <p style="font-size:15px; color:var(--muted); max-width:320px; line-height:1.5;">
                        Has disfrutado de los 10 minutos de vista previa gratuita. Para continuar viendo esta película, necesitas créditos o un plan ilimitado.
                    </p>
                    <button onclick="window.location.href='planes.html'" style="margin-top:20px; padding:12px 25px; background:var(--accent); color:#fff; border:none; border-radius:30px; font-weight:700; cursor:pointer; box-shadow:0 5px 15px rgba(229,9,20,0.3);">
                        Obtener Créditos
                    </button>
                </div>
            `;
        }
        
        // 2. Mostrar el modal de invitación a compra
        showPreviewExpiredModal(creditsNeeded, this.currentMovie);
    }
};

/**
 * Muestra un modal cuando la vista previa de 10 minutos ha expirado
 */
function showPreviewExpiredModal(creditsNeeded, movie) {
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
                    Para seguir viendo <strong style="color:var(--text);">"${movie ? movie.titulo : 'esta película'}"</strong>, necesitas créditos o un plan ilimitado.
                </p>
                <p style="color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:28px;">
                    Tu saldo actual no es suficiente para cubrir el costo de este servidor.
                </p>
                <button onclick="window.location.href='planes.html'" style="display:block;width:100%;padding:15px;background:var(--accent);color:#fff;font-weight:800;font-size:16px;border:none;border-radius:12px;cursor:pointer;transition:opacity 0.2s;box-shadow:0 4px 14px rgba(229,9,20,0.4);margin-bottom:12px;letter-spacing:0.3px;">
                    <i class="fa-solid fa-cart-shopping" style="margin-right:6px;"></i> Ver Planes
                </button>
                <button onclick="document.getElementById('preview-expired-modal').remove(); if(typeof closeMovieModalAndRefresh === 'function') closeMovieModalAndRefresh();" style="display:block;width:100%;padding:12px;background:var(--card);color:var(--muted);font-weight:600;font-size:14px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;transition:background 0.2s;">
                    Volver al Catálogo
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
    if (!movie) return;
    playbackTracker.start(movie, player);
    
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
