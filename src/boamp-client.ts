import axios, { AxiosInstance } from "axios";
import { BoampApiResponse, BoampRecord, SearchParams } from "./types.js";

const BOAMP_API_URL =
  "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";

export class BoampClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({ baseURL: BOAMP_API_URL });
  }

  async search(params: SearchParams): Promise<BoampApiResponse> {
    const conditions: string[] = [];

    if (params.keywords) {
      conditions.push(
        `(objet LIKE '%${params.keywords}%' OR descripteur_libelle LIKE '%${params.keywords}%' OR donnees LIKE '%${params.keywords}%')`
      );
    }

    if (params.cpv) {
      conditions.push(`descripteur_libelle LIKE '%${params.cpv}%'`);
    }

    if (params.acheteur) {
      conditions.push(`nomacheteur LIKE '%${params.acheteur}%'`);
    }

    if (params.siret) {
      conditions.push(`siret="${params.siret}"`);
    }

    if (params.departments && params.departments.length > 0) {
      const deptCond = params.departments
        .map((d) => `code_departement="${d}"`)
        .join(" OR ");
      conditions.push(`(${deptCond})`);
    }

    if (params.date_from) {
      conditions.push(`dateparution >= date'${params.date_from}'`);
    }

    if (params.date_to) {
      conditions.push(`dateparution <= date'${params.date_to}'`);
    }

    const query: Record<string, unknown> = {
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
      order_by: params.order_by ?? "dateparution DESC",
    };

    if (conditions.length > 0) {
      query.where = conditions.join(" AND ");
    }

    if (params.type) {
      query.refine = `type_marche_facette:${params.type}`;
    }

    if (params.procedure) {
      query.refine = `procedure_libelle:${params.procedure}`;
    }

    const response = await this.http.get<BoampApiResponse>("", { params: query });
    return response.data;
  }

  async getById(idweb: string): Promise<BoampRecord> {
    const response = await this.http.get<BoampApiResponse>("", {
      params: { where: `idweb="${idweb}"`, limit: 1 },
    });

    if (!response.data.results?.length) {
      throw new Error(`Avis non trouvé : ${idweb}`);
    }

    return response.data.results[0];
  }

  async getDeadlines(days: number): Promise<BoampApiResponse> {
    const today = new Date().toISOString().split("T")[0];
    const future = new Date(Date.now() + days * 86400000)
      .toISOString()
      .split("T")[0];

    return this.search({
      limit: 50,
      order_by: "datelimitereponse ASC",
    }).then(async () => {
      const response = await this.http.get<BoampApiResponse>("", {
        params: {
          where: `datelimitereponse >= date'${today}' AND datelimitereponse <= date'${future}'`,
          order_by: "datelimitereponse ASC",
          limit: 50,
        },
      });
      return response.data;
    });
  }
}
