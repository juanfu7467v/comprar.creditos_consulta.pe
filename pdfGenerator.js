import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Genera una Boleta de Venta Electrónica formal con QR y cláusulas legales
 */
export async function generateInvoicePDF(data) {
    const { 
        orderId, 
        date, 
        email, 
        amount, 
        credits, 
        description,
        clientName = ''
    } = data;
    
    return new Promise(async (resolve, reject) => {
        try {
            if (!orderId || !amount || !email) throw new Error('Datos incompletos para generar PDF');
            
            const montoTotal = parseFloat(amount);
            
            // Lógica SUNAT para Cliente
            let nombreCliente = "CLIENTES VARIOS";
            if (montoTotal > 700) {
                if (!clientName || clientName.trim() === "") {
                    throw new Error('Para montos mayores a S/ 700 es obligatorio el nombre del cliente.');
                }
                nombreCliente = clientName.toUpperCase();
            } else if (clientName && clientName.trim() !== "") {
                nombreCliente = clientName.toUpperCase();
            }

            const emisor = {
                razonSocial: 'CUBAS PEREZ JOSE RENE',
                ruc: '10736224351',
                direccion: 'Caserío Pajonal, Cajamarca',
                tipoDoc: 'BOLETA DE VENTA ELECTRÓNICA',
                serie: 'B001'
            };

            const correlativo = String(orderId).slice(-8).padStart(8, '0');
            const numeracion = `${emisor.serie}-${correlativo}`;
            const opGravada = montoTotal / 1.18;
            const igv = montoTotal - opGravada;

            // Generar QR según estándar SUNAT
            const qrContent = `${emisor.ruc}|03|${emisor.serie}|${correlativo}|${igv.toFixed(2)}|${montoTotal.toFixed(2)}|${date.split(',')[0]}| | `;
            const qrDataUrl = await QRCode.toDataURL(qrContent);

            const doc = new PDFDocument({ margin: 40, size: 'A4' });
            const fileName = `boleta_${orderId}_${Date.now()}.pdf`;
            const publicDir = path.join(__dirname, 'public', 'invoices');
            
            if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
            
            const filePath = path.join(publicDir, fileName);
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            const colors = { black: '#000000', darkGray: '#333333', lightGray: '#f9f9f9', borderGray: '#cccccc' };

            // --- ENCABEZADO ---
            doc.font('Helvetica-Bold').fontSize(14).fillColor(colors.black).text(emisor.razonSocial, 40, 50);
            doc.font('Helvetica').fontSize(9).fillColor(colors.darkGray)
               .text(`RUC: ${emisor.ruc}`, 40, 70)
               .text(emisor.direccion, 40, 82)
               .text('Cajamarca - Perú', 40, 94);

            // RECUADRO TITULO (Ajustado en altura para el texto)
            doc.rect(350, 45, 200, 90).stroke(colors.black);
            doc.font('Helvetica-Bold').fontSize(12).text(`RUC: ${emisor.ruc}`, 350, 55, { width: 200, align: 'center' });
            
            // Fondo negro para el tipo de documento (Altura aumentada)
            doc.rect(350, 75, 200, 35).fill(colors.black);
            doc.fillColor('#FFFFFF').fontSize(10).text(emisor.tipoDoc, 350, 86, { width: 200, align: 'center' });
            
            doc.fillColor(colors.black).fontSize(12).text(numeracion, 350, 115, { width: 200, align: 'center' });

            // --- DATOS DEL CLIENTE ---
            doc.rect(40, 150, 510, 65).stroke(colors.borderGray);
            doc.font('Helvetica-Bold').fontSize(9).text('ADQUIRENTE:', 50, 160);
            doc.font('Helvetica').text(`Señor(es): ${nombreCliente}`, 50, 175);
            doc.text(`Email: ${email}`, 50, 187);
            doc.text(`Fecha de Emisión: ${date}`, 350, 160);
            doc.text('Moneda: SOLES (S/)', 350, 175);

            // --- TABLA ---
            const tableY = 230;
            doc.rect(40, tableY, 510, 20).fill(colors.black);
            doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
            doc.text('CANT.', 45, tableY + 6);
            doc.text('DESCRIPCIÓN', 100, tableY + 6);
            doc.text('P. UNIT', 400, tableY + 6);
            doc.text('IMPORTE', 480, tableY + 6);

            doc.fillColor(colors.black).font('Helvetica').text('1.00', 45, tableY + 30);
            doc.text(description || 'Servicio de Acceso a Infraestructura Digital', 100, tableY + 30, { width: 280 });
            doc.text(`S/ ${montoTotal.toFixed(2)}`, 400, tableY + 30);
            doc.text(`S/ ${montoTotal.toFixed(2)}`, 480, tableY + 30);

            // --- TOTALES ---
            const totalsY = tableY + 80;
            doc.font('Helvetica').fontSize(9);
            doc.text('Op. Gravada:', 400, totalsY);
            doc.text(`S/ ${opGravada.toFixed(2)}`, 480, totalsY);
            doc.text('IGV (18%):', 400, totalsY + 15);
            doc.text(`S/ ${igv.toFixed(2)}`, 480, totalsY + 15);
            doc.font('Helvetica-Bold').fontSize(11).text('TOTAL:', 400, totalsY + 35);
            doc.text(`S/ ${montoTotal.toFixed(2)}`, 480, totalsY + 35);

            // --- PIE DE PÁGINA (QR, LEYENDAS Y RENUNCIA) ---
            const footerY = 580;
            doc.image(qrDataUrl, 40, footerY, { width: 85 });

            doc.font('Helvetica').fontSize(7).fillColor('#666666');
            doc.text('Representación impresa de la Boleta de Venta Electrónica.', 140, footerY + 5);
            doc.text('Consulte la validez de su comprobante en la página oficial de la SUNAT.', 140, footerY + 15);
            doc.text('Bienes transferidos en la Amazonía para ser consumidos en la misma.', 140, footerY + 25);
            
            // RENUNCIA DE RESPONSABILIDAD / PRIVACIDAD
            doc.font('Helvetica-Bold').text('CLÁUSULA DE PROTECCIÓN DE DATOS:', 140, footerY + 40);
            doc.font('Helvetica').fontSize(6).text(
                'De acuerdo a la Ley N° 29733, el usuario autoriza a CONSULTA PE al tratamiento de sus datos personales para fines de facturación y soporte técnico. ' +
                'Este documento no es canjeable por dinero. El acceso al servicio es personal e intransferible. ' +
                'CONSULTA PE no se responsabiliza por el mal uso de los datos obtenidos a través de la plataforma por parte del usuario.', 
                140, footerY + 50, { width: 380, align: 'justify' }
            );

            doc.font('Helvetica-Bold').fontSize(9).fillColor(colors.black).text('¡Gracias por confiar en Consulta PE!', 140, footerY + 80);

            doc.end();
            stream.on('finish', () => resolve(`/invoices/${fileName}`));
        } catch (error) {
            reject(error);
        }
    });
}
