import PDFDocument from 'pdfkit';
import admin from 'firebase-admin'; // Necesario para guardar en la nube
import QRCode from 'qrcode'; // Necesario para el QR

/**
 * Genera una Boleta de Venta Electrónica formal con QR y subida automática a Firebase.
 */
export async function generateInvoicePDF(data) {
    const { 
        orderId, 
        date, 
        email, 
        amount, 
        description,
        clientName = '',     // Nombre del cliente o Razón Social
        clientDoc = ''       // DNI o RUC del cliente
    } = data;
    
    return new Promise(async (resolve, reject) => {
        try {
            // 1. Validaciones Básicas
            if (!orderId) throw new Error('orderId es requerido');
            if (!amount) throw new Error('amount es requerido');
            
            const montoTotal = parseFloat(amount);
            
            // 2. Lógica SUNAT: Validación de Identidad del Cliente
            // Si el monto supera S/ 700, es obligatorio tener nombre y documento.
            let nombreClienteFinal = "CLIENTES VARIOS";
            let docClienteFinal = "00000000"; // DNI genérico para menores cuantías

            if (montoTotal >= 700) {
                if (!clientName || clientName.trim() === "" || !clientDoc) {
                    // Nota: No lanzamos error para no bloquear la venta, pero ponemos advertencia en logs
                    console.warn("ADVERTENCIA: Venta mayor a 700 sin datos completos. Se requiere DNI/RUC.");
                }
                nombreClienteFinal = clientName ? clientName.toUpperCase() : "CLIENTE SIN IDENTIFICAR";
                docClienteFinal = clientDoc || "-";
            } else {
                if (clientName && clientName.trim() !== "") {
                    nombreClienteFinal = clientName.toUpperCase();
                    docClienteFinal = clientDoc || "-";
                }
            }

            // 3. Datos del Emisor (Tu Negocio - Nuevo RUS)
            const emisor = {
                razonSocial: 'CUBAS PEREZ JOSE RENE',
                ruc: '10736224351',
                direccion: 'Caserío Pajonal, Cajamarca',
                ubigeo: '060101', // Cajamarca
                tipoDoc: 'BOLETA DE VENTA ELECTRÓNICA',
                serie: 'B001'
            };

            // 4. Formatear Numeración (B001-0000XXXX)
            // Usamos los últimos 8 dígitos del orderId o un timestamp si es muy largo
            const correlativo = String(orderId).replace(/\D/g,'').slice(-8).padStart(8, '0');
            const numeracion = `${emisor.serie}-${correlativo}`;

            // 5. Cálculos Económicos
            // Aunque sea RUS, mostramos el desglose para formalidad
            const opGravada = montoTotal / 1.18;
            const igv = montoTotal - opGravada;

            // 6. Generar Código QR (Estándar SUNAT)
            // Formato: RUC | TIPO | SERIE | NUMERO | IGV | TOTAL | FECHA | TIPO_DOC_CLIENTE | NUM_DOC_CLIENTE
            const qrContent = `${emisor.ruc}|03|${emisor.serie}|${correlativo}|${igv.toFixed(2)}|${montoTotal.toFixed(2)}|${date}|1|${docClienteFinal}`;
            const qrDataUrl = await QRCode.toDataURL(qrContent);

            // 7. Configuración del PDF
            const doc = new PDFDocument({ 
                margin: 40, 
                size: 'A4',
                info: {
                    Title: `BOLETA ${numeracion}`,
                    Author: emisor.razonSocial,
                    Creator: 'Sistema Consulta PE'
                }
            });

            // Capturamos el PDF en memoria (Buffer) para subirlo a Firebase
            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));

            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(buffers);
                    const fileName = `invoices/boleta_${numeracion}_${Date.now()}.pdf`;
                    
                    // -- SUBIDA A FIREBASE STORAGE --
                    // Asegúrate de tener la variable FIREBASE_STORAGE_BUCKET en tu .env o Secrets
                    const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
                    const file = bucket.file(fileName);

                    await file.save(pdfBuffer, {
                        metadata: { contentType: 'application/pdf' },
                        public: true 
                    });

                    // Obtenemos la URL pública
                    /* Nota: Si usas Firebase Storage estándar, esta URL funciona. 
                       Si usas Google Cloud Storage puro, puede variar. */
                    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
                    
                    console.log(`✅ Boleta guardada en nube: ${publicUrl}`);
                    resolve(publicUrl);

                } catch (err) {
                    console.error("Error subiendo a Firebase:", err);
                    reject(err);
                }
            });

            // --- DISEÑO VISUAL DEL PDF ---
            
            const colors = {
                black: '#000000',
                darkGray: '#444444',
                lightGray: '#f5f5f5',
                blueHeader: '#2c3e50'
            };
            const fontBold = 'Helvetica-Bold';
            const fontReg = 'Helvetica';

            // -- ENCABEZADO --
            // Izquierda: Datos Emisor
            doc.font(fontBold).fontSize(16).text(emisor.razonSocial, 40, 50);
            doc.font(fontReg).fontSize(9).fillColor(colors.darkGray)
               .text('RUC: ' + emisor.ruc, 40, 70)
               .text(emisor.direccion, 40, 82)
               .text('Zona Comercial Amazonía - Ley 27037', 40, 94) // Importante para Cajamarca/Selva
               .text('Email: soporte@consultape.com', 40, 106);

            // Derecha: Caja RUC
            doc.rect(380, 45, 175, 75).stroke(colors.black); // Borde caja
            doc.font(fontBold).fontSize(12).fillColor(colors.black)
               .text(`RUC ${emisor.ruc}`, 380, 60, { width: 175, align: 'center' });
            
            doc.rect(380, 78, 175, 22).fill(colors.blueHeader); // Fondo título
            doc.fillColor('white').fontSize(10)
               .text('BOLETA DE VENTA', 380, 84, { width: 175, align: 'center' });
            doc.fillColor('white').fontSize(8)
               .text('ELECTRÓNICA', 380, 94, { width: 175, align: 'center' });

            doc.fillColor(colors.black).fontSize(12)
               .text(numeracion, 380, 108, { width: 175, align: 'center' });

            // -- INFO CLIENTE --
            const clientBoxY = 140;
            doc.roundedRect(40, clientBoxY, 515, 50, 2).fillAndStroke(colors.lightGray, '#e0e0e0');
            
            doc.fillColor(colors.black).font(fontBold).fontSize(9).text('CLIENTE:', 50, clientBoxY + 10);
            doc.font(fontReg).text(nombreClienteFinal, 50, clientBoxY + 25);
            
            doc.font(fontBold).text('DNI/RUC:', 300, clientBoxY + 10);
            doc.font(fontReg).text(docClienteFinal, 300, clientBoxY + 25);

            doc.font(fontBold).text('FECHA:', 430, clientBoxY + 10);
            doc.font(fontReg).text(date.split(',')[0], 430, clientBoxY + 25); // Solo fecha, sin hora

            // -- TABLA DE PRODUCTOS --
            const tableTop = 210;
            const itemCodeX = 50;
            const descX = 120;
            const priceX = 400;
            const totalX = 480;

            // Header Tabla
            doc.rect(40, tableTop, 515, 20).fill(colors.blueHeader);
            doc.fillColor('white').font(fontBold).fontSize(9);
            doc.text('CANT', itemCodeX, tableTop + 6);
            doc.text('DESCRIPCIÓN', descX, tableTop + 6);
            doc.text('P. UNIT', priceX, tableTop + 6);
            doc.text('TOTAL', totalX, tableTop + 6);

            // Item (Fila única por ahora)
            const rowY = tableTop + 30;
            doc.fillColor(colors.black).font(fontReg);
            doc.text('1', itemCodeX, rowY);
            doc.text(description || 'Servicio de Créditos Digitales', descX, rowY);
            doc.text(montoTotal.toFixed(2), priceX, rowY);
            doc.text(montoTotal.toFixed(2), totalX, rowY);

            // Línea separadora
            doc.moveTo(40, rowY + 20).lineTo(555, rowY + 20).stroke('#cccccc');

            // -- TOTALES --
            const totalsY = rowY + 40;
            doc.font(fontReg).fontSize(9);
            
            // Textos alineados a la derecha
            doc.text('Op. Gravada:', 350, totalsY, { width: 100, align: 'right' });
            doc.text('IGV (18%):', 350, totalsY + 15, { width: 100, align: 'right' });
            
            doc.font(fontBold).fontSize(11);
            doc.text('TOTAL A PAGAR:', 350, totalsY + 35, { width: 100, align: 'right' });

            // Valores numéricos
            doc.font(fontReg).fontSize(9);
            doc.text(`S/ ${opGravada.toFixed(2)}`, 480, totalsY);
            doc.text(`S/ ${igv.toFixed(2)}`, 480, totalsY + 15);
            
            doc.font(fontBold).fontSize(11);
            doc.text(`S/ ${montoTotal.toFixed(2)}`, 480, totalsY + 35);

            // -- PIE DE PÁGINA (QR Y LEGAL) --
            const footerY = 600;

            // Código QR
            doc.image(qrDataUrl, 50, footerY, { width: 90 });

            // Texto Legal y Renuncia de Responsabilidad
            doc.font(fontReg).fontSize(7).fillColor('#666666');
            const legalX = 160;
            
            doc.text('REPRESENTACIÓN IMPRESA DE LA BOLETA DE VENTA ELECTRÓNICA', legalX, footerY + 5);
            doc.text('Este comprobante ha sido emitido desde un sistema electrónico del contribuyente.', legalX, footerY + 15);
            
            // Renuncia de Responsabilidad (Texto solicitado)
            doc.font(fontBold).text('TÉRMINOS Y RENUNCIA DE RESPONSABILIDAD:', legalX, footerY + 30);
            doc.font(fontReg).text(
                '1. El servicio facturado corresponde exclusivamente al acceso a infraestructura tecnológica y capacidad de cómputo. ' +
                '2. La empresa no vende datos personales, sino que facilita el acceso a fuentes de información pública conforme a la Ley 27806. ' +
                '3. El usuario asume total responsabilidad por el uso que dé a la información consultada, liberando a CUBAS PEREZ JOSE RENE de cualquier responsabilidad civil o penal ante terceros. ' +
                '4. BIENES TRANSFERIDOS EN LA AMAZONÍA REGIÓN SELVA PARA SER CONSUMIDOS EN LA MISMA (Si aplica).',
                legalX, footerY + 42, { width: 350, align: 'justify' }
            );

            // Finalizar PDF
            doc.end();

        } catch (error) {
            console.error('❌ Error generando PDF:', error);
            reject(error);
        }
    });
}
