# StrategicTradingRoom — guida alla pubblicazione online

Questa è la versione multi-utente della piattaforma: ognuno crea un proprio account (email + password) e vede solo i propri dati, salvati in modo permanente su un database vero — non più nel browser.

**Cosa userai, entrambi gratuiti:**
- **Neon** → il database (Postgres, gratuito per sempre, nessuna scadenza)
- **Render** → il server che fa girare la piattaforma (gratuito, con un piccolo limite spiegato sotto)
- **GitHub** → dove vive il codice, collegato a Render per il deploy automatico

Tempo stimato: 20-30 minuti la prima volta.

---

## 1. Crea il repository su GitHub

1. Vai su [github.com](https://github.com) e crea un account se non ce l'hai già
2. Clicca **New repository** (in alto a destra, "+")
3. Dagli un nome (es. `strategictradingroom`), lascialo **Private** se preferisci che il codice non sia pubblico, poi **Create repository**
4. Segui le istruzioni di GitHub per caricare questa cartella nel repository appena creato (di solito è: `git init`, `git add .`, `git commit -m "prima versione"`, poi i comandi `git remote add origin ...` e `git push` che GitHub ti mostra dopo aver creato il repository)

**Importante**: il file `.env` (quello con le password vere) è già escluso dal caricamento tramite `.gitignore` — non finirà mai su GitHub. Solo `.env.example` (senza valori reali) viene caricato, come guida.

---

## 2. Crea il database su Neon

1. Vai su [neon.tech](https://neon.tech) e registrati (gratis, non serve carta di credito)
2. Crea un nuovo progetto (es. `strategictradingroom`)
3. Nella dashboard del progetto trovi la **Connection string** — un indirizzo che inizia con `postgresql://...`. Copiala, ti servirà tra poco
4. Apri il file `server/schema.sql` di questo progetto: dovrai eseguirlo sul database Neon per creare le tabelle. Il modo più semplice: nella dashboard Neon c'è un **SQL Editor** — incolla lì dentro tutto il contenuto di `schema.sql` ed eseguilo. In alternativa, dal tuo computer con Node già installato: crea un file `.env` in questa cartella con `DATABASE_URL=` seguito dalla stringa copiata sopra, poi esegui `npm install` e `npm run migrate`

---

## 3. Metti online il server su Render

1. Vai su [render.com](https://render.com) e registrati con il tuo account GitHub (è il modo più rapido: autorizza Render ad accedere ai tuoi repository)
2. Dalla dashboard, clicca **New +** → **Web Service**
3. Seleziona il repository `strategictradingroom` appena creato
4. Configura così:
   - **Name**: quello che preferisci (diventerà parte dell'indirizzo pubblico)
   - **Region**: la più vicina a te
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. Prima di confermare, aggiungi le **Environment Variables** (variabili d'ambiente) — le trovi in una sezione dedicata nella stessa pagina:
   - `DATABASE_URL` → incolla la stringa di connessione copiata da Neon
   - `SESSION_SECRET` → una stringa lunga e casuale (puoi generarla su [randomkeygen.com](https://randomkeygen.com) o con il comando indicato in `.env.example`)
   - `NODE_ENV` → `production`
6. Clicca **Create Web Service**. Render inizia a costruire e avviare la piattaforma — ci vogliono un paio di minuti

Al termine, Render ti dà un indirizzo pubblico tipo `https://strategictradingroom.onrender.com` — è il link da condividere con chi vuoi che usi la piattaforma.

---

## 4. Prima apertura

Apri l'indirizzo che Render ti ha dato: vedrai la schermata di login/registrazione. Ogni persona con cui condividi il link crea il proprio account (email + password) e da quel momento vede solo i propri dati — completamente separati da quelli di chiunque altro usi la stessa piattaforma.

---

## Limiti onesti da conoscere

- **Il server gratuito di Render "si addormenta"** dopo 15 minuti senza visite, e la prima persona che riapre il link dopo una pausa aspetta 30-60 secondi prima che la pagina risponda (poi torna veloce). Non è un errore, è il comportamento normale del piano gratuito — se diventa un problema, la soluzione è passare al piano a pagamento di Render (circa 7$/mese) per tenerlo sempre acceso
- **Il database Neon gratuito ha un limite di spazio** (qualche GB), più che sufficiente per migliaia di operazioni di trading — non dovrebbe essere un problema nell'uso normale
- **Le password sono salvate in modo sicuro** (mai in chiaro, sempre cifrate con bcrypt), ma questa rimane un'infrastruttura gratuita/hobbistica: va benissimo per condividerla con amici o un piccolo gruppo, non è pensata per gestire dati finanziari sensibili su larga scala o con obblighi normativi

## Aggiornare la piattaforma in futuro

Ogni volta che modifichi il codice e fai `git push` su GitHub, Render se ne accorge da solo e ripubblica automaticamente la nuova versione — non serve rifare la configurazione.
