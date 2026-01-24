import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Genera un PDF de boleta/factura para una compra.
 * @param {Object} data - Datos de la compra.
 * @returns {Promise<string>} - Ruta del archivo generado.
 */
export async function generateInvoicePDF(data) {
    const { orderId, date, email, amount, credits, description } = data;
    
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const fileName = `boleta_${orderId}.pdf`;
            const publicDir = path.join(__dirname, 'public', 'invoices');
            
            // Asegurar que el directorio existe
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir, { recursive: true });
            }
            
            const filePath = path.join(publicDir, fileName);
            const stream = fs.createWriteStream(filePath);
            
            doc.pipe(stream);
            
            // Encabezado
            doc.fontSize(20).text('CONSULTA PE', { align: 'center' });
            doc.fontSize(10).text('Comprobante de Pago Electrónico', { align: 'center' });
            doc.moveDown();
            
            doc.lineCap('butt').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown();
            
            // Detalles de la transacción
            doc.fontSize(12).text(`Número de Operación: ${orderId}`);
            doc.text(`Fecha: ${date}`);
            doc.text(`Usuario: ${email}`);
            doc.moveDown();
            
            // Tabla de conceptos
            const tableTop = doc.y;
            doc.font('Helvetica-Bold');
            doc.text('Descripción', 50, tableTop);
            doc.text('Créditos', 300, tableTop);
            doc.text('Monto', 450, tableTop, { align: 'right' });
            
            doc.font('Helvetica');
            const rowTop = tableTop + 20;
            doc.text(description || 'Compra de Créditos', 50, rowTop);
            doc.text(credits.toString(), 300, rowTop);
            doc.text(`S/ ${amount.toFixed(2)}`, 450, rowTop, { align: 'right' });
            
            doc.moveDown(4);
            doc.lineCap('butt').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown();
            
            // Total
            doc.fontSize(14).font('Helvetica-Bold').text(`TOTAL: S/ ${amount.toFixed(2)}`, { align: 'right' });
            
            doc.moveDown(2);
            doc.fontSize(10).font('Helvetica-Oblique').text('Gracias por su compra. Los créditos han sido activados en su cuenta.', { align: 'center' });
            
            doc.end();
            
            stream.on('finish', () => {
                resolve(`/invoices/${fileName}`);
            });
            
            stream.on('error', (err) => {
                reject(err);
            });
            
        } catch (error) {
            reject(error);
        }
    });
}
