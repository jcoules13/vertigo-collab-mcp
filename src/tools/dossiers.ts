import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supaFetch } from '../supabase.js';
import { ACTOR_ID } from '../index.js';

export function registerDossierTools(server: McpServer) {
  server.tool(
    'list_dossiers',
    'Liste les dossiers de suivi usagers avec recherche par nom ou email.',
    {
      statut: z.enum(['ouvert', 'en_cours', 'clos']).optional().describe('Filtrer par statut du dossier'),
      search: z.string().optional().describe('Recherche textuelle sur nom, prénom ou email usager'),
      limit: z.number().int().min(1).max(100).optional().default(30),
    },
    async ({ statut, search, limit }) => {
      let query = `dossiers_suivi?order=created_at.desc&limit=${limit}&select=id,usager_nom,usager_prenom,usager_email,usager_telephone,statut,motif,created_at,responsable_id,collaborateurs!dossiers_suivi_responsable_id_fkey(nom,prenom)`;
      if (statut) query += `&statut=eq.${statut}`;
      if (search) {
        const s = encodeURIComponent(`%${search}%`);
        query += `&or=(usager_nom.ilike.${s},usager_prenom.ilike.${s},usager_email.ilike.${s})`;
      }

      const rows = await supaFetch<unknown[]>('GET', query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ count: rows.length, dossiers: rows }, null, 2) }],
      };
    }
  );

  server.tool(
    'get_dossier',
    'Récupère le dossier complet d\'un usager (toutes les sections : identité, situation, droits, objectifs, séances).',
    {
      id: z.string().uuid().optional().describe('UUID du dossier'),
      email: z.string().email().optional().describe('Email de l\'usager (alternative à id)'),
    },
    async ({ id, email }) => {
      if (!id && !email) throw new Error('Fournir id ou email');

      let query = 'dossiers_suivi?select=*,seances(id,date,resume,actions_prevues,transcription_status,validated_at),reservations_externes!dossier_reservations(id,date,heure_debut,heure_fin,statut,canal)';
      if (id) query += `&id=eq.${id}`;
      else query += `&usager_email=eq.${encodeURIComponent(email!)}`;
      query += '&limit=1';

      const rows = await supaFetch<unknown[]>('GET', query);
      if (!rows.length) throw new Error(`Dossier introuvable pour ${id ?? email}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(rows[0], null, 2) }],
      };
    }
  );

  server.tool(
    'update_dossier',
    'Met à jour des champs d\'un dossier de suivi. Seuls les champs fournis sont modifiés.',
    {
      id: z.string().uuid().describe('UUID du dossier'),
      fields: z.record(z.unknown()).describe(
        'Objet avec les champs à mettre à jour. Ex: { "statut": "en_cours", "notes": "...", "objectifs": [...] }'
      ),
    },
    async ({ id, fields }) => {
      const body = { responsable_id: ACTOR_ID, ...fields, updated_at: new Date().toISOString() };
      await supaFetch('PATCH', `dossiers_suivi?id=eq.${id}`, {
        prefer: 'return=minimal',
        body,
      });
      return {
        content: [{ type: 'text' as const, text: `Dossier ${id} mis à jour (${Object.keys(fields).join(', ')}).` }],
      };
    }
  );

  server.tool(
    'create_seance',
    'Crée une nouvelle note de séance associée à un dossier.',
    {
      dossier_id: z.string().uuid().describe('UUID du dossier de suivi'),
      date: z.string().describe('Date de la séance (YYYY-MM-DD)'),
      resume: z.string().min(1).describe('Résumé de la séance'),
      actions_prevues: z.string().optional().describe('Actions prévues suite à cette séance'),
      reservation_id: z.string().uuid().optional().describe('UUID de la réservation liée (optionnel)'),
    },
    async ({ dossier_id, date, resume, actions_prevues, reservation_id }) => {
      const body: Record<string, unknown> = {
        dossier_id, date, resume,
        transcription_status: 'none',
        consent_enregistrement: false,
      };
      if (actions_prevues) body.actions_prevues = actions_prevues;
      if (reservation_id) body.reservation_id = reservation_id;

      const rows = await supaFetch<{ id: string }[]>('POST', 'seances', {
        prefer: 'return=representation',
        body,
      });
      const newId = rows[0]?.id;
      return {
        content: [{ type: 'text' as const, text: `Séance créée (ID: ${newId}) pour le dossier ${dossier_id} le ${date}.` }],
      };
    }
  );
}
