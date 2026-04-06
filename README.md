# boamp-mcp

Serveur MCP pour la recherche d'appels d'offres BOAMP (marchés publics français).

## Outils disponibles

| Outil | Description |
|-------|-------------|
| `search_avis` | Recherche par mot-clé avec filtres (département, type, dates) |
| `get_avis` | Détail complet d'un avis par son identifiant |
| `search_by_cpv` | Recherche par code ou libellé CPV |
| `search_by_acheteur` | Recherche par nom d'acheteur ou SIRET |
| `list_recent` | Derniers appels d'offres publiés |
| `get_deadlines` | Appels d'offres dont la date limite approche |

---

## Intégration avec la Docker MCP Gateway

### Prérequis

- Docker Desktop avec l'extension MCP Toolkit installée
- `docker mcp` disponible en ligne de commande

### 1. Build de l'image

```bash
docker build -t boamp-mcp:latest .
```

### 2. Créer un catalog local

Le Docker MCP Gateway découvre les serveurs via des **catalogs** — des fichiers YAML qui décrivent les images disponibles et leurs outils.

Le fichier `catalog.yaml` à la racine du projet contient l'entrée pour boamp-mcp.

Importer ce catalog dans le gateway :

```bash
docker mcp catalog import catalog.yaml
# Le CLI demande un nom : entrer par exemple "boamp-local"
```

Vérifier que le catalog est bien enregistré :

```bash
docker mcp catalog ls
```

### 3. Activer le serveur

```bash
docker mcp server enable boamp-mcp
```

Vérifier que le serveur est actif :

```bash
docker mcp server ls
```

### 4. Redémarrer Claude Desktop

Fermer et rouvrir Claude Desktop pour que le gateway prenne en compte le nouveau serveur.

---

## Notes

- Le serveur utilise le transport **stdio** : le gateway lance le container et communique via stdin/stdout, aucun port réseau n'est exposé.
- L'API BOAMP est publique et ne nécessite pas de clé d'authentification.
- Pour mettre à jour l'image après modification du code : rebuilder avec `docker build` puis redémarrer le gateway.

---

## Développement local (sans Docker)

```bash
npm install
npm run build
npm start
```

Ou avec l'inspecteur MCP :

```bash
npm run inspector
```
