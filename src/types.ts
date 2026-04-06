export interface BoampRecord {
  idweb: string;
  objet: string;
  dateparution: string;
  datelimitereponse: string;
  datefindiffusion: string;
  nomacheteur: string;
  code_departement: string;
  procedure_libelle: string;
  nature_libelle: string;
  type_marche_facette: string;
  descripteur_libelle: string;
  famille_libelle: string;
  donnees: string;
  [key: string]: unknown;
}

export interface BoampApiResponse {
  total_count: number;
  results: BoampRecord[];
}

export interface SearchParams {
  keywords?: string;
  cpv?: string;
  acheteur?: string;
  siret?: string;
  departments?: string[];
  type?: "SERVICES" | "TRAVAUX" | "FOURNITURES";
  procedure?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
  order_by?: string;
}
