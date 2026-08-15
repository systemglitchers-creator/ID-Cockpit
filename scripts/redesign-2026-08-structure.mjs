/* The 2026-08-14 redesign — the complete new reading order.
   Consumed by scripts/resequence.mjs, which regenerates public/schedule.js.

   Design (docs/superpowers/specs/2026-08-14-mandell-schedule-redesign-design.md):
   - No chapter runs more than 3 consecutive unread sessions; braid partners
     always share a theme (vary the chapter, keep the theme).
   - Flagship syndrome first, drugs braided behind first contact.
   - Complications live with their parents; integrative chapters land right
     after their prerequisites complete (the post-fungal capstone).
   - Year 2 is themed arcs (exposure/presentation), not taxonomy bins.
   - ids never change. Only order, sector membership, and labels move. */

/* Session-title edits that ride along with the redesign (ids unchanged).
   FUO/mimics and Lyme were absent from the exam-prep tail — a verified gap
   for a Royal College candidate. */
export const TITLE_OVERRIDES = {
  "x-re-read-endocarditis-sepsis-pneumonia-uti-skin-s-p1":
    "Re-read — endocarditis, sepsis, FUO & fever-and-rash, pneumonia, UTI, skin & soft tissue; durations & de-escalation",
  "x-guideline-review-aasld-hepatitis-b-c-idsa-influe-p1":
    "Guideline review — AASLD hepatitis B/C, IDSA influenza, CDC STI, CDC malaria, IDSA/AAN Lyme",
};

function P(ch, from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(`${ch}-p${i}`);
  return out;
}
const one = (ch) => [`${ch}-p1`];

