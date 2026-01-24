import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generateInvoicePDF(data) {
    const { orderId, date, email, amount, credits, description, type, ruc, razonSocial } = data;
    
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const fileName = `${type}_${orderId}.pdf`;
            const publicDir = path.join(__dirname, 'public', 'invoices');
            
            if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
            
            const filePath = path.join(publicDir, fileName);
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);
            
            // Header
            doc.fontSize(20).font('Helvetica-Bold').text('CONSULTA PE', { align: 'center' });
            doc.fontSize(10).font('Helvetica').text('SOLUCIONES DIGITALES S.A.C.', { align: 'center' });
            doc.text('RUC: 20601234567', { align: 'center' });
            doc.moveDown();
            
            doc.rect(50, doc.y, 500, 25).fill('#f3f4f6');
            doc.fillColor('#111827').fontSize(12).font('Helvetica-Bold').text(type.toUpperCase(), 50, doc.y - 18, { align: 'center' });
            doc.moveDown();
            
            // Client Info
            doc.fontSize(10).fillColor('black');
            doc.font('Helvetica-Bold').text('DATOS DEL CLIENTE:');
            doc.font('Helvetica').text(`Email: ${email}`);
            if (type === 'factura') {
                doc.text(`RUC: ${ruc}`);
                doc.text(`Razón Social: ${razonSocial}`);
            }
            doc.text(`Fecha: ${date}`);
            doc.text(`Operación: ${orderId}`);
            doc.moveDown();
            
            // Table
            const tableTop = doc.y;
            doc.rect(50, tableTop, 500, 20).fill('#1e40af');
            doc.fillColor('white').font('Helvetica-Bold');
            doc.text('DESCRIPCIÓN', 60, tableTop + 6);
            doc.text('CANT.', 300, tableTop + 6);
            doc.text('TOTAL', 450, tableTop + 6, { align: 'right' });
            
            doc.fillColor('black').font('Helvetica');
            doc.text(description, 60, tableTop + 30);
            doc.text(credits ? credits.toString() : '1', 300, tableTop + 30);
            doc.text(`S/ ${amount.toFixed(2)}`, 450, tableTop + 30, { align: 'right' });
            
            doc.moveDown(4);
            doc.lineCap('butt').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown();
            
            doc.fontSize(14).font('Helvetica-Bold').text(`TOTAL: S/ ${amount.toFixed(2)}`, { align: 'right' });
            
            doc.moveDown(3);
            doc.fontSize(8).font('Helvetica-Oblique').text('Este es un comprobante electrónico generado automáticamente por Consulta PE.', { align: 'center' });
            
            doc.end();
            stream.on('finish', () => resolve(`/invoices/${fileName}`));
            stream.on('error', reject);
        } catch (error) { reject(error); }
    });
}
