#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BoampClient } from "./boamp-client.js";
import { BoampRecord } from "./types.js";

const client = new BoampClient();

const server = new McpServer({
  name: "boamp-mcp",
  version: "1.0.0",
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAvis(a: BoampRecord): string {
  return [
    `ID: ${a.idweb}`,
    `Objet: ${a.objet ?? "N/A"}`,
    `Acheteur: ${a.nomacheteur ?? "N/A"}`,
    `Département: ${a.code_departement ?? "N/A"}`,
    `Type: ${a.type_marche_facette ?? "N/A"}`,
    `Procédure: ${a.procedure_libelle ?? "N/A"}`,
    `Publication: ${a.dateparution ?? "N/A"}`,
    `Limite réponse: ${a.datelimitereponse ?? "N/A"}`,
    `CPV: ${a.descripteur_libelle ?? "N/A"}`,
  ].join("\n");
}

function formatList(results: BoampRecord[], total: number): string {
  if (!results.length) return "Aucun avis trouvé.";
  const items = results.map((a, i) => `--- [${i + 1}] ---\n${formatAvis(a)}`);
  return `${total} avis trouvés (affichage: ${results.length})\n\n${items.join("\n\n")}`;
}

// ─── Tools ──────────────────────────────────────────────────────────────────

server.tool(
  "search_avis",
  "Recherche des appels d'offres BOAMP par mot-clé avec filtres avancés",
  {
    keywords: z.string().describe("Mots-clés à rechercher dans l'objet et les descripteurs"),
    departments: z.array(z.string()).optional().describe("Codes départements (ex: ['75', '69'])"),
    type: z.enum(["SERVICES", "TRAVAUX", "FOURNITURES"]).optional().describe("Type de marché"),
    date_from: z.string().optional().describe("Date de début de publication (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("Date de fin de publication (YYYY-MM-DD)"),
    limit: z.number().min(1).max(100).optional().describe("Nombre de résultats (défaut: 20)"),
    offset: z.number().optional().describe("Pagination (défaut: 0)"),
  },
  async ({ keywords, departments, type, date_from, date_to, limit, offset }) => {
    const data = await client.search({ keywords, departments, type, date_from, date_to, limit, offset });
    return { content: [{ type: "text", text: formatList(data.results, data.total_count) }] };
  }
);

server.tool(
  "get_avis",
  "Récupère le détail complet d'un avis par son identifiant BOAMP",
  {
    idweb: z.string().describe("Identifiant de l'avis (ex: 24-123456)"),
  },
  async ({ idweb }) => {
    const avis = await client.getById(idweb);
    const detail = [
      formatAvis(avis),
      `\nNature: ${avis.nature_libelle ?? "N/A"}`,
      `Famille: ${avis.famille_libelle ?? "N/A"}`,
      `Fin diffusion: ${avis.datefindiffusion ?? "N/A"}`,
      avis.donnees ? `\n--- Données complètes ---\n${JSON.stringify(JSON.parse(avis.donnees as string), null, 2)}` : "",
    ].join("\n");
    return { content: [{ type: "text", text: detail }] };
  }
);

server.tool(
  "search_by_cpv",
  "Recherche des appels d'offres par code ou libellé CPV",
  {
    cpv: z.string().describe("Code CPV ou libellé (ex: '45000000' ou 'travaux de construction')"),
    departments: z.array(z.string()).optional(),
    limit: z.number().min(1).max(100).optional(),
  },
  async ({ cpv, departments, limit }) => {
    const data = await client.search({ cpv, departments, limit });
    return { content: [{ type: "text", text: formatList(data.results, data.total_count) }] };
  }
);

server.tool(
  "search_by_acheteur",
  "Recherche des appels d'offres publiés par un acheteur spécifique",
  {
    acheteur: z.string().optional().describe("Nom de l'acheteur"),
    siret: z.string().optional().describe("SIRET de l'acheteur"),
    limit: z.number().min(1).max(100).optional(),
  },
  async ({ acheteur, siret, limit }) => {
    if (!acheteur && !siret) throw new Error("Fournir au moins 'acheteur' ou 'siret'");
    const data = await client.search({ acheteur, siret, limit });
    return { content: [{ type: "text", text: formatList(data.results, data.total_count) }] };
  }
);

server.tool(
  "list_recent",
  "Liste les derniers appels d'offres publiés récemment",
  {
    limit: z.number().min(1).max(100).optional().describe("Nombre de résultats (défaut: 20)"),
    type: z.enum(["SERVICES", "TRAVAUX", "FOURNITURES"]).optional(),
    departments: z.array(z.string()).optional(),
  },
  async ({ limit, type, departments }) => {
    const data = await client.search({ limit, type, departments, order_by: "dateparution DESC" });
    return { content: [{ type: "text", text: formatList(data.results, data.total_count) }] };
  }
);

server.tool(
  "get_deadlines",
  "Liste les appels d'offres dont la date limite de réponse approche",
  {
    days: z.number().min(1).max(90).describe("Nombre de jours à venir (ex: 7 pour les 7 prochains jours)"),
  },
  async ({ days }) => {
    const data = await client.getDeadlines(days);
    return {
      content: [
        {
          type: "text",
          text: data.results.length
            ? formatList(data.results, data.total_count)
            : `Aucun avis avec une échéance dans les ${days} prochains jours.`,
        },
      ],
    };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[boamp-mcp] Server started");
}

main().catch((err) => {
  console.error("[boamp-mcp] Fatal error:", err);
  process.exit(1);
});
