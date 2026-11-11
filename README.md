# Budget

Une application de budget personnel toute simple, en français, qui tourne entièrement dans le navigateur.

- **Saisie express** : tape `45,20 metro` puis Entrée. Le montant, la catégorie (Épicerie) et la date sont déduits. `+2100 paie` ajoute un revenu, `hier` ou `3/11` change la date.
- **Import des relevés CSV** : CIBC (comptes et cartes de crédit) et Wealthsimple (relevé mensuel, export d'activités) sont reconnus automatiquement. Les autres banques fonctionnent aussi : si les colonnes ne sont pas devinées, tu les choisis une fois et l'app retient le format.
- **Pas de doublons** : réimporter un relevé qui chevauche le précédent n'ajoute que les nouvelles opérations.
- **Classement automatique** : près de 500 mots-clés de commerces et d'organismes canadiens et québécois sont reconnus d'office (Metro, IGA, Tim Hortons, Hydro-Québec, Vidéotron, STM, SAQ…). Quand tu corriges une catégorie, l'app propose de l'appliquer aux opérations semblables et de s'en souvenir.
- **Enveloppes** : un budget mensuel par catégorie, avec ce qui reste. Le bouton « Proposer selon mes 3 derniers mois » remplit les montants pour toi.
- **Confidentialité** : aucune donnée ne quitte ton navigateur. Pas de serveur, pas de compte, pas de traceur.

## Mettre en ligne sur GitHub Pages (gratuit)

1. Crée un dépôt sur GitHub (par exemple `budget`). Il peut être public : il ne contient que le code, jamais tes données.
2. Envoie ces fichiers dans le dépôt :
   ```bash
   git init
   git add .
   git commit -m "Première version"
   git branch -M main
   git remote add origin https://github.com/TON-NOM/budget.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une minute, l'app est en ligne à `https://TON-NOM.github.io/budget/`.

Sur téléphone, ouvre l'adresse puis « Ajouter à l'écran d'accueil » pour l'utiliser comme une application.

> GitHub Pages est gratuit pour les dépôts publics. Pour un dépôt privé, il faut un forfait GitHub payant.

## Utiliser l'app sur ton ordinateur, sans GitHub

Ouvre simplement `index.html` dans ton navigateur (double-clic). Tout fonctionne hors ligne.

Pour un petit serveur local (recommandé si le navigateur bloque quelque chose) :

```bash
python -m http.server 8080
# puis ouvre http://localhost:8080
```

## Télécharger les relevés CSV

**CIBC** : sur le site Services bancaires CIBC en direct (l'application mobile n'offre pas l'export), choisis le compte ou la carte, puis **Télécharger les transactions**, la période (jusqu'à 13 mois) et le format **CSV**. Le fichier n'a pas de ligne de titres : date, description, débit, crédit, et le numéro de carte masqué pour les cartes de crédit. L'app le reconnaît tel quel.

**Wealthsimple** : sur le site web, dans **Activité** (export CSV), ou dans **Documents** → relevés mensuels → **Télécharger le CSV**. Le relevé mensuel contient les colonnes `date, transaction, description, amount, balance, currency`. Les codes Wealthsimple (`BUY`, `TRFOUT`, `INT`, `DIV`…) servent à classer les placements, transferts et intérêts.

**Autres banques (Desjardins, BMO, RBC, TD, Banque Nationale…)** : cherche « Télécharger » ou « Exporter » dans tes services en ligne et choisis CSV. Point-virgule ou virgule, `1 234,56` ou `1,234.56`, `JJ/MM/AAAA` ou `AAAA-MM-JJ`, une colonne de montant ou deux colonnes retraits/dépôts : tout est géré. Ajuste au besoin dans « Colonnes du fichier ».

Astuce : tu peux glisser-déposer plusieurs fichiers CSV n'importe où sur la page.

## Tes données

Elles sont enregistrées dans le stockage local du navigateur (`localStorage`), sur l'appareil où tu utilises l'app. Conséquences :

- Ton ordinateur et ton téléphone ont chacun leurs propres données.
- Vider les données de navigation du site efface ton budget.

Dans **Réglages**, exporte une sauvegarde (`.json`) régulièrement. Tu peux la restaurer sur un autre appareil ou un autre navigateur. L'export CSV des opérations s'ouvre dans Excel ou Google Sheets.

**Ne mets jamais tes relevés bancaires ni tes sauvegardes dans le dépôt GitHub.** Le fichier `.gitignore` les exclut par précaution (`*.csv` hors du dossier `exemples/`, sauvegardes `budget-sauvegarde-*.json`, dossier `releves/`).

## Structure du projet

```
index.html             Page unique de l'application
css/style.css          Styles (thème clair et sombre automatiques)
js/csv.js              Lecture CSV, montants et dates (tous formats)
js/banks.js            Reconnaissance des formats CIBC, Wealthsimple et générique
js/categories.js       Catégories par défaut, mots-clés des commerces, classement automatique
js/store.js            Enregistrement local et utilitaires de dates
js/charts.js           Graphique revenus et dépenses (SVG, sans bibliothèque)
js/app.js              Interface
exemples/              Relevés fictifs pour essayer l'import
tests/                 Tests des parseurs (node --test)
fonts/                 Police Bricolage Grotesque (licence SIL OFL)
```

Aucune dépendance, aucune étape de compilation : on modifie un fichier, on recharge la page.

## Ajouter ou ajuster

- **Une banque** : ajoute une fonction de détection dans `js/banks.js` (voir `detectCIBC` et `detectWealthsimple`), puis un exemple fictif dans `exemples/` et un test dans `tests/parsers.test.js`.
- **Des commerces** : ajoute des mots-clés dans `RAW_RULES` de `js/categories.js`. Un mot-clé doit apparaître au début d'un mot de la description. Termine-le par une espace pour exiger le mot complet (`'bar '` ne trouve pas « barbier »).
- **Les tests** : `node --test` (Node 18 ou plus récent).

## Idées pour la suite

- Synchroniser entre appareils (fichier de sauvegarde dans un dossier OneDrive ou Google Drive, ou un Gist privé).
- Opérations récurrentes (loyer, abonnements) ajoutées automatiquement chaque mois.
- Fonctionnement hors ligne sur téléphone avec un service worker.
- Import OFX/QFX, que CIBC propose aussi.
