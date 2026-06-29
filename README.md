# Varastojärjestelmä – prototyyppi

Web-pohjainen varastonhallintajärjestelmä suomeksi. Tukee tilausten vastaanottoa, automaattista saldon päivitystä, varauksia, toimituksia ja Excel-tuontia.

## Ominaisuudet

- **Etusivu** – yhteenveto varastosta, avoimista tilauksista ja vähissä olevista tuotteista
- **Saldo** – näyttää varastossa, tilattu, varattu ja vapaa saldo erikseen
- **Myyntitilaukset** – vastaanota tilaus → hyväksy (varaa varastosta) → toimita (poista saldosta)
- **Ostotilaukset** – luo tilaus (kasvattaa "tilattu"-saldoa) → vastaanota (siirtää varastoon)
- **Toimitukset** – nopea näkymä odottaviin toimituksiin
- **Varastotapahtumat** – täydellinen loki kaikista muutoksista
- **Excel-tuonti** – tuo tuotteet vanhasta järjestelmästä (.xlsx)

## Varastologiikka

| Tapahtuma | Vaikutus |
|-----------|----------|
| Ostotilaus luotu | `tilattu` kasvaa |
| Ostotilaus vastaanotettu | `tilattu` ↓, `varastossa` ↑ |
| Myyntitilaus hyväksytty | `varattu` ↑ |
| Toimitus | `varattu` ↓, `varastossa` ↓ |
| Vapaa saldo | `varastossa − varattu` |

## Käynnistys

```bash
chmod +x run.sh
./run.sh
```

Avaa selaimessa: **http://127.0.0.1:8000**

### Android-puhelin

Katso **[ANDROID.md](ANDROID.md)** – asenna sovellus puhelimen aloitusnäytölle (PWA).

Windows-verkossa: `run-network.bat`  
HTTPS + kameraskannaus: `run-network-https.bat`

Klikkaa vasemmalta **"Lataa esimerkkidata"** aloittaaksesi nopeasti.

## Excel-tuonti

1. Mene **Tuonti**-valikkoon
2. Lataa Excel-malli
3. Täytä tuotetiedot (tai käytä vanhan järjestelmän exporttia)
4. Lataa tiedosto järjestelmään

Tunnistetut sarakkeet: SKU, Nimi, Saldo, Tilattu, Varattu, Minimi (myös englanninkieliset nimet).

## Teknologia

- **Backend:** Python, FastAPI, SQLite
- **Frontend:** HTML, CSS, JavaScript
- **Tuonti:** openpyxl
