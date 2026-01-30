import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Genera una Boleta de Venta Electrónica cumpliendo con la normativa SUNAT (Nuevo RUS)
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
            // Validaciones básicas
            if (!orderId) throw new Error('orderId es requerido');
            if (!amount) throw new Error('amount es requerido');
            if (!email) throw new Error('email es requerido');
            
            const montoTotal = parseFloat(amount);
            
            // Lógica SUNAT para Cliente
            let nombreCliente = "CLIENTES VARIOS";
            if (montoTotal > 700) {
                if (!clientName || clientName.trim() === "") {
                    throw new Error('Para montos mayores a S/ 700 es obligatorio el nombre y documento del cliente.');
                }
                nombreCliente = clientName.toUpperCase();
            } else if (clientName && clientName.trim() !== "") {
                nombreCliente = clientName.toUpperCase();
            }

            // Datos del Emisor (Nuevo RUS)
            const emisor = {
                razonSocial: 'CUBAS PEREZ JOSE RENE',
                ruc: '10736224351',
                direccion: 'Caserío Pajonal, Cajamarca',
                tipoDoc: 'BOLETA DE VENTA ELECTRÓNICA',
                serie: 'B001'
            };

            // Formatear correlativo (8 dígitos)
            const correlativo = String(orderId).slice(-8).padStart(8, '0');
            const numeracion = `${emisor.serie}-${correlativo}`;

            // Cálculos Económicos (Desglose referencial para formalidad)
            const opGravada = montoTotal / 1.18;
            const igv = montoTotal - opGravada;

            // Generar Código QR (RUC | TIPO DOC | SERIE | NUMERO | IGV | TOTAL | FECHA)
            const qrContent = `${emisor.ruc}|03|${emisor.serie}|${correlativo}|${igv.toFixed(2)}|${montoTotal.toFixed(2)}|${date.split(',')[0]}`;
            const qrDataUrl = await QRCode.toDataURL(qrContent);

            // Configuración del Documento
            const doc = new PDFDocument({ 
                margin: 40,
                size: 'A4',
                info: {
                    Title: `BOLETA ELECTRÓNICA ${numeracion}`,
                    Author: emisor.razonSocial,
                    Subject: 'Comprobante de Pago Electrónico',
                    Creator: 'Consulta PE System'
                }
            });
            
            const fileName = `boleta_${orderId}_${Date.now()}.pdf`;
            const publicDir = path.join(__dirname, 'public', 'invoices');
            
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir, { recursive: true });
            }
            
            const filePath = path.join(publicDir, fileName);
            const stream = fs.createWriteStream(filePath);
            
            doc.pipe(stream);

            const colors = {
                black: '#000000',
                darkGray: '#333333',
                lightGray: '#f9f9f9',
                borderGray: '#cccccc'
            };

            const fontMono = 'Helvetica-Bold';
            const fontBody = 'Helvetica';

            // --- ENCABEZADO ---
            // Lado Izquierdo: Datos del Emisor
            doc.font(fontMono).fontSize(14).fillColor(colors.black).text(emisor.razonSocial, 40, 50);
            doc.font(fontBody).fontSize(9).fillColor(colors.darkGray)
               .text(`RUC: ${emisor.ruc}`, 40, 70)
               .text(emisor.direccion, 40, 82)
               .text('Cajamarca - Perú', 40, 94);

            // Lado Derecho: Recuadro de RUC y Numeración
            doc.rect(350, 45, 200, 80).stroke(colors.black);
            doc.font(fontMono).fontSize(12).text(`RUC: ${emisor.ruc}`, 350, 60, { width: 200, align: 'center' });
            doc.rect(350, 75, 200, 25).fill(colors.black);
            doc.fillColor('#FFFFFF').text(emisor.tipoDoc, 350, 82, { width: 200, align: 'center' });
            doc.fillColor(colors.black).text(numeracion, 350, 105, { width: 200, align: 'center' });

            // --- DATOS DEL CLIENTE ---
            doc.rect(40, 140, 510, 60).stroke(colors.borderGray);
            doc.font(fontMono).fontSize(9).text('ADQUIRENTE:', 50, 150);
            doc.font(fontBody).text(`Señor(es): ${nombreCliente}`, 50, 165);
            doc.text(`Email: ${email}`, 50, 177);
            doc.text(`Fecha de Emisión: ${date}`, 350, 150);
            doc.text('Moneda: SOLES', 350, 165);

            // --- TABLA DE DETALLE ---
            const tableY = 220;
            doc.rect(40, tableY, 510, 20).fill(colors.black);
            doc.fillColor('#FFFFFF').font(fontMono).fontSize(9);
            doc.text('CANT.', 45, tableY + 6);
            doc.text('DESCRIPCIÓN', 100, tableY + 6);
            doc.text('P. UNIT', 400, tableY + 6);
            doc.text('IMPORTE', 480, tableY + 6);

            const rowY = tableY + 30;
            doc.fillColor(colors.black).font(fontBody);
            doc.text('1.00', 45, rowY);
            doc.text(description || 'Servicio de Acceso a Infraestructura Digital', 100, rowY, { width: 280 });
            doc.text(`S/ ${montoTotal.toFixed(2)}`, 400, rowY);
            doc.text(`S/ ${montoTotal.toFixed(2)}`, 480, rowY);

            // Línea divisoria
            doc.moveTo(40, rowY + 30).lineTo(550, rowY + 30).stroke(colors.borderGray);

            // --- TOTALES ---
            const totalsY = rowY + 50;
            const rightX = 400;
            const valueX = 480;

            doc.font(fontBody).fontSize(9);
            doc.text('Op. Gravada:', rightX, totalsY);
            doc.text(`S/ ${opGravada.toFixed(2)}`, valueX, totalsY);

            doc.text('IGV (18%):', rightX, totalsY + 15);
            doc.text(`S/ ${igv.toFixed(2)}`, valueX, totalsY + 15);

            doc.font(fontMono).fontSize(11);
            doc.text('TOTAL:', rightX, totalsY + 35);
            doc.text(`S/ ${montoTotal.toFixed(2)}`, valueX, totalsY + 35);

            // --- PIE DE PÁGINA (QR Y LEYENDAS) ---
            const footerY = 550;
            
            // QR Code
            doc.image(qrDataUrl, 40, footerY, { width: 80 });

            // Leyendas
            doc.font(fontBody).fontSize(8).fillColor(colors.darkGray);
            doc.text('Representación impresa de la Boleta de Venta Electrónica.', 130, footerY + 10);
            doc.text('Consulte su comprobante en: https://consulta.pe', 130, footerY + 22);
            doc.text('Bienes transferidos en la Amazonía para ser consumidos en la misma.', 130, footerY + 34);
            
            doc.font(fontMono).text('¡Gracias por su compra!', 130, footerY + 55);

            doc.end();
            
            stream.on('finish', () => {
                console.log(`✅ Boleta generada: ${fileName}`);
                resolve(`/invoices/${fileName}`);
            });
            
            stream.on('error', (error) => {
                console.error('❌ Error en stream del PDF:', error);
                reject(error);
            });
            
        } catch (error) {
            console.error('❌ Error generando PDF:', error);
            reject(error);
        }
    });
}

export async function cleanupOldInvoices(maxAgeHours = 24) {
    try {
        const invoicesDir = path.join(__dirname, 'public', 'invoices');
        if (!fs.existsSync(invoicesDir)) return;
        
        const files = fs.readdirSync(invoicesDir);
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000;
        
        let cleaned = 0;
        
        for (const file of files) {
            if (file.endsWith('.pdf')) {
                const filePath = path.join(invoicesDir, file);
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlinkSync(filePath);
                    cleaned++;
                }
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Limpiados ${cleaned} archivos PDF antiguos`);
        }
    } catch (error) {
        console.error('❌ Error limpiando archivos:', error);
    }
}
