
/**
 * player-enhancements.js
 * Mejoras para el reproductor de Video.js en PeliPREX
 */

(function() {
    // Función para inicializar o actualizar el reproductor Video.js
    window.setupVideoJSPlayer = function(containerId, movieUrl, movieTitle) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Limpiar contenedor
        container.innerHTML = '';

        // Si es una URL de YouTube o Drive, mantenemos el iframe original por compatibilidad
        // ya que Video.js requiere plugins específicos para estos (videojs-youtube, etc.)
        // y el usuario pidió NO modificar lo que ya funciona.
        if (movieUrl.includes('youtube.com') || movieUrl.includes('drive.google.com')) {
            const iframe = document.createElement('iframe');
            iframe.src = movieUrl;
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
            iframe.allowFullscreen = true;
            iframe.frameBorder = 0;
            iframe.style.position = 'absolute';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            container.appendChild(iframe);
            
            // Re-agregar los controles de overlay que estaban en el HTML original
            addOriginalControls(container);
            return;
        }

        // Para URLs de video directo (mp4, m3u8, etc.), usamos Video.js con mejoras
        const videoElement = document.createElement('video');
        videoElement.id = 'peliprex-vjs-player';
        videoElement.className = 'video-js vjs-default-skin vjs-big-play-centered vjs-fluid';
        videoElement.controls = true;
        videoElement.preload = 'auto';
        
        const source = document.createElement('source');
        source.src = movieUrl;
        // Determinar tipo si es posible
        if (movieUrl.includes('.m3u8')) source.type = 'application/x-mpegURL';
        else source.type = 'video/mp4';
        
        videoElement.appendChild(source);
        container.appendChild(videoElement);

        // Inicializar Video.js
        const player = videojs('peliprex-vjs-player', {
            fluid: true,
            responsive: true,
            playbackRates: [0.5, 1, 1.5, 2],
            controlBar: {
                children: [
                    'playToggle',
                    'volumePanel',
                    'currentTimeDisplay',
                    'timeDivider',
                    'durationDisplay',
                    'progressControl',
                    'liveDisplay',
                    'remainingTimeDisplay',
                    'playbackRateMenuButton',
                    'subsCapsButton',
                    'audioTrackButton',
                    'fullscreenToggle',
                ]
            }
        });

        // Agregar botón de bloqueo personalizado
        const Button = videojs.getComponent('Button');
        const LockButton = videojs.extend(Button, {
            constructor: function() {
                Button.apply(this, arguments);
                this.addClass('vjs-lock-control');
                this.controlText('Bloquear Pantalla');
            },
            handleClick: function() {
                toggleLock(player);
            }
        });
        videojs.registerComponent('LockButton', LockButton);
        player.getChild('controlBar').addChild('LockButton', {}, 10);

        // Re-agregar los controles de overlay originales (Cerrar, Favoritos)
        addOriginalControls(container);

        // Función para bloquear/desbloquear
        function toggleLock(p) {
            const isLocked = p.hasClass('vjs-locked-state');
            if (!isLocked) {
                p.addClass('vjs-locked-state');
                
                // Crear overlay de desbloqueo
                const unlockOverlay = document.createElement('div');
                unlockOverlay.className = 'vjs-unlock-overlay';
                unlockOverlay.id = 'vjs-unlock-btn';
                unlockOverlay.innerHTML = '<i class="fa-solid fa-lock"></i>';
                unlockOverlay.onclick = () => toggleLock(p);
                p.el().appendChild(unlockOverlay);
                
                // Bloquear toques accidentales en el video
                p.el().style.pointerEvents = 'none';
                unlockOverlay.style.pointerEvents = 'auto';
            } else {
                p.removeClass('vjs-locked-state');
                const btn = document.getElementById('vjs-unlock-btn');
                if (btn) btn.remove();
                p.el().style.pointerEvents = 'auto';
            }
        }
    };

    function addOriginalControls(container) {
        const overlay = document.createElement('div');
        overlay.className = 'player-controls-overlay';
        overlay.innerHTML = `
            <button class="icon-btn player-close" id="player-close-btn-in-iframe" title="Cerrar/Atrás"><i class="fa-solid fa-arrow-left"></i></button> 
            <button class="icon-btn player-favorite" id="player-favorite-btn" title="Añadir a Favoritos"><i class="fa-regular fa-heart"></i></button>
        `;
        container.appendChild(overlay);
        
        // Re-vincular eventos
        const closeBtn = document.getElementById('player-close-btn-in-iframe');
        if (closeBtn) {
            closeBtn.onclick = window.closeMovieModalAndRefresh;
        }
        
        const favBtn = document.getElementById('player-favorite-btn');
        if (favBtn && window.currentMovie) {
            favBtn.onclick = () => window.addMovieToFavorites(window.currentMovie);
        }
    }
})();
