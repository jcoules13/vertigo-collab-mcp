import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supaFetch } from '../supabase.js';

export function registerCollaborateurTools(server: McpServer) {
  server.tool(
    'list_collaborateurs',
    'Liste les collaborateurs actifs de l\'équipe Vertigo avec leur rôle.',
    {
      role: z.enum(['admin', 'membre_actif', 'benevole']).optional().describe('Filtrer par rôle'),
      actifs_seulement: z.boolean().optional().default(true),
    },
    async ({ role, actifs_seulement }) => {
      let query = 'collaborateurs?select=id,nom,prenom,email,telephone,role_asso,actif,avatar_url&order=nom.asc';
      if (actifs_seulement) query += '&actif=eq.true';
      if (role) query += `&role_asso=eq.${role}`;

      const rows = await supaFetch<unknown[]>('GET', query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ count: rows.length, collaborateurs: rows }, null, 2) }],
      };
    }
  );
}
