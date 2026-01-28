import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generateInvoicePDF(data) {
    const { 
        orderId, 
        date, 
        email, 
        amount, 
        credits, 
        description, 
        type = 'boleta',
        rucCliente = '', 
        razonSocialCliente = '' 
    } = data;
    
    return new Promise((resolve, reject) => {
        try {
            // Validaciones básicas
            if (!orderId) throw new Error('orderId es requerido');
            if (!amount) throw new Error('amount es requerido');
            if (!email) throw new Error('email es requerido');
            
            if (type === 'factura' && (!rucCliente || !razonSocialCliente)) {
                throw new Error('RUC y Razón Social son requeridos para factura');
            }

            // Configuración del Documento
            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4',
                info: {
                    Title: `${type.toUpperCase()} - Consulta PE`,
                    Author: 'CUBAS PEREZ JOSE RENE',
                    Subject: 'Comprobante de Infraestructura',
                    Creator: 'Consulta PE System'
                }
            });
            
            const fileName = `${type}_${orderId}_${Date.now()}.pdf`;
            const publicDir = path.join(__dirname, 'public', 'invoices');
            
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir, { recursive: true });
            }
            
            const filePath = path.join(publicDir, fileName);
            const stream = fs.createWriteStream(filePath);
            
            doc.pipe(stream);

            // ==========================================
            // COLORES Y FUENTES (Estilo de la Imagen)
            // ==========================================
            const colors = {
                black: '#000000',
                darkGray: '#333333',
                lightGray: '#f2f2f2', // El gris suave de las cajas
                borderGray: '#e0e0e0'
            };

            // Fuentes: Usamos Courier para los títulos (estilo máquina de escribir de la imagen)
            // y Helvetica para los datos legibles.
            const fontMono = 'Courier-Bold';
            const fontBody = 'Helvetica';
            const fontBodyBold = 'Helvetica-Bold';

            // ==========================================
            // 1. HEADER (Lado Izquierdo)
            // ==========================================
            const startY = 60;
            
            doc.font(fontMono).fontSize(28).fillColor(colors.black)
               .text('CONSULTA PE', 50, startY);

            doc.font(fontBody).fontSize(10).fillColor(colors.darkGray)
               .text(`N°: ${orderId}`, 50, startY + 35)
               .text(date || new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' }), 50, startY + 50);

            // ==========================================
            // 2. CAJA SUPERIOR DERECHA (Infraestructura)
            // ==========================================
            // Dibuja el rectángulo gris claro
            doc.rect(380, 50, 180, 60).fill(colors.lightGray);

            // Texto dentro de la caja
            doc.fillColor(colors.black);
            doc.font(fontMono).fontSize(12)
               .text('INFRAESTRUCTURA', 380, 65, { width: 180, align: 'center' });
            
            doc.font(fontBody).fontSize(10)
               .text('Tecnológica y de Datos', 380, 82, { width: 180, align: 'center' });


            // ==========================================
            // 3. DATOS DEL CLIENTE
            // ==========================================
            const clientY = 160;

            doc.font(fontMono).fontSize(14).fillColor(colors.black)
               .text('Datos del cliente:', 50, clientY);

            doc.font(fontBody).fontSize(10).fillColor(colors.darkGray).moveDown(0.5);

            if (type === 'factura') {
                doc.text(razonSocialCliente, 50);
                doc.text(`RUC: ${rucCliente}`);
                doc.text(email);
            } else {
                doc.text(email); // Si es boleta y no hay nombre, usamos el email como id
                doc.text('Cliente Final / Usuario App');
            }

            // ==========================================
            // 4. TABLA DE DETALLES (Estilo Imagen)
            // ==========================================
            const tableY = 250;

            // Encabezado GRIS de la tabla
            doc.rect(50, tableY, 495, 30).fill(colors.lightGray);

            // Títulos de columnas (alineados como la imagen)
            doc.fillColor(colors.black).font(fontMono).fontSize(11);
            doc.text('Descripción', 70, tableY + 10);
            doc.text('Tipo', 300, tableY + 10);      // En lugar de "Materiales"
            doc.text('Total', 480, tableY + 10);

            // Fila de datos (Línea blanca de fondo, texto negro)
            const rowY = tableY + 40;

            doc.font(fontBody).fontSize(10).fillColor(colors.darkGray);
            
            // Descripción larga
            doc.text('Servicio de Acceso a Infraestructura Digital', 70, rowY);
            doc.fontSize(8).fillColor('#666666')
               .text('(Intermediación de datos públicos)', 70, rowY + 12);
            
            // Tipo (Créditos)
            doc.fontSize(10).fillColor(colors.darkGray)
               .text(credits ? `${credits} Créditos` : 'Acceso API', 300, rowY);

            // Total Fila
            doc.text(`S/ ${parseFloat(amount).toFixed(2)}`, 480, rowY);

            // Segunda fila (opcional, para rellenar como la imagen o poner info extra)
            doc.text('Mantenimiento y Soporte', 70, rowY + 30);
            doc.text('Incluido', 300, rowY + 30);
            doc.text('S/ 0.00', 480, rowY + 30);

            // ==========================================
            // 5. TOTALES Y RECTÁNGULO FINAL
            // ==========================================
            const totalsY = rowY + 60;

            // Texto pequeño de impuesto (arriba del total)
            doc.font(fontBodyBold).fontSize(10).fillColor(colors.black)
               .text('Impuesto (IGV incluido):', 350, totalsY, { width: 100, align: 'right' });
            
            doc.font(fontBody).fontSize(10)
               .text('S/ 0.00', 480, totalsY); // Ajustar si desglosas IGV

            // CAJA GRIS DE TOTAL (Como la imagen)
            const totalBoxY = totalsY + 20;
            doc.rect(340, totalBoxY, 205, 40).fill(colors.lightGray);

            doc.fillColor(colors.black).font(fontMono).fontSize(14)
               .text('TOTAL:', 360, totalBoxY + 12);

            doc.font(fontBodyBold).fontSize(16)
               .text(`S/ ${parseFloat(amount).toFixed(2)}`, 450, totalBoxY + 10, { align: 'right', width: 80 });

            // ==========================================
            // 6. PROTECCIÓN LEGAL (Insertada sutilmente)
            // ==========================================
            // En la imagen hay una sección "Tiempo estimado". Ahí pondremos la cláusula legal.
            const legalY = totalBoxY + 60;

            doc.font(fontMono).fontSize(10).fillColor(colors.black)
               .text('Condiciones del Servicio:', 50, legalY);

            doc.font(fontBody).fontSize(8).fillColor('#555555')
               .text('1. El usuario paga por la infraestructura técnica, no por la compra de datos personales.', 50, legalY + 15)
               .text('2. La información proviene de fuentes públicas. No hay reembolsos tras la entrega de créditos.', 50, legalY + 27)
               .text('3. Consulta PE actúa como intermediario tecnológico bajo la Ley 29733.', 50, legalY + 39);

            // ==========================================
            // 7. FOOTER (Barra Gris Inferior)
            // ==========================================
            // La imagen tiene una barra gris grande al final.
            const footerY = 680;
            const footerHeight = 120;

            doc.rect(0, footerY, 595, footerHeight).fill(colors.lightGray);

            // Columnas del footer
            const col1X = 50;
            const col2X = 350;
            const textY = footerY + 30;

            // Columna 1: Información de Pago / Fiscal
            doc.fillColor(colors.black).font(fontMono).fontSize(10)
               .text('INFORMACIÓN FISCAL', col1X, textY);
            
            doc.font(fontBody).fontSize(8).fillColor(colors.darkGray).moveDown(0.5);
            doc.text('Razón Social: CUBAS PEREZ JOSE RENE', col1X);
            doc.text('RUC: 10736224351', col1X);
            doc.text('Domicilio: Caserío Pajonal, Cajamarca', col1X);
            doc.text('Actividad: 6399 - Servicios de Información', col1X);

            // Columna 2: Datos de Contacto
            doc.fillColor(colors.black).font(fontMono).fontSize(10)
               .text('DATOS DE CONTACTO', col2X, textY);

            doc.font(fontBody).fontSize(8).fillColor(colors.darkGray).moveDown(0.5);
            doc.text('Soporte: App Consulta PE', col2X);
            doc.text(email, col2X); // Email del cliente o soporte
            doc.text('Horario: Lunes a Viernes 9am - 6pm', col2X);

            // Finalizar PDF
            doc.end();
            
            stream.on('finish', () => {
                console.log(`PDF Generado estilo Boutique: ${fileName}`);
                resolve(`/invoices/${fileName}`);
            });
            
            stream.on('error', (error) => {
                reject(error);
            });
            
        } catch (error) {
            console.error('Error generando PDF:', error);
            reject(error);
        }
    });
}

// Función de limpieza (se mantiene igual)
export async function cleanupOldInvoices(maxAgeHours = 24) {
    try {
        const invoicesDir = path.join(__dirname, 'public', 'invoices');
        if (!fs.existsSync(invoicesDir)) return;
        
        const files = fs.readdirSync(invoicesDir);
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000;
        
        for (const file of files) {
            if (file.endsWith('.pdf')) {
                const filePath = path.join(invoicesDir, file);
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlinkSync(filePath);
                }
            }
        }
    } catch (error) {
        console.error('Error limpiando archivos:', error);
    }
}
