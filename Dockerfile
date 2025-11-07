# 1. Usa una imagen base oficial de Node.js (versión 20 estable y ligera)
FROM node:20-slim

# 2. Crea y establece el directorio de la aplicación
WORKDIR /app

# 3. Copia solo el archivo package.json
# (El package-lock.json se copiará si existe, pero no es obligatorio)
COPY package.json ./

# 4. Instala las dependencias
RUN npm install --silent

# 5. Copia el resto de los archivos (index.js, fly.toml, etc.)
COPY . .

# 6. Expone el puerto que usa tu aplicación (8080 en index.js)
EXPOSE 8080

# 7. Comando para iniciar la aplicación
CMD [ "npm", "start" ]
