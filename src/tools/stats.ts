import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supaFetch } from '../supabase.js';

export function registerStatsTools(server: McpServer) {
  server.tool(
    'get_stats',
    'Retourne des statistiques agrégées sur l\'activité Vertigo Collab pour une période donnée.',
    {
      period: z.enum(['7d', '30d', '90d', '365d']).optional().default('30d').describe('Période d\'analyse'),
    },
    async ({ period }) => {
      const days = parseInt(period);
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);

      const [reservations, rdvs, dossiers, seances] = await Promise.all([
        supaFetch<{ statut: string }[]>('GET', `reservations_externes?created_at=gte.${from}&select=statut`),
        supaFetch<unknown[]>('GET', `rendez_vous?date=gte.${from}&date=lte.${today}&select=id`),
        supaFetch<{ statut: string }[]>('GET', `dossiers_suivi?created_at=gte.${from}&select=statut`),
        supaFetch<{ transcription_status: string }[]>('GET', `seances?date=gte.${from}&select=transcription_status`),
      ]);

      const resCount = (s: string) => reservations.filter(r => r.statut === s).length;
      const dosCount = (s: string) => dossiers.filter(d => d.statut === s).length;

      const stats = {
        period,
        date_from: from,
        date_to: today,
        reservations: {
          total: reservations.length,
          nouvelles: resCount('nouvelle'),
          confirmees: resCount('confirmee'),
          terminees: resCount('terminee'),
          annulees: resCount('annulee'),
        },
        rdvs_internes: rdvs.length,
        dossiers: {
          total: dossiers.length,
          ouverts: dosCount('ouvert'),
          en_cours: dosCount('en_cours'),
          clos: dosCount('clos'),
        },
        seances: {
          total: seances.length,
          avec_transcription: seances.filter(s => s.transcription_status === 'ready' || s.transcription_status === 'validated').length,
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }],
      };
    }
  );
}
