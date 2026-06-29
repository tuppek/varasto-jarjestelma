# Pilvi-deploy (Render)

Ilmainen HTTPS-osoite iPhonelle ja muille laitteille – ei tarvitse omaa konetta.

## Vaihe 1: GitHub

1. Luo uusi repo GitHubissa: https://github.com/new  
   Nimi esim. `varasto-jarjestelma` (tyhjä repo, ei README)

2. Projektikansiossa:
   ```bash
   cd ~/Projects/varasto-jarjestelma
   git init
   git add .
   git commit -m "Valmis pilvi-deploy"
   git branch -M main
   git remote add origin https://github.com/KAYTTAJANIMI/varasto-jarjestelma.git
   git push -u origin main
   ```

## Vaihe 2: Render

1. Rekisteröidy: https://render.com (ilmainen, GitHub-kirjautuminen)

2. **New +** → **Blueprint**

3. Yhdistä GitHub-repo `varasto-jarjestelma`

4. Render lukee `render.yaml` automaattisesti → **Apply**

   **Jos virhe:** *Blueprint file render.yaml not found on master branch*
   - Render etsii oletuksena haaraa `master`, mutta GitHub käyttää usein `main`
   - Korjaus: aja terminaalissa:
     ```bash
     git push origin main:master
     ```
   - Tai Renderissä valitse oikea haara **main** ennen Apply-painiketta

5. Odota 3–5 min – saat osoitteen:
   `https://varasto-jarjestelma-xxxx.onrender.com`

## Vaihe 3: iPhone

1. Avaa osoite **Safarissa**
2. Kirjaudu: `1001`, `1002` tai `1003`
3. **Jaa** → **Lisää Koti-valikkoon**

Esimerkkidata latautuu automaattisesti ensimmäisellä käynnistyksellä.

## Huomioita (ilmainen taso)

- Palvelu **nukkuu** 15 min käyttämättömyyden jälkeen – ensimmäinen lataus voi kestää ~30 s
- Tietokanta **nollautuu** uudelleenkäynnistyksessä (SQLite ilman pysyvää levyä)
- Tuotantokäyttöön: Renderin maksullinen levy tai PostgreSQL

## Paikallinen Docker-testi ennen pilveä

```bash
docker build -t varasto .
docker run -p 8000:8000 -e AUTO_SEED=1 varasto
```

Avaa http://127.0.0.1:8000
