#!/usr/bin/env node
/**
 * Build gameplay data (countries, cities, curated quest locations) from the upstream
 * Natural Earth data and Unity assets.
 *
 * Sources:
 *   Assets/Data/Countries/Source/Countries (medium res).txt   (GeoJSON, country metadata)
 *   Assets/Data/Countries/Source/City Data.txt                (GeoJSON, populated places)
 *   Assets/Data/Countries/Capitals.json                       (country capitals)
 *   Assets/Data/Quest/Locations.asset                         (curated quest locations + weights)
 *
 * Mirrors CountryData.Load / CityReader.ReadCities / Locations.CreateLocations so quest
 * selection matches the original game.
 *
 * Usage: node scripts/build-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'vendor', 'geographical-adventures', 'Assets', 'Data');
const OUT = path.join(ROOT, 'public', 'assets', 'data');
fs.mkdirSync(OUT, { recursive: true });

// ---- Curated locations + weights (Locations.asset) --------------------------
function readCuratedLocations() {
  const text = fs.readFileSync(path.join(SRC, 'Quest', 'Locations.asset'), 'utf8');
  const countries = [];
  let country = null;
  let city = null;
  const settings = {};
  for (const line of text.split('\n')) {
    let m;
    if ((m = line.match(/^  - countryName: (.*)$/))) {
      country = { countryName: m[1].trim(), countryCode3: '', cities: [] };
      countries.push(country);
      city = null;
    } else if (country && (m = line.match(/^    countryCode3: (.*)$/))) {
      country.countryCode3 = m[1].trim();
    } else if (country && (m = line.match(/^    - cityName: (.*)$/))) {
      city = { cityName: m[1].trim(), overrideCountryName: '', overrideCountryFlagCode: '' };
      country.cities.push(city);
    } else if (city && (m = line.match(/^      overrideCountryName: (.*)$/))) {
      city.overrideCountryName = m[1].trim();
    } else if (city && (m = line.match(/^      overrideCountryFlagCode: (.*)$/))) {
      city.overrideCountryFlagCode = m[1].trim();
    } else if ((m = line.match(/^  (cityWeight|populationWeight|minorCityPopulationThreshold|minorCityWeight): (.*)$/))) {
      settings[m[1]] = Number(m[2]);
    }
  }
  return { countries, settings };
}

// ---- Countries (GeoJSON) ----------------------------------------------------
const countriesGeo = JSON.parse(fs.readFileSync(path.join(SRC, 'Countries/Source/Countries (medium res).txt'), 'utf8'));
const countriesByCode = new Map();
for (const feature of countriesGeo.features) {
  const p = feature.properties;
  countriesByCode.set(p.ADM0_A3, {
    name: p.NAME,
    nameLong: p.NAME_LONG,
    nameSort: p.NAME_SORT,
    nameOfficial: p.ADMIN,
    abbreviation: p.ABBREV,
    continent: p.CONTINENT,
    alpha2: p['2_LETTER_CODE'] ?? p.POSTAL,
    alpha3: p.ADM0_A3,
    population: Math.round(p.POP_EST ?? 0),
    cities: [],
  });
}

// ---- Capitals ---------------------------------------------------------------
const capitals = JSON.parse(fs.readFileSync(path.join(SRC, 'Countries/Capitals.json'), 'utf8'));
const capitalNamesByCode = new Map();
for (const c of capitals) {
  const names = new Set(c.capital ?? []);
  capitalNamesByCode.set(c.cca3, names);
}

// ---- Cities (GeoJSON) -------------------------------------------------------
const citiesGeo = JSON.parse(fs.readFileSync(path.join(SRC, 'Countries/Source/City Data.txt'), 'utf8'));
const allCities = [];
for (const feature of citiesGeo.features) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry?.coordinates ?? [];
  if (lon === undefined) continue;
  const capitalNames = capitalNamesByCode.get(p.adm0_a3);
  allCities.push({
    name: p.name,
    countryName: p.adm0name,
    countryAlpha3Code: p.adm0_a3,
    inAmericanState: p.adm0_a3 === 'USA',
    americanStateName: p.adm0_a3 === 'USA' ? p.adm1name : undefined,
    isCapital: capitalNames ? capitalNames.has(p.name) : false,
    populationMetro: p.pop_max ?? 0,
    lon,
    lat,
  });
}

// Sort exactly like CityReader.ReadCities.
allCities.sort((a, b) => {
  const popCompare = a.populationMetro > b.populationMetro ? -1 : 1;
  let capitalCompare = 0;
  if (a.isCapital) capitalCompare -= 2;
  if (b.isCapital) capitalCompare += 2;
  return popCompare + capitalCompare;
});

for (const city of allCities) {
  const country = countriesByCode.get(city.countryAlpha3Code);
  if (country) country.cities.push(city);
}

// ---- Build curated locations (port of Locations.CreateLocations) ------------
const { countries: curated, settings } = readCuratedLocations();
const locations = [];
const skipped = [];

/** Strip diacritics + lowercase so curated names match Natural Earth spellings. */
function normalize(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

for (const cc of curated) {
  const country = countriesByCode.get(cc.countryCode3);
  if (!country) {
    skipped.push(`country ${cc.countryCode3}`);
    continue;
  }
  const resolved = cc.cities.map((curatedCity) => ({
    curatedCity,
    city:
      country.cities.find((c) => c.name === curatedCity.cityName) ??
      country.cities.find((c) => normalize(c.name) === normalize(curatedCity.cityName)) ??
      null,
  }));

  const numMajorCities = resolved.filter(
    (r) => r.city && r.city.populationMetro > settings.minorCityPopulationThreshold,
  ).length;

  for (const { curatedCity, city } of resolved) {
    if (!city) {
      skipped.push(`${cc.countryName}/${curatedCity.cityName}`);
      continue;
    }
    let weight = 1.0 / Math.max(1, numMajorCities);
    weight += numMajorCities * settings.cityWeight + (city.populationMetro / 5000000) * settings.populationWeight;
    if (country.name !== 'Antarctica') {
      // Mathf.Lerp clamps t; Mathf.Max(1, ratio) is always >= 1, so this is a no-op in the
      // original too. Kept for fidelity.
      const t = Math.min(1, Math.max(1, city.populationMetro / settings.minorCityPopulationThreshold));
      weight *= settings.minorCityWeight + (1 - settings.minorCityWeight) * t;
    }

    locations.push({
      country: {
        alpha3: country.alpha3,
        alpha2: country.alpha2,
        name: country.name,
        nameLong: country.nameLong,
        nameSort: country.nameSort,
        nameOfficial: country.nameOfficial,
        abbreviation: country.abbreviation,
        continent: country.continent,
      },
      city: {
        name: city.name,
        displayName:
          city.inAmericanState && city.name !== 'Washington, D.C.'
            ? `${city.name}, ${city.americanStateName}`
            : city.name,
        lat: city.lat,
        lon: city.lon,
        population: city.populationMetro,
        isCapital: city.isCapital,
      },
      overrideCountryName: curatedCity.overrideCountryName || null,
      overrideFlagCode: curatedCity.overrideCountryFlagCode || null,
      weight,
    });
  }
}

const output = { settings, locations };
fs.writeFileSync(path.join(OUT, 'quest.json'), JSON.stringify(output));
console.log(`quest.json: ${locations.length} locations across ${curated.length} curated countries`);
if (skipped.length) console.log(`skipped ${skipped.length}:`, skipped.slice(0, 12).join(', '), skipped.length > 12 ? '…' : '');
console.log(`size: ${(fs.statSync(path.join(OUT, 'quest.json')).size / 1024).toFixed(0)} KB`);

// ---- City lights (night-side points) ---------------------------------------
const cityLightsRaw = JSON.parse(fs.readFileSync(path.join(SRC, 'City Lights', 'CityLightPoints.json'), 'utf8'));
const lightData = [];
for (const item of cityLightsRaw.items ?? []) {
  for (const light of item.cityLights ?? []) {
    const p = light.pointOnSphere;
    // x, y, z, intensity, randomT (matches upstream CityLight struct).
    if (p) lightData.push(p.x, p.y, p.z, light.intensity ?? 0.5, light.randomT ?? 0.5);
  }
}
const lightBuf = Buffer.from(new Float32Array(lightData).buffer);
fs.writeFileSync(path.join(OUT, 'city_lights.bin'), lightBuf);
console.log(`city_lights.bin: ${lightData.length / 5} lights (${(lightBuf.length / 1e6).toFixed(1)} MB)`);

// ---- Stars (HYG catalogue) -------------------------------------------------
const rows = fs.readFileSync(path.join(SRC, 'Stars', 'hygdata_v3.csv'), 'utf8').split('\n');
const header = rows[0].split(',');
const col = (name) => header.indexOf(name);
const [ix, iy, iz, imag, ici] = [col('x'), col('y'), col('z'), col('mag'), col('ci')];
const starData = [];
for (let i = 1; i < rows.length; i++) {
  const line = rows[i];
  if (!line) continue;
  const cells = line.split(',');
  const mag = parseFloat(cells[imag]);
  if (!(mag < 6.5)) continue;
  const x = parseFloat(cells[ix]);
  const y = parseFloat(cells[iy]);
  const z = parseFloat(cells[iz]);
  const len = Math.hypot(x, y, z);
  if (len === 0) continue;
  const ci = parseFloat(cells[ici]);
  starData.push(x / len, y / len, z / len, mag, Number.isNaN(ci) ? 0.65 : ci);
}
const starBuf = Buffer.from(new Float32Array(starData).buffer);
fs.writeFileSync(path.join(OUT, 'stars.bin'), starBuf);
console.log(`stars.bin: ${starData.length / 5} stars (${(starBuf.length / 1e6).toFixed(2)} MB)`);
