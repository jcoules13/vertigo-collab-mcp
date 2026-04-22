import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { supaFetch } from '../supabase.js';

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function registerExportTools(server: McpServer) {
  server.tool(
    'export_stats',
    'Génère un rapport de statistiques Vertigo Collab. Format "json" retourne les données brutes, "pdf" retourne un PDF en base64.',
    {
      period: z.enum(['7d', '30d', '90d', '365d']).optional().default('30d'),
      format: z.enum(['json', 'pdf']).optional().default('pdf'),
    },
    async ({ period, format }) => {
      const days = parseInt(period);
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);

      const [reservations, rdvs, dossiers, seances, collaborateurs] = await Promise.all([
        supaFetch<{ statut: string; canal: string; date: string }[]>('GET', `reservations_externes?created_at=gte.${from}&select=statut,canal,date`),
        supaFetch<{ date: string }[]>('GET', `rendez_vous?date=gte.${from}&date=lte.${today}&select=date`),
        supaFetch<{ statut: string }[]>('GET', `dossiers_suivi?created_at=gte.${from}&select=statut`),
        supaFetch<{ transcription_status: string }[]>('GET', `seances?date=gte.${from}&select=transcription_status`),
        supaFetch<unknown[]>('GET', 'collaborateurs?actif=eq.true&select=id'),
      ]);

      const resCount = (s: string) => reservations.filter(r => r.statut === s).length;
      const canalCount = (c: string) => reservations.filter(r => r.canal === c).length;

      const stats = {
        period, date_from: from, date_to: today,
        reservations: {
          total: reservations.length,
          nouvelles: resCount('nouvelle'), confirmees: resCount('confirmee'),
          terminees: resCount('terminee'), annulees: resCount('annulee'),
          par_canal: {
            visio: canalCount('visio'), presentiel: canalCount('presentiel'),
            telephone: canalCount('telephone'), autre: canalCount('autre'),
          },
        },
        rdvs_internes: rdvs.length,
        dossiers: {
          total: dossiers.length,
          ouverts: dossiers.filter(d => d.statut === 'ouvert').length,
          en_cours: dossiers.filter(d => d.statut === 'en_cours').length,
          clos: dossiers.filter(d => d.statut === 'clos').length,
        },
        seances: {
          total: seances.length,
          avec_transcription: seances.filter(s => ['ready', 'validated'].includes(s.transcription_status)).length,
        },
        equipe: { collaborateurs_actifs: collaborateurs.length },
      };

      if (format === 'json') {
        return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] };
      }

      // Generate PDF
      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks: Buffer[] = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const teal = '#14B8A6';
        const dark = '#1F2937';
        const gray = '#6B7280';

        // Header
        doc.rect(0, 0, doc.page.width, 80).fill(teal);
        doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
          .text('Vertigo Collab — Rapport d\'activité', 50, 25);
        doc.fontSize(11).font('Helvetica')
          .text(`Période : ${formatDate(from)} → ${formatDate(today)}`, 50, 52);

        doc.fillColor(dark).moveDown(2);

        const section = (title: string) => {
          doc.moveDown(0.5)
            .fontSize(13).font('Helvetica-Bold').fillColor(teal).text(title)
            .moveTo(50, doc.y).lineTo(545, doc.y).stroke(teal)
            .fillColor(dark).fontSize(11).font('Helvetica').moveDown(0.3);
        };

        const row = (label: string, value: string | number) => {
          doc.fontSize(11).fillColor(gray).text(`${label} :`, { continued: true, width: 250 })
            .fillColor(dark).text(` ${value}`);
        };

        // Réservations
        section('Réservations externes');
        row('Total', stats.reservations.total);
        row('Nouvelles', stats.reservations.nouvelles);
        row('Confirmées', stats.reservations.confirmees);
        row('Terminées', stats.reservations.terminees);
        row('Annulées', stats.reservations.annulees);
        doc.moveDown(0.3);
        row('Par canal — Visio', stats.reservations.par_canal.visio);
        row('Par canal — Présentiel', stats.reservations.par_canal.presentiel);
        row('Par canal — Téléphone', stats.reservations.par_canal.telephone);

        // RDV internes
        section('Rendez-vous internes');
        row('RDV organisés', stats.rdvs_internes);

        // Dossiers
        section('Dossiers de suivi');
        row('Total (nouveaux)', stats.dossiers.total);
        row('Ouverts', stats.dossiers.ouverts);
        row('En cours', stats.dossiers.en_cours);
        row('Clos', stats.dossiers.clos);

        // Séances
        section('Séances');
        row('Total', stats.seances.total);
        row('Avec transcription IA', stats.seances.avec_transcription);

        // Équipe
        section('Équipe');
        row('Collaborateurs actifs', stats.equipe.collaborateurs_actifs);

        // Footer
        const footerY = doc.page.height - 40;
        doc.fontSize(9).fillColor(gray)
          .text(`Généré le ${formatDate(today)} par Hermes Agent — Vertigo Collab`, 50, footerY, { align: 'center' });

        doc.end();
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            format: 'pdf',
            encoding: 'base64',
            filename: `vertigo-stats-${period}-${today}.pdf`,
            data: pdfBuffer.toString('base64'),
          }),
        }],
      };
    }
  );
}