export const STRUCTURE = [

  /* ================= YEAR 1 ================= */

  { title: "Drug Foundations — Completed", year: 1, accent: "#3d7a5a",
    sub: "The β-lactam and aminoglycoside spine you have already read.",
    ids: [...P("ch20",1,3), ...P("ch21",1,3), ...P("ch22",1,3), ...P("ch24",1,3)] },

  { title: "Foundations & Sepsis", year: 1, accent: "#b0413e",
    sub: "The septic patient, and the FUO consult you will field from week one.",
    ids: [...P("ch75",1,3), ...P("ch58",1,2)] },   // FUO pulled forward — day-one material

  { title: "Endovascular Infection & Staphylococci", year: 1, accent: "#a8432f",
    sub: "Endocarditis to prosthetic valves and devices; the staphylococci, braided.",
    ids: [
      ...P("ch29",1,3), ...P("ch30",1,2),          // read
      ...P("ch82",1,6), ...P("ch306",1,3),         // read
      ...P("ch199",1,3),                           // read — Staph 1–3
      "ch199-p4", "ch200-p1", "ch199-p5", "ch199-p6", "ch200-p2",  // braid
      ...P("ch83",1,3),                            // PVE — spaced return to ch82
      ...P("ch84",1,3),                            // CV device infections + IE prevention
    ] },

  { title: "Pneumonia & Respiratory Tract", year: 1, accent: "#9a5a2f",
    sub: "Lower tract to upper, drugs behind the disease — and the viruses before winter.",
    ids: [
      ...P("ch69",1,3),                            // acute pneumonia — flagship
      ...P("ch28",1,2),                            // macrolides
      ...P("ch307",1,2),                           // HAP/VAP
      ...P("ch238",1,2),                           // Legionella — pulled from Y2
      ...P("ch34",1,2),                            // quinolones
      ...P("ch204",1,3),                           // pneumococcus
      "ch28-p3", "ch34-p3",                        // finish the drugs
      one("ch71")[0],                              // lung abscess
      ...P("ch70",1,2),                            // empyema — pulled from Y2
      one("ch61")[0], ...P("ch64",1,2), ...P("ch63",1,2),  // URT
      ...P("ch165",1,2), one("ch163")[0], one("ch166")[0], // RSV, paraflu, hMPV — before the season
      ...P("ch172",1,3), ...P("ch48",1,2),         // influenza + its drugs — pulled from Y2
    ] },

  { title: "Central Nervous System Infection", year: 1, accent: "#3f5a8a",
    sub: "Meningitis to shunts and collections; Listeria and the meningococcus.",
    ids: [
      one("ch88")[0],
      ...P("ch89",1,3), one("ch211")[0], ...P("ch89",4,5),   // braid Listeria into meningitis
      ...P("ch91",1,3), ...P("ch92",1,2),
      ...P("ch93",1,2), ...P("ch94",1,2),          // collections + shunts — pulled from Y2
      ...P("ch216",1,3),
    ] },

  { title: "Genitourinary & STI Syndromes", year: 1, accent: "#6a5aa0",
    sub: "UTI and CA-UTI, then the sexually transmitted syndromes and Chlamydia.",
    ids: [
      ...P("ch74",1,3), "ch33-p1", ...P("ch308",1,2), "ch33-p2", one("ch36")[0],
      one("ch109")[0], ...P("ch110",1,2), ...P("ch111",1,3),  // pulled from Y2
      ...P("ch108",1,2), one("ch286")[0],                     // pulled from Y2
      ...P("ch186",1,3),                                      // Chlamydia — pulled from Y2
    ] },

  { title: "Skin, Soft Tissue, Bone & Joint", year: 1, accent: "#8a5a3f",
    sub: "Cellulitis to myonecrosis with its adjunct; osteoarticular infection.",
    ids: [
      ...P("ch95",1,3), ...P("ch96",1,2), one("ch53")[0],     // hyperbaric beside myonecrosis
      ...P("ch202",1,3),
      ...P("ch105",1,3),                                      // read
      ...P("ch106",1,2), ...P("ch26",1,3),
      ...P("ch107",1,2),                                      // read
    ] },

  { title: "Gastrointestinal & Intra-Abdominal", year: 1, accent: "#5a6a3a",
    sub: "Gut syndromes, C. difficile, the abdomen itself, then the anaerobes.",
    ids: [
      ...P("ch98",1,2), ...P("ch100",1,2), one("ch101")[0],
      ...P("ch249",1,3),
      ...P("ch76",1,3), ...P("ch77",1,2),                     // pulled from Y2
      ...P("ch78",1,3),
      ...P("ch248",1,2), one("ch253")[0], one("ch252")[0], one("ch254")[0],
    ] },

  { title: "Enterococci & Streptococci", year: 1, accent: "#3d7a5a",
    sub: "Enterococcus and Group B streptococcus.",
    ids: [...P("ch205",1,2), one("ch206")[0]] },

  { title: "Gram-Negatives & Resistance", year: 1, accent: "#2f6f7a",
    sub: "Enterobacterales to Acinetobacter, drugs braided behind the organisms.",
    ids: [
      ...P("ch223",1,3), ...P("ch25",1,2),
      ...P("ch224",1,2), ...P("ch31",1,2), one("ch227")[0], "ch25-p3",
      ...P("ch228",1,2),                                      // read
      ...P("ch230",1,2), ...P("ch217",1,3),
    ] },

  { title: "Spirochetes", year: 1, accent: "#7a6a2a",
    sub: "Lyme, syphilis, relapsing fever, and the endemic treponematoses — one family.",
    ids: [
      ...P("ch247",1,2), ...P("ch243",1,2), one("ch246")[0],  // relapsing fever — pulled
      ...P("ch243",3,4), one("ch244")[0],                     // endemic trep — pulled
    ] },

  { title: "Wounds, Bites & Toxins", year: 1, accent: "#7a5a2f",
    sub: "Tetanus and botulism, bites, burns, and post-traumatic infection.",
    ids: [...P("ch250",1,2), one("ch320")[0], ...P("ch318",1,3)] },

  { title: "Mycobacteria, Nocardia & Actinomyces", year: 1, accent: "#5a4a6a",
    sub: "TB with its drugs braided in, NTM, and the filamentous bacteria.",
    ids: [
      ...P("ch255",1,3), "ch38-p1", ...P("ch255",4,5), "ch38-p2",
      ...P("ch257",1,2), one("ch258")[0],
      ...P("ch259",1,2), ...P("ch260",1,2),                   // pulled from Y2
    ] },

  { title: "HIV Medicine", year: 1, accent: "#b0413e",
    sub: "Virology and diagnosis through ART and opportunistic infections.",
    ids: [...P("ch120",1,2), ...P("ch123",1,3), ...P("ch125",1,3),
          ...P("ch130",1,3), ...P("ch131",1,3)] },

  { title: "Invasive Fungal Disease", year: 1, accent: "#7a6a2a",
    sub: "Yeasts, moulds, and the endemic trio, antifungals braided behind them.",
    ids: [
      one("ch261")[0], ...P("ch262",1,3), "ch40-p1",
      ...P("ch263",1,2), "ch40-p2", ...P("ch268",1,3), "ch40-p3",
      ...P("ch275",1,3), ...P("ch269",1,2), ...P("ch270",1,2),
      ...P("ch271",1,2),                                      // cocci — pulled from Y2
      ...P("ch264",1,2),
    ] },

  { title: "Chronic Syndromes — The Capstone", year: 1, accent: "#a8432f",
    sub: "Chronic pneumonia and chronic meningitis — the payoff for the TB and fungal arcs.",
    ids: [...P("ch72",1,2), one("ch90")[0]] },

  { title: "Herpesviruses & Exanthems", year: 1, accent: "#3f5a8a",
    sub: "The herpes family with its antivirals braided in, then the exanthems.",
    ids: [
      ...P("ch142",1,3), one("ch47")[0],           // HSV, then antiviral principles
      one("ch143")[0], ...P("ch144",1,3),          // VZV, CMV
      ...P("ch49",1,2),                            // herpes antivirals — pulled from Y2
      ...P("ch145",1,3), "ch49-p3",
      one("ch167")[0], one("ch164")[0], one("ch159")[0],
      ...P("ch150",1,2),
    ] },

  { title: "Malaria, Toxoplasma & Amebiasis", year: 1, accent: "#5a6a3a",
    sub: "The core protozoa, antiparasitic drugs braided behind the diseases.",
    ids: [
      ...P("ch280",1,2), "ch44-p1", "ch280-p3", ...P("ch44",2,3),
      ...P("ch284",1,2), "ch278-p1", ...P("ch284",3,4), "ch278-p2",
    ] },

  { title: "Immunization & Travel Medicine", year: 1, accent: "#2f6f7a",
    sub: "Vaccination braided with the traveller, before and after the trip.",
    ids: [
      one("ch321")[0], ...P("ch322",1,2), ...P("ch323",1,2),
      ...P("ch322",3,4), ...P("ch324",1,2), ...P("ch322",5,7),
    ] },

  { title: "Prevention & Stewardship", year: 1, accent: "#6a5aa0",
    sub: "Stewardship, OPAT, infection control, and the surgical site.",
    ids: [one("ch54")[0], ...P("ch56",1,2), ...P("ch304",1,2), ...P("ch317",1,2)] },

  /* ================= YEAR 2 ================= */

  { title: "Immunocompromised & Transplant ID", year: 2, accent: "#8a5a3f",
    sub: "The compromised host, immunomodulators braided through the transplant chapters.",
    ids: [
      ...P("ch310",1,2), ...P("ch311",1,3), "ch52-p1",
      ...P("ch312",1,3), "ch52-p2", ...P("ch313",1,3), ...P("ch52",3,4),
      ...P("ch309",1,2), ...P("ch315",1,2), ...P("ch316",1,3), ...P("ch314",1,2),
    ] },

  { title: "HIV & COVID — Completing", year: 2, accent: "#b0413e",
    sub: "HIV prevention to cure research; SARS-CoV-2 from virology to treatment.",
    ids: [
      ...P("ch122",1,3), ...P("ch126",1,2), ...P("ch128",1,3),
      ...P("ch124",1,3), ...P("ch129",1,2), ...P("ch121",1,2),
      ...P("ch132",1,2), ...P("ch134",1,3), ...P("ch135",1,3),
      ...P("ch136",1,3), ...P("ch133",1,2), ...P("ch162",1,2),  // SARS/MERS close the family
    ] },

  { title: "Viral Hepatitis", year: 2, accent: "#5a4a6a",
    sub: "The hepatitis viruses braided, their drugs behind them.",
    ids: [
      one("ch119")[0], ...P("ch152",1,3), ...P("ch161",1,3), one("ch153")[0],
      ...P("ch161",4,5), ...P("ch180",1,3), one("ch184")[0], ...P("ch50",1,3),
    ] },

  { title: "The Undifferentiated Patient", year: 2, accent: "#b0413e",
    sub: "Fever physiology, fever-and-rash, and the great mimics — integration chapters.",
    ids: [
      ...P("ch57",1,2), ...P("ch59",1,3),
      ...P("ch97",1,2), ...P("ch86",1,2), one("ch303")[0], ...P("ch137",1,2),
    ] },

  { title: "Head, Neck & Eye", year: 2, accent: "#9a5a2f",
    sub: "The oral cavity to the larynx, cough syndromes, CF, and the eye.",
    ids: [
      ...P("ch66",1,3), ...P("ch87",1,2),          // deep-neck → descending mediastinitis
      one("ch60")[0], one("ch62")[0], one("ch65")[0],
      ...P("ch67",1,2), ...P("ch236",1,2),
      ...P("ch73",1,3), one("ch225")[0],
      ...P("ch113",1,2), ...P("ch115",1,2), ...P("ch116",1,2),
      ...P("ch117",1,2), one("ch118")[0],
    ] },

  { title: "Enteric & Foodborne — Completing", year: 2, accent: "#5a6a3a",
    sub: "Every diarrhea consult — bacteria, parasites, and viruses in one arc.",
    ids: [
      one("ch99")[0], ...P("ch102",1,2), ...P("ch103",1,3),
      ...P("ch221",1,2), one("ch229")[0], one("ch235")[0],   // yersiniosis with its enteric peers
      ...P("ch219",1,2), ...P("ch222",1,2),
      one("ch285")[0], ...P("ch288",1,2), ...P("ch289",1,3),
      ...P("ch181",1,3), ...P("ch155",1,3),
    ] },

  { title: "Tick-Borne & Rickettsial Disease", year: 2, accent: "#a8432f",
    sub: "The tick-bite differential — rickettsioses, ehrlichioses, Q fever, Babesia.",
    ids: [
      one("ch191")[0], ...P("ch192",1,2), ...P("ch197",1,2), ...P("ch194",1,2),
      ...P("ch193",1,2), ...P("ch301",1,2), ...P("ch287",1,2), ...P("ch301",3,4),
    ] },

  { title: "Zoonoses & Animal Contact", year: 2, accent: "#7a5a2f",
    sub: "Organized by the exposure you would elicit — farm, bite, scratch, and water.",
    ids: [
      ...P("ch325",1,2), one("ch231")[0], ...P("ch232",1,2), one("ch234")[0],
      ...P("ch325",3,4), ...P("ch240",1,3),
      one("ch233")[0], one("ch239")[0], one("ch237")[0], one("ch245")[0],
      ...P("ch212",1,3), ...P("ch213",1,2), ...P("ch187",1,2), ...P("ch168",1,2),
    ] },

  { title: "Arboviruses & Hemorrhagic Fevers", year: 2, accent: "#3f5a8a",
    sub: "Mosquito-borne viruses through rabies and the viral hemorrhagic fevers.",
    ids: [
      ...P("ch160",1,3), ...P("ch158",1,2), one("ch173")[0],
      ...P("ch170",1,3), ...P("ch174",1,3),
    ] },

  { title: "Tropical Medicine & Helminths", year: 2, accent: "#5a6a3a",
    sub: "The returning traveller completed — protozoa, worms, and their drugs.",
    ids: [
      one("ch277")[0], ...P("ch226",1,2), ...P("ch256",1,2),
      ...P("ch281",1,3), one("ch45")[0], ...P("ch282",1,2),
      ...P("ch279",1,2), ...P("ch276",1,2),
      ...P("ch292",1,3), "ch46-p1", ...P("ch294",1,2), ...P("ch295",1,2), "ch46-p2",
      ...P("ch296",1,3), ...P("ch299",1,2),
    ] },

  { title: "Fungal & Subcutaneous Mycoses — Completing", year: 2, accent: "#7a6a2a",
    sub: "Paracocci, the subcutaneous mycoses, dermatophytes, and the uncommon fungi.",
    ids: [...P("ch265",1,2), ...P("ch273",1,2), ...P("ch272",1,2), ...P("ch274",1,3)] },

  { title: "Viral Foundations & Completion", year: 2, accent: "#3f5a8a",
    sub: "Virology foundations, the remaining herpesviruses, pox, entero, and prions.",
    ids: [
      ...P("ch138",1,2), one("ch141")[0], ...P("ch146",1,3),
      one("ch149")[0], ...P("ch151",1,2), one("ch154")[0], ...P("ch139",1,2),
      ...P("ch176",1,2), ...P("ch178",1,3), ...P("ch185",1,2), one("ch51")[0],
    ] },

  { title: "Bacteria — Completing", year: 2, accent: "#2f6f7a",
    sub: "The remaining streptococci, coryneforms, and fastidious organisms.",
    ids: [
      one("ch198")[0], one("ch201")[0], ...P("ch203",1,2), ...P("ch207",1,2),
      ...P("ch209",1,3), one("ch218")[0], ...P("ch189",1,2), ...P("ch241",1,3),
    ] },

  { title: "Stewardship Systems & Future Therapeutics", year: 2, accent: "#6a5aa0",
    sub: "Study design, sterilization, and the therapies still arriving.",
    ids: [...P("ch55",1,2), ...P("ch305",1,2), ...P("ch37",1,2),
          ...P("ch39",1,2), ...P("ch35",1,2)] },

  { title: "Consolidation & Guideline Review", year: 2, accent: "#3d7a5a",
    sub: "Re-read the core, then the guidelines, syndrome by syndrome.",
    ids: [
      "x-re-read-antimicrobial-principles-spectra-empiric-p1",
      "x-re-read-endocarditis-sepsis-pneumonia-uti-skin-s-p1",
      "x-re-read-cns-bone-joint-intra-abdominal-empiric-c-p1",
      "x-re-read-hiv-art-oi-prophylaxis-tuberculosis-late-p1",
      "x-re-read-invasive-fungal-disease-transplant-immun-p1",
      "x-re-read-c-difficile-healthcare-associated-infect-p1",
      "x-guideline-review-idsa-endocarditis-cap-hap-vap-s-p1",
      "x-guideline-review-idsa-meningitis-osteomyelitis-p-p1",
      "x-guideline-review-candidiasis-aspergillosis-crypt-p1",
      "x-guideline-review-aasld-hepatitis-b-c-idsa-influe-p1",
      "x-guideline-review-dhhs-art-oi-prophylaxis-ast-tra-p1",
      "x-guideline-review-stewardship-clabsi-cauti-opat-p1",
    ] },

  { title: "Practice Questions & Final Review", year: 2, accent: "#b0413e",
    sub: "Question banks, weak areas, and the taper before the exam.",
    ids: [
      "x-practice-questions-antimicrobials-core-syndromes-p1",
      "x-practice-questions-organisms-bacteria-fungi-viru-p1",
      "x-practice-questions-mixed-sets-at-exam-pace-log-y-p1",
      "x-final-review-weak-area-first-pass-from-your-ques-p1",
      "x-final-review-guideline-recommendation-tables-ant-p1",
      "x-final-review-high-yield-organisms-syndromes-rapi-p1",
      "x-final-review-second-weak-area-pass-p1",
      "x-taper-rest-before-the-royal-college-exam-light-r-p1",
    ] },
];
