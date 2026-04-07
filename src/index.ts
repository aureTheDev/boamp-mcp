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

// ─── Enriched field extraction ───────────────────────────────────────────────

interface EnrichedFields {
  siret_acheteur?: string;
  contact_email?: string;
  contact_tel?: string;
  url_dossier?: string;
  description?: string;
  duree_mois?: number;
  lieu_execution?: string;
  montant_estime?: number;
  lots?: Array<{ id: string; titre: string; montant?: number }>;
  pme_admis?: boolean;
  reconductions?: number;
  date_debut?: string;
}

// Navigate a dot-notation path in an object
function nav(obj: any, path: string): any {
  return path.split(".").reduce((o: any, k: string) => o?.[k], obj);
}

// Extract text value: handles EFORMS { "#text": "..." } pattern and plain values
function tv(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "object") {
    const t = v["#text"];
    return t !== undefined ? String(t) : undefined;
  }
  return String(v);
}

// Recursively find first occurrence of a key in an object tree
function findFirst(obj: any, key: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findFirst(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

function extractEnrichedFields(donnees: string): EnrichedFields {
  let d: any;
  try { d = JSON.parse(donnees); } catch { return {}; }

  const result: EnrichedFields = {};
  const fn = d?.FNSimple;
  // EFORMS root can be ContractNotice, PriorInformationNotice, ContractAwardNotice, etc.
  const eforms = d?.EFORMS ? (Object.values(d.EFORMS)[0] as any) : null;

  // ── FN Simple ──
  if (fn) {
    result.siret_acheteur = fn?.organisme?.codeIdentificationNational;
    result.contact_email = nav(fn, "initial.communication.nomContact");
    result.contact_tel = nav(fn, "initial.communication.telContact");
    result.url_dossier = nav(fn, "initial.communication.urlDocConsul");
    result.description = nav(fn, "initial.natureMarche.description");
    const dm = nav(fn, "initial.natureMarche.dureeMois");
    if (dm !== undefined) result.duree_mois = Number(dm);
    result.lieu_execution = nav(fn, "initial.natureMarche.lieuExecution");
  }

  // ── EFORMS ──
  if (eforms) {
    // Organization info (SIRET, contact) — nested in efac:Organizations
    const orgsRoot = findFirst(eforms, "efac:Organizations");
    const orgsRaw = orgsRoot?.["efac:Organization"];
    const orgArray: any[] = orgsRaw ? (Array.isArray(orgsRaw) ? orgsRaw : [orgsRaw]) : [];
    const company = orgArray[0]?.["efac:Company"];

    if (!result.siret_acheteur) {
      result.siret_acheteur = tv(company?.["cac:PartyLegalEntity"]?.["cbc:CompanyID"]);
    }
    if (!result.contact_email) {
      result.contact_email = tv(company?.["cac:Contact"]?.["cbc:ElectronicMail"]);
    }
    if (!result.contact_tel) {
      result.contact_tel = tv(company?.["cac:Contact"]?.["cbc:Telephone"]);
    }

    // url_dossier from CallForTendersDocumentReference
    if (!result.url_dossier) {
      const cftdr = findFirst(eforms, "cac:CallForTendersDocumentReference");
      result.url_dossier = tv(cftdr?.["cbc:URI"]);
    }

    // description from top-level ProcurementProject
    if (!result.description) {
      result.description = tv(eforms["cac:ProcurementProject"]?.["cbc:Description"]);
    }

    // duree_mois — DurationMeasure with @unitCode or unitCode (MON/ANN)
    if (!result.duree_mois) {
      const dur = findFirst(eforms, "cbc:DurationMeasure");
      if (dur !== undefined) {
        const val = Number(typeof dur === "object" ? (dur["#text"] ?? dur._) : dur);
        const unit = typeof dur === "object" ? (dur["@unitCode"] ?? dur.unitCode) : undefined;
        if (!isNaN(val)) result.duree_mois = unit === "ANN" ? val * 12 : val;
      }
    }

    // lieu_execution — prefer cac:RealizedLocation, fallback to first city found
    if (!result.lieu_execution) {
      const rl = findFirst(eforms, "cac:RealizedLocation");
      const city = tv(rl?.["cbc:CityName"]) ?? tv(findFirst(eforms, "cbc:CityName"));
      const postal = tv(rl?.["cbc:PostalZone"]) ?? tv(findFirst(eforms, "cbc:PostalZone"));
      if (city) result.lieu_execution = postal ? `${city} ${postal}` : city;
    }

    // montant_estime — top-level RequestedTenderTotal
    const montant = findFirst(eforms, "cbc:EstimatedOverallContractAmount");
    if (montant !== undefined) {
      const val = Number(typeof montant === "object" ? (montant["#text"] ?? montant._) : montant);
      if (!isNaN(val)) result.montant_estime = val;
    }

    // lots
    const lotsRaw = eforms["cac:ProcurementProjectLot"];
    if (lotsRaw) {
      const lotArray: any[] = Array.isArray(lotsRaw) ? lotsRaw : [lotsRaw];
      result.lots = lotArray
        .map((lot: any) => {
          const lotProj = lot["cac:ProcurementProject"];
          const lotMontant = findFirst(lot, "cbc:EstimatedOverallContractAmount");
          const montantVal = lotMontant !== undefined
            ? Number(typeof lotMontant === "object" ? (lotMontant["#text"] ?? lotMontant._) : lotMontant)
            : undefined;
          return {
            id: tv(lot["cbc:ID"]) ?? "",
            titre: tv(lotProj?.["cbc:Name"]) ?? tv(lotProj?.["cbc:Description"]) ?? "",
            montant: montantVal !== undefined && !isNaN(montantVal) ? montantVal : undefined,
          };
        })
        .filter((l) => l.id);
    }

    // pme_admis
    const sme = findFirst(eforms, "cbc:SMESuitableIndicator");
    if (sme !== undefined) {
      result.pme_admis = sme === "true" || sme === true || tv(sme) === "true";
    }

    // reconductions
    const maxRenew = findFirst(eforms, "cbc:MaximumNumberNumeric");
    if (maxRenew !== undefined) {
      const val = Number(typeof maxRenew === "object" ? (maxRenew["#text"] ?? maxRenew._) : maxRenew);
      if (!isNaN(val)) result.reconductions = val;
    }

    // date_debut
    const startDate = findFirst(eforms, "cbc:StartDate");
    if (startDate !== undefined) result.date_debut = tv(startDate) ?? String(startDate);
  }

  return result;
}

function formatEnriched(e: EnrichedFields): string {
  const lines: string[] = [];
  if (e.siret_acheteur) lines.push(`SIRET acheteur: ${e.siret_acheteur}`);
  if (e.contact_email) lines.push(`Contact email: ${e.contact_email}`);
  if (e.contact_tel) lines.push(`Contact tél: ${e.contact_tel}`);
  if (e.url_dossier) lines.push(`URL dossier: ${e.url_dossier}`);
  if (e.description) lines.push(`Description: ${e.description}`);
  if (e.duree_mois !== undefined) lines.push(`Durée: ${e.duree_mois} mois`);
  if (e.lieu_execution) lines.push(`Lieu d'exécution: ${e.lieu_execution}`);
  if (e.montant_estime !== undefined) lines.push(`Montant estimé: ${e.montant_estime.toLocaleString("fr-FR")} €`);
  if (e.lots?.length) {
    lines.push(`Lots (${e.lots.length}):`);
    for (const lot of e.lots) {
      const m = lot.montant !== undefined ? ` — ${lot.montant.toLocaleString("fr-FR")} €` : "";
      lines.push(`  ${lot.id}: ${lot.titre}${m}`);
    }
  }
  if (e.pme_admis !== undefined) lines.push(`PME admis: ${e.pme_admis ? "Oui" : "Non"}`);
  if (e.reconductions !== undefined) lines.push(`Reconductions max: ${e.reconductions}`);
  if (e.date_debut) lines.push(`Date début: ${e.date_debut}`);
  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAvis(a: BoampRecord): string {
  return [
    `ID: ${a.idweb}`,
    `URL: https://www.boamp.fr/avis/detail/${a.idweb}`,
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
  "Récupère le détail d'un avis par son identifiant BOAMP. Par défaut (minimal=true) retourne les champs essentiels enrichis (SIRET, contact, URL dossier, description, durée, lieu, montant, lots). Passer minimal=false pour inclure les données brutes complètes.",
  {
    idweb: z.string().describe("Identifiant de l'avis (ex: 24-123456)"),
    minimal: z.boolean().optional().default(true).describe("Si true (défaut), retourne les champs enrichis clés. Si false, inclut aussi les données brutes complètes."),
  },
  async ({ idweb, minimal }) => {
    const avis = await client.getById(idweb);
    const lines = [
      formatAvis(avis),
      `Nature: ${avis.nature_libelle ?? "N/A"}`,
      `Famille: ${avis.famille_libelle ?? "N/A"}`,
      `Fin diffusion: ${avis.datefindiffusion ?? "N/A"}`,
    ];
    if (avis.donnees) {
      const enriched = extractEnrichedFields(avis.donnees as string);
      const enrichedText = formatEnriched(enriched);
      if (enrichedText) lines.push(`\n--- Données enrichies ---\n${enrichedText}`);
    }
    if (!minimal && avis.donnees) {
      lines.push(`\n--- Données complètes ---\n${JSON.stringify(JSON.parse(avis.donnees as string), null, 2)}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
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
