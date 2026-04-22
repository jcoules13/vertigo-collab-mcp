import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supaFetch } from '../supabase.js';
import { callWebhook } from '../webhooks.js';

export function registerReservationTools(server: McpServer) {
  server.tool(
    'list_reservations',
    'Liste les réservations externes (usagers Google Appointment Scheduler). Filtrables par date, statut et canal.',
    {
      date_from: z.string().optional().describe('Date de début ISO (YYYY-MM-DD). Défaut: aujourd\'hui'),
      date_to: z.string().optional().describe('Date de fin ISO (YYYY-MM-DD). Défaut: +30 jours'),
      statut: z.enum(['nouvelle', 'confirmee', 'annulee', 'terminee']).optional().describe('Filtrer par statut'),
      canal: z.enum(['visio', 'presentiel', 'telephone', 'autre']).optional().describe('Filtrer par canal'),
      limit: z.number().int().min(1).max(200).optional().default(50).describe('Nombre max de résultats'),
    },
    async ({ date_from, date_to, statut, canal, limit }) => {
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const from = date_from ?? today;
      const to = date_to ?? future;

      let query = `reservations_externes?date=gte.${from}&date=lte.${to}&order=date.asc,heure_debut.asc&limit=${limit}&select=id,usager_nom,usager_email,usager_telephone,canal,titre,date,heure_debut,heure_fin,lieu,statut,notes_admin,created_at`;
      if (statut) query += `&statut=eq.${statut}`;
      if (canal) query += `&canal=eq.${canal}`;

      const rows = await supaFetch<unknown[]>('GET', query);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: rows.length, reservations: rows }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_reservation',
    'Récupère le détail complet d\'une réservation externe par son ID.',
    {
      id: z.string().uuid().describe('UUID de la réservation'),
    },
    async ({ id }) => {
      const rows = await supaFetch<unknown[]>('GET', `reservations_externes?id=eq.${id}&select=*`);
      if (!rows.length) throw new Error(`Réservation ${id} introuvable`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(rows[0], null, 2) }],
      };
    }
  );

  server.tool(
    'manage_reservation',
    'Confirme, annule ou marque comme terminée une réservation externe. Déclenche le webhook n8n pour les notifications.',
    {
      id: z.string().uuid().describe('UUID de la réservation'),
      action: z.enum(['confirmer', 'annuler', 'terminer']).describe('Action à effectuer'),
      notes_admin: z.string().optional().describe('Note interne optionnelle'),
    },
    async ({ id, action, notes_admin }) => {
      const statutMap: Record<string, string> = {
        confirmer: 'confirmee',
        annuler: 'annulee',
        terminer: 'terminee',
      };
      const body: Record<string, string> = {
        statut: statutMap[action],
        updated_at: new Date().toISOString(),
      };
      if (notes_admin) body.notes_admin = notes_admin;
      if (action === 'annuler') body.cancelled_at = new Date().toISOString();
      if (action === 'confirmer') body.confirmed_at = new Date().toISOString();

      await supaFetch('PATCH', `reservations_externes?id=eq.${id}`, {
        prefer: 'return=minimal',
        body,
      });

      await callWebhook('collab-reservation-manage', { id, action, notes_admin });

      return {
        content: [{ type: 'text' as const, text: `Réservation ${id} → statut "${statutMap[action]}" appliqué.` }],
      };
    }
  );
}
