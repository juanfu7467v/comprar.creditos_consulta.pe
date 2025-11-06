# 1. Usa una imagen base oficial de Node.js (versión 20 estable y ligera)
FROM node:20-slim

# 2. Crea y establece el directorio de la aplicación
WORKDIR /app

# 3. Copia los archivos de configuración de dependencias
# Esto permite que Docker cachee la capa de npm install
COPY package.json package-lock.json ./

# 4. Instala las dependencias
RUN npm install

# 5. Copia el resto de los archivos (index.js, etc.)
COPY . .

# 6. Expone el puerto que usa tu aplicación (8080 en index.js)
EXPOSE 8080

# 7. Comando para iniciar la aplicación (debe coincidir con tu script "start" en package.json)
CMD [ "npm", "start" ]
