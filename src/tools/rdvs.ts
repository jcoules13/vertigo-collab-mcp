import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supaFetch } from '../supabase.js';
import { callWebhook } from '../webhooks.js';

export function registerRdvTools(server: McpServer) {
  server.tool(
    'list_rdvs',
    'Liste les rendez-vous internes (RDV entre collaborateurs). Inclut les participants.',
    {
      date_from: z.string().optional().describe('Date de début ISO (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('Date de fin ISO (YYYY-MM-DD)'),
      limit: z.number().int().min(1).max(100).optional().default(30),
    },
    async ({ date_from, date_to, limit }) => {
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const from = date_from ?? today;
      const to = date_to ?? future;

      const rows = await supaFetch<unknown[]>(
        'GET',
        `rendez_vous?date=gte.${from}&date=lte.${to}&order=date.asc,heure_debut.asc&limit=${limit}&select=id,titre,description,date,heure_debut,heure_fin,lieu,google_calendar_event_id,rdv_participants(id,statut,collaborateur_id,collaborateurs(nom,prenom,email))`
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ count: rows.length, rdvs: rows }, null, 2) }],
      };
    }
  );

  server.tool(
    'create_rdv',
    'Crée un nouveau rendez-vous interne. Déclenche automatiquement les notifications email et la sync Google Calendar.',
    {
      titre: z.string().min(1).describe('Titre du rendez-vous'),
      date: z.string().describe('Date ISO (YYYY-MM-DD)'),
      heure_debut: z.string().describe('Heure de début HH:MM'),
      heure_fin: z.string().describe('Heure de fin HH:MM'),
      participants: z.array(z.string().uuid()).min(1).describe('Liste des UUIDs des collaborateurs participants'),
      lieu: z.string().optional().describe('Lieu du rendez-vous'),
      description: z.string().optional().describe('Description ou ordre du jour'),
    },
    async ({ titre, date, heure_debut, heure_fin, participants, lieu, description }) => {
      await callWebhook('collab-rdv-create', {
        titre, date, heure_debut, heure_fin,
        participants, lieu, description,
      });
      return {
        content: [{
          type: 'text' as const,
          text: `RDV "${titre}" le ${date} de ${heure_debut} à ${heure_fin} créé. Notifications et sync GCal en cours.`,
        }],
      };
    }
  );
}
