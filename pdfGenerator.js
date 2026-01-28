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
            
            // Configuración de diseño centralizado
            const pageWidth = 595.28; // A4 width en puntos
            const contentWidth = 515; // Ancho del contenido
            const leftMargin = (pageWidth - contentWidth) / 2; // 40.14 puntos ~ 40
            const rightMargin = leftMargin;
            
            // Paleta de colores moderna y profesional
            const colors = {
                primary: '#2563eb',      
                primaryLight: '#3b82f6', 
                primaryDark: '#1e40af',  
                success: '#10b981',      
                dark: '#1f2937',         
                text: '#374151',         
                textLight: '#6b7280',    
                bg: '#f9fafb',           
                bgCard: '#ffffff',       
                border: '#e5e7eb',       
                accent: '#f59e0b',       
                warning: '#fef3c7',
                warningBorder: '#fbbf24',
                warningText: '#92400e'
            };
            
            // ============================================
            // HEADER CON EFECTO 3D Y GRADIENTE
            // ============================================
            
            // Fondo principal del header
            doc.rect(0, 0, pageWidth, 140)
               .fill(colors.primary);
            
            // Sombra 3D inferior
            doc.rect(0, 140, pageWidth, 3)
               .fill(colors.primaryDark);
            
            doc.rect(0, 143, pageWidth, 5)
               .fill(colors.accent);
            
            // Logo/Marca centrado a la izquierda
            doc.fillColor('#ffffff')
               .fontSize(32)
               .font('Helvetica-Bold')
               .text('CONSULTA PE', leftMargin, 30);
            
            doc.fontSize(9)
               .font('Helvetica')
               .fillColor('#dbeafe')
               .text('Servicio de Intermediación Tecnológica', leftMargin, 70)
               .text('Estructuración de Datos Digitales', leftMargin, 85);
            
            // Información fiscal compacta
            doc.fontSize(8)
               .fillColor('#ffffff')
               .text('RUC: 10736224351', leftMargin, 105)
               .text('CUBAS PEREZ JOSE RENE', leftMargin, 118);
            
            // ============================================
            // BADGE DEL COMPROBANTE CON EFECTO 3D
            // ============================================
            const badgeWidth = 170;
            const badgeX = pageWidth - rightMargin - badgeWidth;
            const badgeY = 25;
            
            // Sombra del badge (efecto 3D)
            doc.roundedRect(badgeX + 3, badgeY + 3, badgeWidth, 95, 10)
               .fill('#00000015');
            
            // Tarjeta principal del badge
            doc.roundedRect(badgeX, badgeY, badgeWidth, 95, 10)
               .fill('#ffffff');
            
            // Header del badge con color según tipo
            const badgeHeaderColor = type === 'factura' ? colors.success : colors.primaryDark;
            doc.roundedRect(badgeX, badgeY, badgeWidth, 32, 10)
               .fill(badgeHeaderColor);
            
            doc.rect(badgeX, badgeY + 22, badgeWidth, 10)
               .fill(badgeHeaderColor);
            
            doc.fillColor('#ffffff')
               .fontSize(15)
               .font('Helvetica-Bold')
               .text(type === 'factura' ? 'FACTURA' : 'BOLETA', badgeX, badgeY + 8, { 
                   width: badgeWidth, 
                   align: 'center' 
               });
            
            // Número de serie
            doc.fillColor(colors.textLight)
               .fontSize(9)
               .font('Helvetica')
               .text('N° de Serie', badgeX + 15, badgeY + 45);
            
            doc.fillColor(colors.primary)
               .fontSize(11)
               .font('Helvetica-Bold')
               .text(orderId.substring(0, 13).toUpperCase(), badgeX + 15, badgeY + 62, {
                   width: badgeWidth - 30
               });
            
            // Línea decorativa en el badge
            doc.moveTo(badgeX + 15, badgeY + 85)
               .lineTo(badgeX + badgeWidth - 15, badgeY + 85)
               .lineWidth(2)
               .strokeColor(colors.accent)
               .stroke();
            
            // ============================================
            // INFORMACIÓN DEL CLIENTE CON CARD 3D
            // ============================================
            let currentY = 175;
            
            // Título de sección
            doc.fillColor(colors.dark)
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('INFORMACIÓN DEL CLIENTE', leftMargin, currentY);
            
            currentY += 28;
            
            // Altura dinámica de la tarjeta según tipo de comprobante
            const clientCardHeight = type === 'factura' ? 115 : 85;
            
            // Sombra de la tarjeta (efecto 3D)
            doc.roundedRect(leftMargin + 2, currentY + 2, contentWidth, clientCardHeight, 8)
               .fill('#00000010');
            
            // Tarjeta del cliente
            doc.roundedRect(leftMargin, currentY, contentWidth, clientCardHeight, 8)
               .fillAndStroke(colors.bgCard, colors.border);
            
            currentY += 20;
            
            // Email con ícono
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica-Bold')
               .text('✉  CORREO ELECTRÓNICO', leftMargin + 20, currentY);
            
            doc.fillColor(colors.text)
               .fontSize(10)
               .font('Helvetica')
               .text(email, leftMargin + 20, currentY + 15, { width: contentWidth - 40 });
            
            currentY += 42;
            
            if (type === 'factura') {
                // RUC
                doc.fillColor(colors.textLight)
                   .fontSize(8)
                   .font('Helvetica-Bold')
                   .text('🏢  RUC', leftMargin + 20, currentY);
                
                doc.fillColor(colors.text)
                   .fontSize(10)
                   .font('Helvetica')
                   .text(rucCliente, leftMargin + 90, currentY + 2);
                
                // Razón Social
                doc.fillColor(colors.textLight)
                   .fontSize(8)
                   .font('Helvetica-Bold')
                   .text('RAZÓN SOCIAL', leftMargin + 260, currentY);
                
                doc.fillColor(colors.text)
                   .fontSize(9)
                   .font('Helvetica')
                   .text(razonSocialCliente, leftMargin + 260, currentY + 15, { 
                       width: 240 
                   });
                
                currentY += 42;
            }
            
            // Fecha e ID de transacción
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica-Bold')
               .text('📅  FECHA DE EMISIÓN', leftMargin + 20, currentY);
            
            doc.fillColor(colors.text)
               .fontSize(9)
               .font('Helvetica')
               .text(date || new Date().toLocaleString('es-PE', { 
                   dateStyle: 'long', 
                   timeStyle: 'short' 
               }), leftMargin + 20, currentY + 15);
            
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica-Bold')
               .text('🔑  ID TRANSACCIÓN', leftMargin + 300, currentY);
            
            doc.fillColor(colors.text)
               .fontSize(8)
               .font('Helvetica-Bold')
               .text(orderId, leftMargin + 300, currentY + 15);
            
            // ============================================
            // DETALLE DEL SERVICIO - TABLA MODERNA
            // ============================================
            currentY += 50;
            
            doc.fillColor(colors.dark)
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('DETALLE DEL SERVICIO', leftMargin, currentY);
            
            currentY += 28;
            
            // Header de tabla con efecto 3D
            doc.roundedRect(leftMargin + 1, currentY + 1, contentWidth, 30, 6)
               .fill('#00000008');
            
            doc.roundedRect(leftMargin, currentY, contentWidth, 30, 6)
               .fill(colors.bg);
            
            doc.fillColor(colors.textLight)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('DESCRIPCIÓN', leftMargin + 20, currentY + 11)
               .text('CANTIDAD', leftMargin + 340, currentY + 11)
               .text('IMPORTE', leftMargin + 440, currentY + 11);
            
            currentY += 30;
            
            // Fila del servicio con sombra
            doc.roundedRect(leftMargin + 1, currentY + 1, contentWidth, 70, 6)
               .fill('#00000008');
            
            doc.roundedRect(leftMargin, currentY, contentWidth, 70, 6)
               .fillAndStroke(colors.bgCard, colors.border);
            
            currentY += 18;
            
            // Descripción del servicio
            doc.fillColor(colors.dark)
               .fontSize(10)
               .font('Helvetica-Bold')
               .text('Servicio de Intermediación Tecnológica', leftMargin + 20, currentY);
            
            doc.fontSize(8)
               .font('Helvetica')
               .fillColor(colors.textLight)
               .text('Estructuración de datos y acceso a infraestructura digital', 
                     leftMargin + 20, currentY + 16, { width: 300 });
            
            // Cantidad con badge
            const qtyText = credits ? `${credits} créditos` : '1 paquete';
            const qtyBadgeX = leftMargin + 335;
            
            doc.roundedRect(qtyBadgeX, currentY + 3, 90, 24, 5)
               .fill(colors.bg);
            
            doc.fillColor(colors.text)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text(qtyText, qtyBadgeX, currentY + 10, { 
                   width: 90, 
                   align: 'center' 
               });
            
            // Precio destacado
            doc.fillColor(colors.dark)
               .fontSize(13)
               .font('Helvetica-Bold')
               .text(`S/ ${parseFloat(amount).toFixed(2)}`, leftMargin + 435, currentY + 8);
            
            // ============================================
            // RESUMEN DE PAGO CON EFECTO 3D
            // ============================================
            currentY += 90;
            
            const summaryWidth = 200;
            const summaryX = pageWidth - rightMargin - summaryWidth;
            
            // Tarjeta de total con sombra
            doc.roundedRect(summaryX + 3, currentY + 3, summaryWidth, 75, 10)
               .fill('#00000015');
            
            doc.roundedRect(summaryX, currentY, summaryWidth, 75, 10)
               .fill(colors.primary);
            
            // Efecto de brillo superior
            doc.roundedRect(summaryX, currentY, summaryWidth, 35, 10)
               .fill(colors.primaryLight)
               .opacity(0.3);
            
            doc.opacity(1);
            
            doc.fillColor('#dbeafe')
               .fontSize(10)
               .font('Helvetica')
               .text('TOTAL A PAGAR', summaryX + 20, currentY + 18);
            
            doc.fillColor('#ffffff')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text(`S/ ${parseFloat(amount).toFixed(2)}`, summaryX + 20, currentY + 40);
            
            currentY += 80;
            
            // Subtotales con sombra
            doc.roundedRect(summaryX + 2, currentY + 2, summaryWidth, 38, 6)
               .fill('#00000008');
            
            doc.roundedRect(summaryX, currentY, summaryWidth, 38, 6)
               .fillAndStroke(colors.bgCard, colors.border);
            
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica')
               .text('Base imponible:', summaryX + 15, currentY + 10)
               .text('IGV (0%):', summaryX + 15, currentY + 23);
            
            doc.fillColor(colors.text)
               .fontSize(8)
               .font('Helvetica-Bold')
               .text(`S/ ${parseFloat(amount).toFixed(2)}`, summaryX + 120, currentY + 10)
               .text('S/ 0.00', summaryX + 120, currentY + 23);
            
            // ============================================
            // TÉRMINOS Y CONDICIONES CON DISEÑO MODERNO
            // ============================================
            currentY += 60;
            
            doc.fillColor(colors.dark)
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('TÉRMINOS DEL SERVICIO Y CLÁUSULAS LEGALES', leftMargin, currentY);
            
            currentY += 25;
            
            // Altura dinámica para términos
            const termsHeight = 145;
            
            // Tarjeta de términos con sombra
            doc.roundedRect(leftMargin + 2, currentY + 2, contentWidth, termsHeight, 8)
               .fill('#00000008');
            
            doc.roundedRect(leftMargin, currentY, contentWidth, termsHeight, 8)
               .fillAndStroke(colors.warning, colors.warningBorder);
            
            // Borde decorativo superior
            doc.roundedRect(leftMargin, currentY, contentWidth, 8, 8)
               .fill(colors.accent);
            
            doc.rect(leftMargin, currentY + 4, contentWidth, 4)
               .fill(colors.accent);
            
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
            
            let termY = currentY + 15;
            terms.forEach((term, index) => {
                doc.fillColor(colors.warningText)
                   .fontSize(7.5)
                   .font('Helvetica-Bold')
                   .text(`${index + 1}. ${term.title}`, leftMargin + 20, termY);
                
                doc.fillColor('#78350f')
                   .fontSize(7)
                   .font('Helvetica')
                   .text(term.text, leftMargin + 20, termY + 11, { 
                       width: contentWidth - 40 
                   });
                
                termY += 32;
            });
            
            // ============================================
            // FOOTER PROFESIONAL Y CENTRADO
            // ============================================
            currentY += termsHeight + 20;
            
            // Línea divisoria elegante
            doc.moveTo(leftMargin, currentY)
               .lineTo(pageWidth - rightMargin, currentY)
               .lineWidth(1)
               .strokeColor(colors.border)
               .stroke();
            
            currentY += 18;
            
            // Información fiscal del footer
            doc.fillColor(colors.textLight)
               .fontSize(7.5)
               .font('Helvetica-Bold')
               .text('CUBAS PEREZ JOSE RENE | RUC: 10736224351', leftMargin, currentY, { 
                   width: contentWidth, 
                   align: 'center' 
               });
            
            doc.font('Helvetica')
               .text('Domicilio Fiscal: Caserío Pajonal, Cajamarca - Cutervo', 
                     leftMargin, currentY + 13, { 
                   width: contentWidth, 
                   align: 'center' 
               });
            
            doc.text('Actividad: 6399 - Otros Servicios de Información N.C.P.', 
                     leftMargin, currentY + 26, { 
                   width: contentWidth, 
                   align: 'center' 
               });
            
            // Badge de verificación centrado con efecto 3D
            currentY += 48;
            
            const verifyBadgeWidth = 140;
            const verifyBadgeX = (pageWidth - verifyBadgeWidth) / 2;
            
            // Sombra del badge
            doc.roundedRect(verifyBadgeX + 2, currentY + 2, verifyBadgeWidth, 55, 8)
               .fill('#00000010');
            
            // Badge principal
            doc.roundedRect(verifyBadgeX, currentY, verifyBadgeWidth, 55, 8)
               .fillAndStroke(colors.bg, colors.border);
            
            // Ícono de verificación
            doc.roundedRect(verifyBadgeX + (verifyBadgeWidth - 30) / 2, currentY + 8, 30, 16, 4)
               .fill(colors.success);
            
            doc.fillColor('#ffffff')
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('✓', verifyBadgeX, currentY + 10, { 
                   width: verifyBadgeWidth, 
                   align: 'center' 
               });
            
            doc.fillColor(colors.textLight)
               .fontSize(7)
               .font('Helvetica-Bold')
               .text('COMPROBANTE VERIFICADO', verifyBadgeX, currentY + 28, { 
                   width: verifyBadgeWidth, 
                   align: 'center' 
               });
            
            doc.fontSize(6)
               .font('Helvetica')
               .text('Sistema electrónico Consulta PE', verifyBadgeX, currentY + 40, { 
                   width: verifyBadgeWidth, 
                   align: 'center' 
               });
            
            doc.fontSize(5.5)
               .text(`Generado: ${new Date().toLocaleString('es-PE')}`, 
                     verifyBadgeX, currentY + 49, { 
                   width: verifyBadgeWidth, 
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
