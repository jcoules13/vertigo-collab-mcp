import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supaFetch } from '../supabase.js';
import { callWebhook } from '../webhooks.js';
import { ACTOR_ID } from '../index.js';

export function registerPermanenceTools(server: McpServer) {
  server.tool(
    'list_permanences',
    'Liste les permanences et leurs occurrences planifiées avec les affectations de collaborateurs.',
    {
      date_from: z.string().optional().describe('Date de début (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('Date de fin (YYYY-MM-DD)'),
      actives_seulement: z.boolean().optional().default(true).describe('Inclure uniquement les permanences actives'),
    },
    async ({ date_from, date_to, actives_seulement }) => {
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const from = date_from ?? today;
      const to = date_to ?? future;

      let permQuery = 'permanences?select=id,nom,lieu,jour_semaine,heure_debut,heure_fin,actif';
      if (actives_seulement) permQuery += '&actif=eq.true';

      const permanences = await supaFetch<{ id: string; nom: string; lieu: string }[]>('GET', permQuery);

      const occQuery = `permanence_occurrences?date=gte.${from}&date=lte.${to}&annulee=eq.false&order=date.asc&select=id,permanence_id,date,heure_debut,heure_fin,notes,permanence_assignments(id,statut,collaborateurs(id,nom,prenom,email))`;
      const occurrences = await supaFetch<unknown[]>('GET', occQuery);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ permanences, occurrences }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'manage_permanence',
    'Affecte ou retire un collaborateur d\'une occurrence de permanence. Déclenche les notifications.',
    {
      occurrence_id: z.string().uuid().describe('UUID de l\'occurrence de permanence'),
      collaborateur_id: z.string().uuid().describe('UUID du collaborateur'),
      action: z.enum(['assigner', 'retirer', 'confirmer', 'refuser']).describe('Action à effectuer'),
    },
    async ({ occurrence_id, collaborateur_id, action }) => {
      await callWebhook('collab-permanence-assign', {
        occurrence_id, collaborateur_id, action,
        requested_by: ACTOR_ID,
      });
      return {
        content: [{
          type: 'text' as const,
          text: `Action "${action}" appliquée sur l'occurrence ${occurrence_id} pour le collaborateur ${collaborateur_id}.`,
        }],
      };
    }
  );
}
