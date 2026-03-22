/**
 * Seed the AP (Autoriteit Persoonsgegevens) database with sample decisions and guidelines.
 *
 * Includes real AP decisions (TikTok, DUO, Belastingdienst, Uber) and representative
 * guidance documents so MCP tools can be tested without running a full ingestion pipeline.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["AP_DB_PATH"] ?? "data/ap.db";
const force = process.argv.includes("--force");

// --- Bootstrap database ------------------------------------------------------

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// --- Topics ------------------------------------------------------------------

interface TopicRow {
  id: string;
  name_nl: string;
  name_en: string;
  description: string;
}

const topics: TopicRow[] = [
  {
    id: "kinderen",
    name_nl: "Kinderen en minderjarigen",
    name_en: "Children and minors",
    description: "Verwerking van persoonsgegevens van kinderen, waaronder toestemming door ouders en beveiliging van gegevens van minderjarigen (art. 8 AVG).",
  },
  {
    id: "cookies",
    name_nl: "Cookies en tracking",
    name_en: "Cookies and tracking",
    description: "Plaatsen en uitlezen van cookies en vergelijkbare technologieën op apparaten van gebruikers (art. 11.7a Telecommunicatiewet).",
  },
  {
    id: "profilering",
    name_nl: "Profilering en geautomatiseerde besluitvorming",
    name_en: "Profiling and automated decision-making",
    description: "Geautomatiseerde verwerking van persoonsgegevens voor profilering, inclusief discriminatoir gebruik (art. 22 AVG).",
  },
  {
    id: "beveiliging",
    name_nl: "Beveiliging van persoonsgegevens",
    name_en: "Security of personal data",
    description: "Technische en organisatorische maatregelen ter beveiliging van persoonsgegevens (art. 32 AVG).",
  },
  {
    id: "datalekken",
    name_nl: "Datalekken en meldplicht",
    name_en: "Data breaches and notification",
    description: "Melding van datalekken aan de AP en betrokkenen (art. 33–34 AVG).",
  },
  {
    id: "toestemming",
    name_nl: "Toestemming",
    name_en: "Consent",
    description: "Geldige toestemming als grondslag voor gegevensverwerking (art. 6 en 7 AVG).",
  },
  {
    id: "cameratoezicht",
    name_nl: "Cameratoezicht",
    name_en: "Camera surveillance",
    description: "Gebruik van camerasystemen op de werkvloer, in publieke ruimten, en in semi-publieke ruimten.",
  },
  {
    id: "grondrechten",
    name_nl: "Grondrechten en discriminatie",
    name_en: "Fundamental rights and discrimination",
    description: "Bescherming van grondrechten bij gegevensverwerking, inclusief verbod op discriminatoire algoritmen.",
  },
  {
    id: "doorgifte",
    name_nl: "Internationale doorgifte",
    name_en: "International transfers",
    description: "Doorgifte van persoonsgegevens naar derde landen of internationale organisaties (art. 44–49 AVG).",
  },
];

const insertTopic = db.prepare(
  "INSERT OR IGNORE INTO topics (id, name_nl, name_en, description) VALUES (?, ?, ?, ?)",
);

for (const t of topics) {
  insertTopic.run(t.id, t.name_nl, t.name_en, t.description);
}

console.log(`Inserted ${topics.length} topics`);

// --- Decisions ---------------------------------------------------------------

interface DecisionRow {
  reference: string;
  title: string;
  date: string;
  type: string;
  entity_name: string;
  fine_amount: number | null;
  summary: string;
  full_text: string;
  topics: string;
  gdpr_articles: string;
  status: string;
}

const decisions: DecisionRow[] = [
  // AP-2021-001 — TikTok (minors)
  {
    reference: "AP-2021-001",
    title: "Besluit AP — TikTok B.V. (kinderen)",
    date: "2021-07-16",
    type: "boete",
    entity_name: "TikTok B.V.",
    fine_amount: 750_000,
    summary:
      "De AP heeft TikTok een boete van 750.000 euro opgelegd omdat de app de privacyverklaring alleen in het Engels had staan, terwijl de app ook door Nederlandse kinderen werd gebruikt. Daardoor konden jonge kinderen onvoldoende begrijpen welke persoonsgegevens TikTok verzamelde en wat daarmee werd gedaan.",
    full_text:
      "De Autoriteit Persoonsgegevens (AP) heeft TikTok B.V. een boete opgelegd van 750.000 euro wegens overtreding van de Algemene Verordening Gegevensbescherming (AVG). TikTok bood zijn privacyverklaring uitsluitend aan in het Engels, terwijl de app veel door Nederlandse kinderen werd gebruikt. Kinderen van 0 tot en met 15 jaar konden daardoor niet begrijpen welke persoonsgegevens TikTok verzamelde en wat daarmee werd gedaan. De AP constateert daarmee een overtreding van het beginsel van transparantie (art. 5 lid 1 sub a AVG) en de informatieverplichting (art. 13 AVG). De AP neemt als bijzonder verzwarende omstandigheid mee dat TikTok bewust de keuze heeft gemaakt om kinderen als doelgroep te bedienen en daarmee een bijzondere verantwoordelijkheid heeft om hun persoonsgegevens te beschermen. TikTok heeft na het opleggen van de boete de privacyverklaring beschikbaar gesteld in het Nederlands. De AP houdt er rekening mee dat dit een startup betrof die zich in een snelgroeiende markt bevindt. De boete is vastgesteld op 750.000 euro.",
    topics: JSON.stringify(["kinderen", "toestemming"]),
    gdpr_articles: JSON.stringify(["5", "13"]),
    status: "final",
  },
  // AP-2022-001 — DUO (student finance)
  {
    reference: "AP-2022-001",
    title: "Besluit AP — Dienst Uitvoering Onderwijs (DUO)",
    date: "2023-10-24",
    type: "boete",
    entity_name: "Dienst Uitvoering Onderwijs (DUO)",
    fine_amount: 3_700_000,
    summary:
      "De AP heeft DUO een boete van 3,7 miljoen euro opgelegd omdat DUO studenten jarenlang op frauduleuze wijze controleerde. DUO keek of studenten werkelijk op hun inschrijfadres woonden door in te loggen op sociale media en afbeeldingen te bekijken. Dit is onrechtmatige profilering.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft Dienst Uitvoering Onderwijs (DUO) een boete opgelegd van 3.700.000 euro. DUO is de uitvoeringsorganisatie die namens de overheid studiefinanciering en andere onderwijssubsidies beheert. DUO voerde een fraudedetectiesysteem uit waarbij studenten op illegale wijze werden gecontroleerd. DUO keek of studenten inderdaad op hun opgegeven adres woonden door op sociale media in te loggen en foto-informatie te bekijken. Hiermee voerde DUO onrechtmatige profilering uit op sociale media zonder daarvoor een wettelijke grondslag te hebben. Bovendien werden de controles in strijd met het beginsel van minimale gegevensverwerking uitgevoerd: er werden meer gegevens verzameld dan strikt noodzakelijk was voor het doel. De AP constateert overtredingen van art. 5 AVG (beginselen inzake verwerking), art. 6 AVG (rechtmatigheid van verwerking) en art. 22 AVG (geautomatiseerde individuele besluitvorming, met inbegrip van profilering). De AP heeft DUO opgedragen het fraudedetectiesysteem aan te passen en te stoppen met het onrechtmatig verwerken van persoonsgegevens via sociale media.",
    topics: JSON.stringify(["profilering", "grondrechten"]),
    gdpr_articles: JSON.stringify(["5", "6", "22"]),
    status: "final",
  },
  // AP-2022-002 — Belastingdienst (discriminatoire profilering)
  {
    reference: "AP-2022-002",
    title: "Onderzoek AP — Belastingdienst (discriminatoire profilering Toeslagenaffaire)",
    date: "2022-07-07",
    type: "besluit",
    entity_name: "Belastingdienst / Toeslagen",
    fine_amount: null,
    summary:
      "De AP heeft onderzoek gedaan naar de werkwijze van de Belastingdienst/Toeslagen bij fraudeopsporing bij kinderopvangtoeslag. De AP concludeert dat de Belastingdienst discriminatoire profilering heeft toegepast door de nationaliteit en het hebben van een tweede nationaliteit mee te wegen als risicofactor, wat strijdig is met de AVG.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft onderzoek gedaan naar de gegevensverwerking door de Belastingdienst/Toeslagen in het kader van fraudeopsporing voor de kinderopvangtoeslag. Dit onderzoek vloeide voort uit de Toeslagenaffaire, waarbij grote groepen ouders onterecht als fraudeur werden aangemerkt en hun kinderopvangtoeslag werd teruggevorderd. De AP concludeert dat de Belastingdienst/Toeslagen overtredingen heeft begaan van de AVG. Ten eerste heeft de Belastingdienst/Toeslagen de nationaliteit van aanvragers en het hebben van een tweede nationaliteit gebruikt als risicofactor bij fraudedetectie. Dit is een bijzonder persoonsgegeven (nationaliteit) dat zonder expliciete rechtsgrondslag is verwerkt. Bovendien leidt het meewegen van nationaliteit tot indirect onderscheid op grond van ras of etnische afkomst, wat verboden is. Ten tweede ontbrak een adequate rechtsgrondslag voor de verwerking van gegevens over de nationaliteit in het kader van fraudeopsporing. Ten derde zijn betrokkenen niet geïnformeerd over het gebruik van hun nationaliteitsgegevens bij de fraudecontrole. De AP heeft geconcludeerd dat de Belastingdienst/Toeslagen in strijd heeft gehandeld met art. 5 (beginselen), art. 6 (rechtmatigheid), art. 9 (bijzondere categorieën) en art. 14 (informatieplicht) van de AVG. De AP heeft geen boete opgelegd maar aanbevelingen gedaan voor herstel.",
    topics: JSON.stringify(["profilering", "grondrechten"]),
    gdpr_articles: JSON.stringify(["5", "6", "9", "14"]),
    status: "final",
  },
  // AP-2019-001 — Uber (datalek)
  {
    reference: "AP-2019-001",
    title: "Besluit AP — Uber Technologies Inc. (datalek)",
    date: "2019-11-26",
    type: "boete",
    entity_name: "Uber Technologies Inc.",
    fine_amount: 600_000,
    summary:
      "De AP heeft Uber een boete van 600.000 euro opgelegd wegens een ernstig datalek in 2016. Hackers hadden toegang gekregen tot de persoonsgegevens van 57 miljoen gebruikers wereldwijd, waaronder 174.000 Nederlandse gebruikers. Uber had dit datalek niet binnen 72 uur gemeld bij de AP.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft Uber Technologies Inc. een boete opgelegd van 600.000 euro. In november 2016 werden de systemen van Uber gehackt. Hackers kregen toegang tot de persoonsgegevens van 57 miljoen gebruikers en chauffeurs wereldwijd, waaronder 174.000 Nederlandse gebruikers. De gestolen gegevens bevatten namen, e-mailadressen en telefoonnummers van gebruikers, en voor chauffeurs ook rijbewijsnummers en locatiegegevens. Uber heeft dit datalek bijna een jaar lang verzwegen. In plaats van het datalek te melden, betaalde Uber de hackers 100.000 dollar losgeld om de gestolen data te verwijderen en de hack geheim te houden. Dit is een ernstige overtreding van de meldplicht datalekken. Op grond van de op dat moment geldende Wet bescherming persoonsgegevens (Wbp) was Uber verplicht het datalek binnen 72 uur te melden bij de Nederlandse toezichthouder. Uber had dit nagelaten. De AP heeft vastgesteld dat sprake is van twee overtredingen: (1) het niet tijdig melden van het datalek bij de AP en (2) het niet informeren van de betrokkenen over het datalek. Bij het vaststellen van de hoogte van de boete heeft de AP rekening gehouden met de ernst en de duur van de overtreding, de omvang van de groep betrokken gebruikers en de omstandigheid dat Uber bewust heeft gekozen voor het betalen van losgeld in plaats van het melden van het datalek.",
    topics: JSON.stringify(["datalekken", "beveiliging"]),
    gdpr_articles: JSON.stringify(["33", "34"]),
    status: "final",
  },
  // AP-2023-001 — Clearview AI
  {
    reference: "AP-2023-001",
    title: "Besluit AP — Clearview AI (biometrische gegevens)",
    date: "2023-09-13",
    type: "boete",
    entity_name: "Clearview AI",
    fine_amount: 30_500_000,
    summary:
      "De AP heeft Clearview AI een boete opgelegd van 30,5 miljoen euro voor het illegaal opbouwen van een database met biometrische gegevens. Clearview verzamelt miljarden foto's van het internet en gebruikt die voor gezichtsherkenning. Er is geen wettelijke grondslag voor de verwerking van biometrische gegevens van Nederlanders.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft Clearview AI een boete opgelegd van 30.500.000 euro. Dit is de hoogste boete die de AP ooit heeft opgelegd. Clearview AI is een Amerikaans bedrijf dat een database heeft opgebouwd van miljarden foto's van mensen die op het internet staan. Op basis van deze foto's biedt Clearview een gezichtsherkenningsdienst aan waarmee personen kunnen worden geïdentificeerd aan de hand van een foto. De AP stelt vast dat Clearview AI ernstige overtredingen heeft begaan van de AVG. Clearview verwerkt biometrische gegevens (unieke lichamelijke kenmerken zoals gezichtsafmetingen) van Nederlanders zonder daarvoor een geldige grondslag te hebben. Biometrische gegevens zijn bijzondere categorieën van persoonsgegevens waarvoor strengere regels gelden. Clearview had geen toestemming gevraagd aan de mensen wier foto's zijn gebruikt, er was geen legitiem belang dat de inbreuk op de privacyrechten rechtvaardigde, en er was geen andere wettelijke uitzondering van toepassing. Bovendien heeft Clearview mensen niet geïnformeerd over het gebruik van hun biometrische gegevens en verzoeken om inzage en verwijdering van gegevens niet of onvoldoende beantwoord. De AP heeft ook overwogen dat Clearview diensten aanbiedt aan (buitenlandse) overheden en wetshandhavingsinstanties, wat extra risico's meebrengt voor de grondrechten van betrokkenen.",
    topics: JSON.stringify(["profilering", "grondrechten", "doorgifte"]),
    gdpr_articles: JSON.stringify(["5", "6", "9", "12", "15", "17"]),
    status: "final",
  },
  // AP-2020-001 — VGZ (zorgverzekeraar)
  {
    reference: "AP-2020-001",
    title: "Besluit AP — VGZ (zorgverzekering en gezondheidsgegevens)",
    date: "2020-09-30",
    type: "boete",
    entity_name: "VGZ (Coöperatie VGZ U.A.)",
    fine_amount: 400_000,
    summary:
      "De AP heeft zorgverzekeraar VGZ een boete van 400.000 euro opgelegd vanwege onvoldoende beveiliging van gezondheidsgegevens van verzekerden. Medewerkers konden eenvoudig inloggen in het systeem zonder tweefactorauthenticatie.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft Coöperatie VGZ U.A. een boete opgelegd van 400.000 euro. VGZ is een van de grootste zorgverzekeraars in Nederland. Medewerkers van VGZ hadden toegang tot het systeem met medische dossiers van verzekerden. Dit systeem bevatte gevoelige gezondheidsgegevens, zoals diagnoses en behandelingen. De AP heeft vastgesteld dat VGZ de beveiliging van dit systeem onvoldoende had geregeld. Medewerkers konden inloggen met alleen een gebruikersnaam en wachtwoord, zonder gebruik te maken van tweefactorauthenticatie. Dat is gezien de gevoeligheid van de gezondheidsgegevens onvoldoende. De AP stelt vast dat VGZ daarmee in strijd heeft gehandeld met de verplichting om passende technische en organisatorische maatregelen te treffen om een op het risico afgestemd beveiligingsniveau te waarborgen (art. 32 AVG). Gezondheidsgegevens zijn bijzondere categorieën van persoonsgegevens waarvoor extra strenge eisen gelden. VGZ had bovendien een groot risico op ongeautoriseerde toegang moeten zien: een hacker die een gebruikersnaam en wachtwoord wist te achterhalen, had direct toegang tot de gezondheidsgegevens van alle verzekerden. VGZ heeft na het besluit tweefactorauthenticatie ingevoerd.",
    topics: JSON.stringify(["beveiliging"]),
    gdpr_articles: JSON.stringify(["9", "32"]),
    status: "final",
  },
];

const insertDecision = db.prepare(`
  INSERT OR IGNORE INTO decisions
    (reference, title, date, type, entity_name, fine_amount, summary, full_text, topics, gdpr_articles, status)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertDecisionsAll = db.transaction(() => {
  for (const d of decisions) {
    insertDecision.run(
      d.reference,
      d.title,
      d.date,
      d.type,
      d.entity_name,
      d.fine_amount,
      d.summary,
      d.full_text,
      d.topics,
      d.gdpr_articles,
      d.status,
    );
  }
});

insertDecisionsAll();
console.log(`Inserted ${decisions.length} decisions`);

// --- Guidelines --------------------------------------------------------------

interface GuidelineRow {
  reference: string | null;
  title: string;
  date: string;
  type: string;
  summary: string;
  full_text: string;
  topics: string;
  language: string;
}

const guidelines: GuidelineRow[] = [
  {
    reference: "AP-HANDLEIDING-AVG-2018",
    title: "Handleiding Algemene Verordening Gegevensbescherming (AVG)",
    date: "2018-05-25",
    type: "handleiding",
    summary:
      "Handleiding van de AP over de toepassing van de AVG voor organisaties. Behandelt de belangrijkste beginselen, grondslagen voor verwerking, rechten van betrokkenen, en verplichtingen van verwerkingsverantwoordelijken.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft deze handleiding gepubliceerd om organisaties te helpen de Algemene Verordening Gegevensbescherming (AVG) correct toe te passen. De AVG is op 25 mei 2018 van kracht geworden en vervangt de Wet bescherming persoonsgegevens (Wbp). De AVG geeft mensen meer privacyrechten en legt organisaties meer verplichtingen op. Kernbeginselen: de AVG stelt dat persoonsgegevens rechtmatig, behoorlijk en transparant moeten worden verwerkt. Gegevens mogen alleen worden verzameld voor welbepaalde, uitdrukkelijk omschreven en gerechtvaardigde doeleinden (doelbinding). Er mogen niet meer gegevens worden verzameld dan noodzakelijk (dataminimalisatie). Gegevens moeten juist zijn en zo nodig worden bijgewerkt (juistheid). Gegevens mogen niet langer worden bewaard dan noodzakelijk (opslagbeperking). Gegevens moeten adequaat worden beveiligd (integriteit en vertrouwelijkheid). Grondslagen voor verwerking: een verwerking is alleen rechtmatig als er een wettelijke grondslag is. De zes grondslagen zijn: (1) toestemming, (2) noodzakelijk voor uitvoering overeenkomst, (3) wettelijke verplichting, (4) vitale belangen, (5) publiekrechtelijke taak, (6) gerechtvaardigd belang. Rechten van betrokkenen: betrokkenen hebben het recht op inzage, rectificatie, vergetelheid, beperking van verwerking, gegevensoverdraagbaarheid, bezwaar, en het recht om niet onderworpen te worden aan geautomatiseerde besluitvorming. Verplichtingen: organisaties moeten een register bijhouden van verwerkingsactiviteiten, een functionaris gegevensbescherming (FG) aanstellen indien vereist, een DPIA uitvoeren voor hoog-risicoVerwerking, en datalekken melden.",
    topics: JSON.stringify(["toestemming", "beveiliging", "datalekken"]),
    language: "nl",
  },
  {
    reference: "AP-NORMUITLEG-COOKIES-2023",
    title: "Normuitleg cookies en vergelijkbare technieken",
    date: "2023-03-15",
    type: "normuitleg",
    summary:
      "Normuitleg van de AP over de vereisten voor het plaatsen van cookies en vergelijkbare technieken op apparaten van gebruikers. Behandelt de toestemmingsvereisten, cookiemuren (cookie walls), en technisch noodzakelijke cookies.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft deze normuitleg gepubliceerd om duidelijkheid te geven over de vereisten voor het plaatsen van cookies en vergelijkbare technieken. Het plaatsen van cookies en vergelijkbare technieken is geregeld in art. 11.7a van de Telecommunicatiewet. Voor het plaatsen van niet-noodzakelijke cookies is toestemming vereist. Vereisten voor geldige toestemming: toestemming voor cookies moet vrij, specifiek, geïnformeerd en ondubbelzinnig zijn. Dit betekent dat: (1) de gebruiker een echte keuze moet hebben — een cookie wall, waarbij toegang tot de website wordt geweigerd als de gebruiker geen toestemming geeft voor tracking cookies, is in beginsel niet toegestaan; (2) toestemming moet per categorie cookies worden gegeven — een algemene accepteer-alles-knop zonder mogelijkheid om categorieën te selecteren is niet voldoende; (3) toestemming moet worden gegeven door een actieve handeling — standaard aangevinkte vakjes voldoen niet; (4) gebruikers moeten net zo eenvoudig toestemming kunnen weigeren als geven. Uitzonderingen: functionele cookies die strikt noodzakelijk zijn voor de levering van een door de gebruiker gevraagde dienst zijn vrijgesteld van toestemmingsvereiste. Hieronder vallen sessiecookies, winkelwagen-cookies en inlog-cookies. Analytische cookies: voor analytische cookies die uitsluitend worden gebruikt om de website te verbeteren en waarbij de impact op de privacy beperkt is, geldt een beperkte uitzondering (first-party analytics met IP-anonimisering). Bewaarperiode toestemming: toestemming moet periodiek worden hernieuwd; een periode van maximaal 12 maanden is redelijk.",
    topics: JSON.stringify(["cookies", "toestemming"]),
    language: "nl",
  },
  {
    reference: "AP-RICHTSNOER-BEVEILIGING-2021",
    title: "Richtsnoeren beveiliging van persoonsgegevens",
    date: "2021-06-01",
    type: "richtsnoer",
    summary:
      "Richtsnoeren van de AP over passende technische en organisatorische beveiligingsmaatregelen voor de bescherming van persoonsgegevens conform art. 32 AVG. Behandelt risicoanalyse, versleuteling, toegangsbeveiliging, en incidentrespons.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft richtsnoeren gepubliceerd over de beveiliging van persoonsgegevens. Art. 32 AVG verplicht verwerkingsverantwoordelijken en verwerkers om passende technische en organisatorische maatregelen te treffen om een beveiligingsniveau te waarborgen dat is afgestemd op het risico. Risicoanalyse: de keuze van beveiligingsmaatregelen moet gebaseerd zijn op een risicoanalyse. Daarbij moet rekening worden gehouden met de stand van de techniek, de uitvoeringskosten, de aard, omvang, context en doeleinden van de verwerking, en de risico's voor betrokkenen. Technische maatregelen: de AP noemt als relevante technische maatregelen: (1) versleuteling van persoonsgegevens in rust en in transit; (2) pseudonimisering van persoonsgegevens; (3) tweefactorauthenticatie voor toegang tot systemen met persoonsgegevens; (4) logbestanden van toegang tot persoonsgegevens; (5) regelmatige back-ups en herstelscenario's. Organisatorische maatregelen: relevante organisatorische maatregelen zijn onder meer: (1) een autorisatiebeleid waarbij medewerkers alleen toegang hebben tot de gegevens die zij voor hun werk nodig hebben (need-to-know principe); (2) bewustzijnstrainingen voor medewerkers; (3) een procedure voor het melden van beveiligingsincidenten en datalekken; (4) het uitvoeren van periodieke beveiligingstests en -audits. Bijzondere categorieën: voor bijzondere categorieën van persoonsgegevens (zoals gezondheidsgegevens, biometrische gegevens, strafblad) gelden strengere beveiligingseisen.",
    topics: JSON.stringify(["beveiliging", "datalekken"]),
    language: "nl",
  },
  {
    reference: "AP-HANDLEIDING-CAMERA-2022",
    title: "Handleiding cameratoezicht",
    date: "2022-04-01",
    type: "handleiding",
    summary:
      "Handleiding van de AP over de juridische vereisten voor cameratoezicht door werkgevers, winkels, en andere organisaties. Behandelt rechtmatige grondslagen, informatieverstrekking, bewaartermijnen, en speciale regels voor publieke ruimten.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft een handleiding gepubliceerd over cameratoezicht. Cameratoezicht is een vorm van verwerking van persoonsgegevens en valt onder de AVG. Rechtmatige grondslagen voor cameratoezicht: de meest gebruikte grondslagen voor cameratoezicht zijn gerechtvaardigd belang (art. 6 lid 1 sub f AVG) voor private organisaties, en wettelijke verplichting of publiekrechtelijke taak voor overheidsorganen. Het gerechtvaardigd belang (bijv. beveiliging van eigendommen of gebouwen) moet zwaarder wegen dan de inbreuk op de privacy van betrokkenen. Transparantie: iedereen die het cameragebied betreedt, moet worden geïnformeerd over de aanwezigheid van camera's. Dit kan door duidelijk zichtbare pictogrammen of borden te plaatsen. Bewaartermijnen: camerabeelden mogen niet langer worden bewaard dan noodzakelijk. De AP hanteert als uitgangspunt dat camerabeelden na uiterlijk 4 weken moeten worden verwijderd, tenzij er een concreet incident is waarvoor de beelden bewaard moeten blijven. Cameratoezicht op de werkplek: voor cameratoezicht op de werkplek gelden extra strenge eisen. De werknemer moet worden geïnformeerd, en heimelijk cameratoezicht is alleen in uitzonderlijke gevallen toegestaan. Publieke ruimten: gemeenten en andere overheidsorganen die camera's plaatsen in de openbare ruimte hebben een specifieke wettelijke grondslag nodig.",
    topics: JSON.stringify(["cameratoezicht", "toestemming"]),
    language: "nl",
  },
  {
    reference: "AP-RICHTSNOER-PROFILERING-2019",
    title: "Richtsnoeren profilering en geautomatiseerde besluitvorming",
    date: "2019-09-01",
    type: "richtsnoer",
    summary:
      "Richtsnoeren van de AP over profilering en geautomatiseerde besluitvorming, inclusief de vereisten van art. 22 AVG en de bescherming tegen discriminatoire algoritmen.",
    full_text:
      "De Autoriteit Persoonsgegevens heeft richtsnoeren gepubliceerd over profilering en geautomatiseerde besluitvorming. Profilering is een vorm van automatische verwerking van persoonsgegevens waarbij die gegevens worden gebruikt om bepaalde persoonlijke aspecten te evalueren. Geautomatiseerde individuele besluitvorming (art. 22 AVG): betrokkenen hebben het recht om niet onderworpen te worden aan beslissingen die uitsluitend gebaseerd zijn op geautomatiseerde verwerking, inclusief profilering, als die beslissing rechtsgevolgen heeft of de betrokkene in aanmerkelijke mate treft. Uitzonderingen zijn mogelijk als de beslissing noodzakelijk is voor de totstandkoming of uitvoering van een overeenkomst, als er een wettelijke grondslag is, of als de betrokkene uitdrukkelijk toestemming heeft gegeven. In dat geval moet de verwerkingsverantwoordelijke passende maatregelen nemen om de rechten en vrijheden van de betrokkene te beschermen, waaronder het recht op menselijke tussenkomst. Discriminatieverbod: profilering mag niet leiden tot discriminatie op grond van ras, etniciteit, godsdienst, geslacht, leeftijd of andere beschermde gronden. Dit verbod geldt ook bij indirect onderscheid, waarbij een ogenschijnlijk neutrale factor zoals woonplaats feitelijk leidt tot discriminatie van een bepaalde groep. Verwerkingsverantwoordelijken zijn verplicht algoritmen te controleren op discriminatoire effecten en corrigerende maatregelen te nemen als dergelijke effecten worden gevonden.",
    topics: JSON.stringify(["profilering", "grondrechten"]),
    language: "nl",
  },
];

const insertGuideline = db.prepare(`
  INSERT INTO guidelines (reference, title, date, type, summary, full_text, topics, language)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertGuidelinesAll = db.transaction(() => {
  for (const g of guidelines) {
    insertGuideline.run(
      g.reference,
      g.title,
      g.date,
      g.type,
      g.summary,
      g.full_text,
      g.topics,
      g.language,
    );
  }
});

insertGuidelinesAll();
console.log(`Inserted ${guidelines.length} guidelines`);

// --- Summary -----------------------------------------------------------------

const decisionCount = (
  db.prepare("SELECT count(*) as cnt FROM decisions").get() as { cnt: number }
).cnt;
const guidelineCount = (
  db.prepare("SELECT count(*) as cnt FROM guidelines").get() as { cnt: number }
).cnt;
const topicCount = (
  db.prepare("SELECT count(*) as cnt FROM topics").get() as { cnt: number }
).cnt;
const decisionFtsCount = (
  db.prepare("SELECT count(*) as cnt FROM decisions_fts").get() as { cnt: number }
).cnt;
const guidelineFtsCount = (
  db.prepare("SELECT count(*) as cnt FROM guidelines_fts").get() as { cnt: number }
).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Topics:         ${topicCount}`);
console.log(`  Decisions:      ${decisionCount} (FTS entries: ${decisionFtsCount})`);
console.log(`  Guidelines:     ${guidelineCount} (FTS entries: ${guidelineFtsCount})`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
