# Budsjett

Privat app for å føre privatøkonomien. Hurtigregistrering av kjøp, transaksjonslogg, kategorier og en oversikt over måneden.

Appen er helt adskilt fra Dialr: eget repo, egen Supabase-database, egne brukere. Ingen DNS endres og ingenting i Dialr røres.

## Slik henger det sammen

```
Telefon / PC  ──>  GitHub Pages (statisk app, gratis)
                        │
                        └──>  Supabase (eget prosjekt, gratis)
                              innlogging + tofaktor + Postgres med Row Level Security
```

Appen er statisk. All beskyttelse ligger i databasen:

- Ingen åpen registrering. Den eneste brukeren er den du oppretter selv.
- Tofaktor er påkrevd. Databasen gir ingen data til en økt som ikke har bekreftet tofaktorkode (`aal2`), selv med riktig passord.
- Row Level Security på alle tabeller. Anonyme får ingen tilgang i det hele tatt.
- Nøkkelen i appen er den offentlige anon/publishable-nøkkelen. Den gir ingenting uten innlogging. Deploy stopper hvis du ved et uhell legger inn den hemmelige nøkkelen.
- Appen caches for offline-start, men økonomidata lagres aldri i cachen.
- Siden er merket `noindex`, så den dukker ikke opp i søk. Det er ikke en sikkerhetsmekanisme, bare ryddig.

Koden ligger offentlig (gratis GitHub Pages krever det), men dataene dine ligger bare i Supabase.

## Oppsett, steg for steg

### 1. Supabase

1. Lag et **nytt** prosjekt på supabase.com (ikke bruk Dialr sitt). Region: Stockholm (`eu-north-1`) eller Frankfurt.
2. **SQL Editor** > lim inn hele `supabase/migrations/0001_fase1.sql` > Run.
3. **Authentication > Sign In / Providers**: slå av *Allow new users to sign up*. La *Email* være på.
4. **Authentication > Users > Add user > Create new user**: skriv e-post og et langt passord, huk av *Auto Confirm User*. Husholdning, konto og standardkategorier lages automatisk.
5. **Project Settings > API** (eller *Connect*): kopier *Project URL* og den offentlige nøkkelen (`anon` eller `publishable`). Aldri `service_role` eller `secret`.

Tofaktor med autentiseringsapp (TOTP) er på som standard i Supabase. Første gang du logger inn blir du bedt om å sette det opp.

### 2. GitHub

1. Lag et nytt repo som heter `budsjett` og push denne mappen dit.
2. **Settings > Pages > Source**: velg *GitHub Actions*.
3. **Settings > Secrets and variables > Actions > Variables**: legg inn
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Push til `main`. Testene kjøres, og appen publiseres på `https://<brukernavn>.github.io/budsjett/`.

### 3. Backup (anbefalt)

Gratisplanen i Supabase har ikke automatisk backup, og prosjekter pauses etter en uke uten bruk. Workflowen `Nattlig backup` løser begge deler.

Under **Settings > Secrets and variables > Actions > Secrets**:

- `SUPABASE_DB_URL`: fra Supabase *Connect* > *Session pooler* (IPv4). Bytt ut `[YOUR-PASSWORD]` med databasepassordet.
- `BACKUP_PASSPHRASE`: en lang, tilfeldig frase. Lagre den i passordbehandleren din. Uten den kan ingen backup åpnes, heller ikke av deg.

Backupen krypteres med AES-256 før den lagres som artefakt i 30 dager. Kjør den gjerne manuelt én gang fra *Actions* for å sjekke at den virker.

Merk: GitHub skrur av planlagte workflows etter 60 dager uten aktivitet i repoet. Du får en e-post, og da er det bare å trykke *Enable workflow*.

**Gjenopprette** (laster ned artefakten fra Actions først):

```sh
gpg --decrypt budsjett-2026-10-21.dump.gpg > budsjett.dump
pg_restore --clean --if-exists --no-owner --no-privileges --schema=public -d "$SUPABASE_DB_URL" budsjett.dump
```

### 4. På telefonen

Åpne adressen i Safari eller Chrome og velg *Legg til på Hjem-skjerm*. Da åpnes den som en egen app.

## Utvikling lokalt

```sh
npm install
cp .env.example .env.local   # fyll inn URL og nøkkel
npm run dev                  # http://localhost:5173/budsjett/
npm test                     # økonomilogikk + databasetester
```

Databasetestene kjører den ekte migrasjonen i Postgres (PGlite) og sjekker blant annet at én bruker aldri ser en annens data, at ingenting er tilgjengelig uten tofaktor, og at splitt alltid summerer riktig.

`tests/e2e/fake-supabase.ts` er en testserver som etterligner Supabase-API-et mot samme database, brukt til å klikke gjennom appen i nettleser. Den er aldri med i bygget.

## Økonomisk logikk

Beløp lagres som heltall i øre. Hver transaksjon har en type som bestemmer hvordan den teller:

| Type | Forbruk | Inn/ut |
|---|---|---|
| Utgift | øker | ut |
| Renter og gebyrer | øker | ut |
| Refusjon | reduserer | inn |
| Inntekt | nei | inn |
| Låneopptak | nei | inn |
| Sparing | nei | ut |
| Avdrag | nei | ut |
| Overføring | nei | ingen (egne kontoer) |

All logikk ligger i `src/lib/finance.ts` og er testet i `tests/lib/`.

## Faser

**Fase 1 (denne):** innlogging med tofaktor, database, kategorier med underkategorier, hurtigregistrering med kategoriforslag, detaljert registrering med splitt, refusjon koblet til kjøp, kontoer og overføringer, transaksjonslogg med søk og filter, dashboard med prognose, lys og mørk modus, PWA.

**Neste:** budsjetter per kategori, faste utgifter, sparemål, analyseside, CSV-import og -eksport, kvitteringer, fellesøkonomi. Datamodellen har allerede husholdning og deling på plass, så dette blir utvidelser og ikke ombygging.
