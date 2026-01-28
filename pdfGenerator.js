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
            // Validaciones
            if (!orderId) throw new Error('orderId es requerido');
            if (!amount) throw new Error('amount es requerido');
            if (!email) throw new Error('email es requerido');
            
            if (type === 'factura' && (!rucCliente || !razonSocialCliente)) {
                throw new Error('RUC y Razón Social son requeridos para factura');
            }

            const doc = new PDFDocument({ 
                margin: 0,
                size: 'A4',
                info: {
                    Title: `${type.toUpperCase()} - Consulta PE`,
                    Author: 'CUBAS PEREZ JOSE RENE',
                    Subject: 'Comprobante de Pago',
                    Keywords: 'consulta,pe,pago,comprobante',
                    Creator: 'Consulta PE System',
                    CreationDate: new Date()
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
            
            // Paleta de colores moderna
            const colors = {
                primary: '#2563eb',      // Azul moderno
                primaryDark: '#1e40af',  // Azul oscuro
                success: '#10b981',      // Verde
                dark: '#1f2937',         // Gris oscuro
                text: '#374151',         // Texto principal
                textLight: '#6b7280',    // Texto secundario
                bg: '#f9fafb',           // Fondo claro
                bgCard: '#ffffff',       // Fondo tarjetas
                border: '#e5e7eb',       // Bordes
                accent: '#f59e0b'        // Acento dorado
            };
            
            // ============================================
            // HEADER MODERNO CON GRADIENTE VISUAL
            // ============================================
            doc.rect(0, 0, 595, 140).fill(colors.primary);
            doc.rect(0, 135, 595, 5).fill(colors.accent);
            
            // Logo/Marca (lado izquierdo)
            doc.fillColor('#ffffff')
               .fontSize(28)
               .font('Helvetica-Bold')
               .text('CONSULTA PE', 40, 35);
            
            doc.fontSize(9)
               .font('Helvetica')
               .fillColor('#e0e7ff')
               .text('Servicio de Intermediación Tecnológica', 40, 70)
               .text('Estructuración de Datos Digitales', 40, 85);
            
            // Información fiscal (compacta)
            doc.fontSize(8)
               .fillColor('#ffffff')
               .text('RUC: 10736224351', 40, 105)
               .text('CUBAS PEREZ JOSE RENE', 40, 118);
            
            // ============================================
            // BADGE DEL COMPROBANTE (Estilo móvil moderno)
            // ============================================
            const badgeX = 380;
            const badgeY = 30;
            
            // Tarjeta flotante del comprobante
            doc.roundedRect(badgeX, badgeY, 175, 90, 8)
               .fill('#ffffff');
            
            // Tipo de documento (header de la tarjeta)
            doc.roundedRect(badgeX, badgeY, 175, 30, 8)
               .fill(type === 'factura' ? colors.success : colors.primaryDark);
            
            doc.fillColor('#ffffff')
               .fontSize(14)
               .font('Helvetica-Bold')
               .text(type === 'factura' ? 'FACTURA' : 'BOLETA', badgeX, badgeY + 9, { 
                   width: 175, 
                   align: 'center' 
               });
            
            // Número de comprobante
            doc.fillColor(colors.dark)
               .fontSize(10)
               .font('Helvetica-Bold')
               .text('N° de Serie', badgeX + 15, badgeY + 45)
               .fontSize(12)
               .fillColor(colors.primary)
               .text(orderId.substring(0, 13).toUpperCase(), badgeX + 15, badgeY + 62);
            
            // ============================================
            // SECCIÓN INFORMACIÓN DEL CLIENTE (Tipo Card)
            // ============================================
            let currentY = 170;
            
            // Título de sección
            doc.fillColor(colors.dark)
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('INFORMACIÓN DEL CLIENTE', 40, currentY);
            
            currentY += 25;
            
            // Tarjeta del cliente
            doc.roundedRect(40, currentY, 515, type === 'factura' ? 105 : 80, 6)
               .fillAndStroke(colors.bgCard, colors.border);
            
            currentY += 18;
            
            // Email (con ícono simulado)
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica')
               .text('✉ EMAIL', 55, currentY);
            
            doc.fillColor(colors.text)
               .fontSize(10)
               .font('Helvetica-Bold')
               .text(email, 55, currentY + 13, { width: 450 });
            
            currentY += 35;
            
            if (type === 'factura') {
                // RUC y Razón Social
                doc.fillColor(colors.textLight)
                   .fontSize(8)
                   .font('Helvetica')
                   .text('🏢 RUC', 55, currentY);
                
                doc.fillColor(colors.text)
                   .fontSize(10)
                   .font('Helvetica-Bold')
                   .text(rucCliente, 110, currentY);
                
                doc.fillColor(colors.textLight)
                   .fontSize(8)
                   .font('Helvetica')
                   .text('RAZÓN SOCIAL', 280, currentY);
                
                doc.fillColor(colors.text)
                   .fontSize(9)
                   .font('Helvetica')
                   .text(razonSocialCliente, 280, currentY + 13, { width: 260 });
                
                currentY += 35;
            }
            
            // Fecha e ID (en línea)
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica')
               .text('📅 FECHA DE EMISIÓN', 55, currentY);
            
            doc.fillColor(colors.text)
               .fontSize(9)
               .font('Helvetica')
               .text(date || new Date().toLocaleString('es-PE', { 
                   dateStyle: 'long', 
                   timeStyle: 'short' 
               }), 55, currentY + 13);
            
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica')
               .text('🔑 ID TRANSACCIÓN', 320, currentY);
            
            doc.fillColor(colors.text)
               .fontSize(8)
               .font('Helvetica-Bold')
               .text(orderId, 320, currentY + 13);
            
            // ============================================
            // DETALLE DEL SERVICIO (Tabla moderna)
            // ============================================
            currentY += 55;
            
            doc.fillColor(colors.dark)
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('DETALLE DEL SERVICIO', 40, currentY);
            
            currentY += 25;
            
            // Header de tabla con estilo moderno
            doc.roundedRect(40, currentY, 515, 28, 6)
               .fill(colors.bg);
            
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica-Bold')
               .text('DESCRIPCIÓN', 55, currentY + 10)
               .text('CANTIDAD', 380, currentY + 10)
               .text('IMPORTE', 480, currentY + 10);
            
            currentY += 28;
            
            // Fila del servicio
            doc.roundedRect(40, currentY, 515, 60, 6)
               .fillAndStroke(colors.bgCard, colors.border);
            
            currentY += 15;
            
            // Descripción del servicio (más clara)
            doc.fillColor(colors.text)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('Servicio de Intermediación Tecnológica', 55, currentY);
            
            doc.fontSize(8)
               .font('Helvetica')
               .fillColor(colors.textLight)
               .text('Estructuración de datos y acceso a infraestructura digital', 55, currentY + 14, { 
                   width: 310 
               });
            
            // Cantidad (con badge)
            const qtyText = credits ? `${credits} créditos` : '1 paquete';
            doc.roundedRect(375, currentY + 5, 80, 20, 4)
               .fill(colors.bg);
            
            doc.fillColor(colors.text)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text(qtyText, 375, currentY + 11, { width: 80, align: 'center' });
            
            // Precio
            doc.fillColor(colors.dark)
               .fontSize(11)
               .font('Helvetica-Bold')
               .text(`S/ ${parseFloat(amount).toFixed(2)}`, 470, currentY + 10);
            
            // ============================================
            // RESUMEN DE PAGO (Estilo destacado)
            // ============================================
            currentY += 80;
            
            // Tarjeta de total
            doc.roundedRect(350, currentY, 205, 70, 8)
               .fill(colors.primary);
            
            doc.fillColor('#e0e7ff')
               .fontSize(9)
               .font('Helvetica')
               .text('TOTAL A PAGAR', 370, currentY + 15);
            
            doc.fillColor('#ffffff')
               .fontSize(22)
               .font('Helvetica-Bold')
               .text(`S/ ${parseFloat(amount).toFixed(2)}`, 370, currentY + 35);
            
            // Subtotales (opcional, si quieres agregar IGV después)
            doc.roundedRect(350, currentY + 75, 205, 35, 6)
               .fillAndStroke(colors.bgCard, colors.border);
            
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica')
               .text('Base imponible:', 365, currentY + 85)
               .text('IGV (0%):', 365, currentY + 97);
            
            doc.fillColor(colors.text)
               .fontSize(8)
               .font('Helvetica-Bold')
               .text(`S/ ${parseFloat(amount).toFixed(2)}`, 490, currentY + 85, { align: 'right' })
               .text('S/ 0.00', 490, currentY + 97, { align: 'right' });
            
            // ============================================
            // TÉRMINOS Y CONDICIONES (Compacto y legible)
            // ============================================
            currentY += 135;
            
            doc.fillColor(colors.dark)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('TÉRMINOS DEL SERVICIO Y CLÁUSULAS LEGALES', 40, currentY);
            
            currentY += 20;
            
            doc.roundedRect(40, currentY, 515, 130, 6)
               .fillAndStroke('#fefce8', '#fbbf24');
            
            const terms = [
                {
                    title: 'Naturaleza del servicio:',
                    text: 'El pago cubre el acceso a infraestructura tecnológica, procesamiento y estructuración de datos en formato digital (JSON/Vista).'
                },
                {
                    title: 'Fuente de información:',
                    text: 'Los datos provienen exclusivamente de fuentes públicas estatales. No se comercializan bases de datos personales.'
                },
                {
                    title: 'Responsabilidad del uso:',
                    text: 'El cliente asume total responsabilidad por el uso de la información. El proveedor no se hace responsable de usos indebidos.'
                },
                {
                    title: 'Política de créditos:',
                    text: 'Los créditos no son reembolsables una vez asignados debido a la naturaleza digital inmediata del servicio.'
                }
            ];
            
            let termY = currentY + 12;
            terms.forEach((term, index) => {
                doc.fillColor('#92400e')
                   .fontSize(7.5)
                   .font('Helvetica-Bold')
                   .text(`${index + 1}. ${term.title}`, 55, termY);
                
                doc.fillColor('#78350f')
                   .fontSize(7)
                   .font('Helvetica')
                   .text(term.text, 55, termY + 10, { width: 490 });
                
                termY += 28;
            });
            
            // ============================================
            // FOOTER MODERNO
            // ============================================
            currentY += 155;
            
            // Línea divisoria
            doc.moveTo(40, currentY)
               .lineTo(555, currentY)
               .stroke(colors.border);
            
            currentY += 15;
            
            // Información fiscal footer
            doc.fillColor(colors.textLight)
               .fontSize(7)
               .font('Helvetica')
               .text('CUBAS PEREZ JOSE RENE | RUC: 10736224351', 40, currentY, { 
                   width: 515, 
                   align: 'center' 
               });
            
            doc.text('Domicilio Fiscal: Caserío Pajonal, Cajamarca - Cutervo', 40, currentY + 12, { 
                width: 515, 
                align: 'center' 
            });
            
            doc.text('Actividad: 6399 - Otros Servicios de Información N.C.P.', 40, currentY + 24, { 
                width: 515, 
                align: 'center' 
            });
            
            // Badge de verificación
            currentY += 45;
            
            doc.roundedRect(230, currentY, 135, 50, 6)
               .fillAndStroke(colors.bg, colors.border);
            
            doc.fillColor(colors.textLight)
               .fontSize(7)
               .font('Helvetica-Bold')
               .text('✓ COMPROBANTE VERIFICADO', 230, currentY + 12, { 
                   width: 135, 
                   align: 'center' 
               });
            
            doc.fontSize(6)
               .font('Helvetica')
               .text('Sistema electrónico Consulta PE', 230, currentY + 26, { 
                   width: 135, 
                   align: 'center' 
               });
            
            doc.fontSize(5.5)
               .text(`Generado: ${new Date().toLocaleString('es-PE')}`, 230, currentY + 37, { 
                   width: 135, 
                   align: 'center' 
               });
            
            doc.end();
            
            stream.on('finish', () => {
                resolve(`/invoices/${fileName}`);
            });
            
            stream.on('error', (error) => {
                reject(error);
            });
            
        } catch (error) {
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
        
        console.log(`✓ Limpieza completada: ${cleaned} archivos eliminados`);
    } catch (error) {
        console.error('Error limpiando archivos:', error);
    }
}
