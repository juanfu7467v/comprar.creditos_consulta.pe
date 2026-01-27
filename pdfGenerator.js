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
        ruc = '', 
        razonSocial = '' 
    } = data;
    
    return new Promise((resolve, reject) => {
        try {
            // Validaciones
            if (!orderId) throw new Error('orderId es requerido');
            if (!amount) throw new Error('amount es requerido');
            if (!email) throw new Error('email es requerido');
            
            if (type === 'factura' && (!ruc || !razonSocial)) {
                throw new Error('RUC y Razón Social son requeridos para factura');
            }

            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4',
                info: {
                    Title: `${type.toUpperCase()} - Consulta PE`,
                    Author: 'Consulta PE',
                    Subject: 'Comprobante de Pago',
                    Keywords: 'consulta,pe,pago,comprobante',
                    Creator: 'Consulta PE System',
                    CreationDate: new Date()
                }
            });
            
            const fileName = `${type}_${orderId}_${Date.now()}.pdf`;
            const publicDir = path.join(__dirname, 'public', 'invoices');
            
            // Crear directorio si no existe
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir, { recursive: true });
            }
            
            const filePath = path.join(publicDir, fileName);
            const stream = fs.createWriteStream(filePath);
            
            doc.pipe(stream);
            
            // Configuración de fuentes
            doc.registerFont('Helvetica', 'Helvetica');
            doc.registerFont('Helvetica-Bold', 'Helvetica-Bold');
            
            // Color de la empresa
            const primaryColor = '#4f46e5';
            
            // Header con logo
            doc.rect(0, 0, 595, 80)
               .fill(primaryColor);
            
            doc.fillColor('white')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text('CONSULTA PE', 50, 30);
            
            doc.fontSize(10)
               .text('SOLUCIONES DIGITALES S.A.C.', 50, 60);
            
            // Tipo de comprobante
            doc.fillColor('#1e293b')
               .fontSize(16)
               .font('Helvetica-Bold')
               .text(type.toUpperCase(), 450, 30, { align: 'right' });
            
            doc.fontSize(10)
               .text(`N° ${orderId}`, 450, 50, { align: 'right' });
            
            doc.moveDown(4);
            
            // Línea separadora
            doc.moveTo(50, 100)
               .lineTo(545, 100)
               .lineWidth(1)
               .stroke('#e2e8f0');
            
            doc.moveDown();
            
            // Información del cliente
            const clientY = 120;
            doc.fillColor('#1e293b')
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('DATOS DEL CLIENTE:', 50, clientY);
            
            doc.fillColor('#64748b')
               .fontSize(10)
               .font('Helvetica')
               .text(`Email: ${email}`, 50, clientY + 20);
            
            if (type === 'factura') {
                doc.text(`RUC: ${ruc}`, 50, clientY + 35);
                doc.text(`Razón Social: ${razonSocial}`, 50, clientY + 50);
                doc.text(`Fecha: ${date || new Date().toLocaleString('es-PE')}`, 50, clientY + 65);
            } else {
                doc.text(`Fecha: ${date || new Date().toLocaleString('es-PE')}`, 50, clientY + 35);
                doc.text(`Operación: ${orderId}`, 50, clientY + 50);
            }
            
            // Detalles de la transacción
            const detailsY = type === 'factura' ? clientY + 90 : clientY + 70;
            
            // Encabezado de la tabla
            doc.rect(50, detailsY, 495, 25)
               .fill('#f1f5f9');
            
            doc.fillColor('#1e293b')
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('DESCRIPCIÓN', 60, detailsY + 8);
            doc.text('CANTIDAD', 350, detailsY + 8);
            doc.text('TOTAL', 470, detailsY + 8, { align: 'right' });
            
            // Fila de contenido
            const contentY = detailsY + 35;
            doc.fillColor('#1e293b')
               .fontSize(10)
               .font('Helvetica')
               .text(description, 60, contentY, { width: 280 });
            
            doc.text(credits ? `${credits} créditos` : '1', 350, contentY);
            
            doc.font('Helvetica-Bold')
               .text(`S/ ${parseFloat(amount).toFixed(2)}`, 470, contentY, { align: 'right' });
            
            // Línea separadora
            doc.moveTo(50, contentY + 30)
               .lineTo(545, contentY + 30)
               .lineWidth(1)
               .stroke('#e2e8f0');
            
            // Total
            doc.fillColor('#1e293b')
               .fontSize(14)
               .font('Helvetica-Bold')
               .text(`TOTAL: S/ ${parseFloat(amount).toFixed(2)}`, 470, contentY + 50, { align: 'right' });
            
            // Información adicional
            const infoY = contentY + 100;
            doc.fillColor('#64748b')
               .fontSize(9)
               .font('Helvetica')
               .text('INFORMACIÓN ADICIONAL:', 50, infoY);
            
            doc.rect(50, infoY + 15, 495, 60)
               .fill('#f8fafc')
               .stroke('#e2e8f0');
            
            doc.fillColor('#475569')
               .fontSize(8)
               .text('• Este es un comprobante electrónico generado automáticamente.', 55, infoY + 25);
            doc.text('• Los créditos son activados instantáneamente después del pago.', 55, infoY + 40);
            doc.text('• Para consultas o soporte: soporte@consultape.com', 55, infoY + 55);
            doc.text('• Teléfono: +51 123 456 789', 55, infoY + 70);
            
            // Pie de página
            const footerY = 750;
            doc.moveTo(50, footerY)
               .lineTo(545, footerY)
               .lineWidth(0.5)
               .stroke('#cbd5e1');
            
            doc.fillColor('#94a3b8')
               .fontSize(8)
               .font('Helvetica')
               .text('Consulta PE © 2024 - Todos los derechos reservados', 50, footerY + 10, { align: 'center' });
            
            doc.text('RUC: 20601234567 | Dirección: Av. Ejemplo 123, Lima, Perú', 50, footerY + 25, { align: 'center' });
            
            // Código QR (simulado)
            const qrY = footerY + 40;
            doc.rect(250, qrY, 95, 95)
               .fill('#f1f5f9')
               .stroke('#cbd5e1');
            
            doc.fillColor('#64748b')
               .fontSize(7)
               .text('CÓDIGO DE VERIFICACIÓN', 250, qrY + 105, { width: 95, align: 'center' });
            
            doc.fontSize(6)
               .text(orderId.substring(0, 20), 250, qrY + 120, { width: 95, align: 'center' });
            
            doc.end();
            
            stream.on('finish', () => {
                console.log(`PDF generado: ${fileName}`);
                resolve(`/invoices/${fileName}`);
            });
            
            stream.on('error', (error) => {
                console.error('Error escribiendo archivo PDF:', error);
                reject(error);
            });
            
        } catch (error) {
            console.error('Error generando PDF:', error);
            reject(error);
        }
    });
}

// Función para limpiar archivos antiguos (opcional)
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
                    console.log(`Archivo eliminado: ${file}`);
                }
            }
        }
    } catch (error) {
        console.error('Error limpiando archivos antiguos:', error);
    }
}
