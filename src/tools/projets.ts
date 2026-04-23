import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supaFetch } from '../supabase.js';
import { ACTOR_ID } from '../index.js';

export function registerProjetTools(server: McpServer) {
  server.tool(
    'list_projets',
    'Liste les projets de gestion. Filtrables par statut.',
    {
      statut: z.enum(['en_preparation', 'actif', 'suspendu', 'clos', 'archive']).optional()
        .describe('Filtrer par statut du projet'),
      limit: z.number().int().min(1).max(100).optional().default(50),
    },
    async ({ statut, limit }) => {
      let query = `projets?order=updated_at.desc&limit=${limit}&select=id,nom,reference,type_projet,statut,description,date_debut,date_fin_prevue,budget_previsionnel,tags,created_at,updated_at,responsable:collaborateurs!responsable_id(prenom,nom)`;
      if (statut) query += `&statut=eq.${statut}`;
      const rows = await supaFetch<unknown[]>('GET', query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ count: rows.length, projets: rows }, null, 2) }],
      };
    }
  );

  server.tool(
    'get_projet',
    'Récupère un projet complet avec toutes ses sections : infos, membres, partenaires, financements, dépenses, jalons, tâches, documents, notes.',
    {
      id: z.string().uuid().describe('UUID du projet'),
    },
    async ({ id }) => {
      const rows = await supaFetch<unknown[]>('GET',
        `projets?id=eq.${id}&limit=1&select=*,` +
        `responsable:collaborateurs!responsable_id(prenom,nom),` +
        `projet_membres(*,collaborateurs(prenom,nom,email)),` +
        `projet_partenaires(*),` +
        `projet_financements(*),` +
        `projet_depenses(*),` +
        `projet_jalons(*),` +
        `projet_taches(*,collaborateurs(prenom,nom)),` +
        `projet_notes(*,collaborateurs(prenom,nom)),` +
        `projet_dossiers(*,dossiers_suivi(usager_nom,usager_prenom,usager_email,statut))`
      );
      if (!(rows as any[]).length) throw new Error(`Projet ${id} introuvable`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(rows[0], null, 2) }],
      };
    }
  );

  server.tool(
    'create_projet',
    'Crée un nouveau projet.',
    {
      nom: z.string().min(1).describe('Nom du projet'),
      type_projet: z.enum(['partenariat', 'programme_finance', 'action_collective', 'formation', 'evenement', 'interne'])
        .optional().default('interne').describe('Type de projet'),
      description: z.string().optional().describe('Description générale'),
      objectifs: z.string().optional().describe('Objectifs et résultats attendus'),
      date_debut: z.string().optional().describe('Date de début (YYYY-MM-DD)'),
      date_fin_prevue: z.string().optional().describe('Date de fin prévue (YYYY-MM-DD)'),
      budget_previsionnel: z.number().optional().describe('Budget prévisionnel en euros'),
      reference: z.string().optional().describe('Code / référence interne'),
    },
    async ({ nom, type_projet, description, objectifs, date_debut, date_fin_prevue, budget_previsionnel, reference }) => {
      const rows = await supaFetch<{ id: string }[]>('POST', 'projets', {
        prefer: 'return=representation',
        body: {
          nom, type_projet, description: description ?? null, objectifs: objectifs ?? null,
          date_debut: date_debut ?? null, date_fin_prevue: date_fin_prevue ?? null,
          budget_previsionnel: budget_previsionnel ?? null, reference: reference ?? null,
          responsable_id: ACTOR_ID || null, cree_par: ACTOR_ID || null,
        },
      });
      const newId = (rows as any[])[0]?.id;
      return {
        content: [{ type: 'text' as const, text: `Projet "${nom}" créé avec succès (ID: ${newId}).` }],
      };
    }
  );

  server.tool(
    'update_projet',
    'Met à jour les champs d\'un projet (infos, statut, dates, budget, etc.). Seuls les champs fournis sont modifiés.',
    {
      id: z.string().uuid().describe('UUID du projet'),
      fields: z.record(z.unknown()).describe(
        'Champs à mettre à jour. Ex: { "statut": "actif", "description": "...", "date_cloture": "2026-12-31" }'
      ),
    },
    async ({ id, fields }) => {
      const body = { ...fields, updated_at: new Date().toISOString() };
      await supaFetch('PATCH', `projets?id=eq.${id}`, { prefer: 'return=minimal', body });
      return {
        content: [{ type: 'text' as const, text: `Projet ${id} mis à jour (${Object.keys(fields).join(', ')}).` }],
      };
    }
  );

  server.tool(
    'add_projet_note',
    'Ajoute une note dans le journal d\'un projet. La note est attribuée à Louis Sakho.',
    {
      projet_id: z.string().uuid().describe('UUID du projet'),
      contenu: z.string().min(1).describe('Contenu de la note'),
    },
    async ({ projet_id, contenu }) => {
      const rows = await supaFetch<{ id: string }[]>('POST', 'projet_notes', {
        prefer: 'return=representation',
        body: { projet_id, contenu, auteur_id: ACTOR_ID || null },
      });
      const newId = (rows as any[])[0]?.id;
      return {
        content: [{ type: 'text' as const, text: `Note ajoutée au projet ${projet_id} (ID note: ${newId}).` }],
      };
    }
  );
}
