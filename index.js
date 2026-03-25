import app from "./src/server.js";
import logger from "./src/utils/logger.js";

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {
  logger.info("SERVER", `Servidor iniciado en el puerto ${PORT}`);
});
