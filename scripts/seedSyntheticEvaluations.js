const pool = require("../services/db");
const { ensureEvaluationSchema } = require("../services/evaluationSchema");

const requestedCount = Number.parseInt(process.argv[2] || "500", 10);
if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 10000) {
  throw new Error("Count must be an integer between 1 and 10000");
}

// Deterministic PRNG: repeated runs produce stable fixture distributions.
let seed = 0x4d484f41;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const pick = (values) => values[Math.floor(random() * values.length)];
const clampScore = (value) => Math.max(1, Math.min(5, Math.round(value)));

const dimensions = {
  process_fidelity: ["agristack_workflow", "term_identification", "tool_sequencing", "search_quality", "output_hygiene"],
  factual_grounding: ["source_alignment", "no_fabrication", "citation_accuracy", "safety_compliance"],
  response_usefulness: ["completeness", "actionability", "context_fit", "clarity", "conversation_closure"],
  marathi_quality: ["grammar", "terminology", "language_purity", "fluency"],
};

// Deliberately non-uniform synthetic profile so aggregate radar charts do not
// collapse into an implausibly smooth circle after averaging many fixtures.
const metricBiases = {
  agristack_workflow: -0.65,
  term_identification: 0.55,
  tool_sequencing: -0.8,
  search_quality: 0.25,
  output_hygiene: 0.7,
  source_alignment: -0.6,
  no_fabrication: 0.75,
  citation_accuracy: -0.45,
  safety_compliance: 0.85,
  completeness: 0.1,
  actionability: 0.65,
  context_fit: -0.55,
  clarity: 0.7,
  conversation_closure: -0.75,
  grammar: 0.25,
  terminology: -0.5,
  language_purity: 0.55,
  fluency: -0.2,
};

const conversations = [
  ["Weather Forecast", "माझे दोन एकर टोमॅटोचे पीक पुणे जिल्ह्यात फुलोऱ्याच्या अवस्थेत आहे. पुढील तीन दिवस पाऊस आणि जोरदार वाऱ्याची शक्यता किती आहे, आणि नियोजित फवारणी आज करावी की हवामान स्थिर होईपर्यंत थांबावे?", "पुणे परिसरात पुढील काही दिवस ढगाळ वातावरणासह हलक्या ते मध्यम पावसाची शक्यता गृहित धरून नियोजन करा. पाऊस किंवा जोरदार वारा अपेक्षित असल्यास फवारणी पुढे ढकला, कारण औषध वाहून जाऊ शकते आणि परिणाम कमी होतो. शेतात पाणी साचणार नाही यासाठी निचरा मोकळा ठेवा आणि आधाराच्या दोऱ्या तपासा. फवारणी करायची असल्यास किमान काही तास कोरडे हवामान मिळेल असा कालावधी निवडा. अंतिम निर्णयापूर्वी आपल्या गावाचा ताजा अधिकृत हवामान अंदाज आणि कृषी सल्ला तपासा."],
  ["Crop Advisory", "I planted snap bean on one acre of medium black soil about three weeks ago. Germination is uneven and some leaves are turning pale. What irrigation, nutrition, weeding, and pest-management steps should I follow during the next month to improve yield?", "First inspect the field to separate poor germination caused by seed quality, crusting, excess moisture, or root damage. Keep the soil evenly moist but not waterlogged, using lighter and more frequent irrigation where drainage is slow. Base fertilizer corrections on a soil test; avoid adding a large nitrogen dose only because leaves appear pale. Remove early weeds before they compete strongly with the crop and check the underside of leaves for sucking pests. Record affected patches, symptoms, and recent inputs, then confirm any pesticide or micronutrient treatment with a local crop adviser and the registered product label."],
  ["Pest Management", "माझ्या कापसाच्या शेतात काही बोंडांवर छिद्रे आणि आत गुलाबी रंगाच्या अळ्या दिसत आहेत. पीक सुमारे 90 दिवसांचे आहे; प्रादुर्भाव किती आहे हे कसे मोजावे आणि अनावश्यक फवारणी टाळून एकात्मिक नियंत्रण कसे करावे?", "सुरुवातीला शेताच्या वेगवेगळ्या भागांतील झाडे आणि बोंडे तपासून बाधित बोंडांची टक्केवारी नोंदवा. फेरोमोन सापळे शिफारशीनुसार लावा आणि नर पतंगांची संख्या नियमित लिहून ठेवा. रोझेट फुले व बाधित बोंडे गोळा करून सुरक्षितपणे नष्ट करा आणि शेतात जुना कापूस किंवा उरलेली बोंडे ठेवू नका. आर्थिक नुकसान पातळी ओलांडल्यासच नोंदणीकृत कीटकनाशक स्थानिक शिफारस, योग्य मात्रा आणि प्रतीक्षा कालावधीनुसार वापरा. एकाच क्रियावर्गाचे औषध वारंवार वापरणे टाळा आणि फवारणी करताना संरक्षक साधने वापरा."],
  ["Market Price", "माझ्याकडे सुमारे 35 क्विंटल मध्यम आकाराचा लाल कांदा विक्रीसाठी तयार आहे. पुणे, लासलगाव आणि जवळच्या बाजार समित्यांमधील भाव कसे तुलना करावेत, आणि वाहतूक व हमाली धरून कोणत्या बाजारात विकणे फायदेशीर ठरेल?", "फक्त सर्वाधिक दिसणारा भाव न पाहता प्रत्येक बाजारातील किमान, कमाल आणि सर्वसाधारण दर तसेच त्या दिवशीची आवक तपासा. आपल्या कांद्याचा दर्जा, आकार, ओलावा आणि साठवण स्थिती कोणत्या श्रेणीत येते हे स्पष्ट करा. प्रत्येक बाजारासाठी वाहतूक, हमाली, तोलाई, कमिशन आणि संभाव्य वजन घट यांचा स्वतंत्र खर्च लिहा. अपेक्षित निव्वळ प्राप्ती म्हणजे विक्री रक्कम वजा सर्व खर्च अशी तुलना करा. जाण्यापूर्वी संबंधित बाजार समिती किंवा अधिकृत भाव स्रोताकडून ताजा दर आणि लिलावाची वेळ पडताळा."],
  ["Soil Health", "माझ्या चार एकर शेतात दोन भागांत मातीचा रंग आणि पिकाची वाढ वेगळी दिसते. खत नियोजनासाठी माती परीक्षण करायचे आहे; किती नमुने घ्यावेत, कोणत्या खोलीतून घ्यावेत आणि प्रयोगशाळेला कोणती माहिती द्यावी?", "रंग, उतार, पाण्याचा निचरा किंवा पूर्वीचे व्यवस्थापन वेगळे असलेले भाग स्वतंत्र नमुना क्षेत्र म्हणून घ्या. प्रत्येक एकसमान भागातील 8 ते 10 ठिकाणांहून वरचा कचरा बाजूला करून पिकानुसार शिफारस केलेल्या खोलीत V आकाराचा नमुना घ्या. सर्व उपनमुने स्वच्छ बादलीत मिसळून दगड व मुळे काढा आणि सुमारे अर्धा किलो प्रतिनिधिक नमुना सावलीत वाळवा. पिशवीवर शेत क्रमांक, खोली, पीक, मागील खत वापर आणि सिंचन स्रोत लिहा. बांध, खताचा ढीग, पाणथळ जागा किंवा अलीकडे खत दिलेल्या ठिकाणांपासून नमुना घेऊ नका."],
  ["Irrigation", "माझे ड्रिपवरील टोमॅटो पीक 55 दिवसांचे असून फळधारणा सुरू झाली आहे. जमीन मध्यम काळी आहे आणि दुपारी पाने थोडी कोमेजतात; दररोज किती वेळ ड्रिप चालवावी आणि जास्त किंवा कमी पाणी दिल्याची लक्षणे कोणती?", "ड्रिप चालवण्याचा अचूक कालावधी ठरवण्यासाठी एमिटरचा प्रवाह, झाडांतील अंतर, मातीची ओल धारण क्षमता आणि त्या दिवसाचे हवामान आवश्यक आहे. काही ठिकाणी मुळांच्या खोलीपर्यंत माती तपासा; फक्त वरचा पृष्ठभाग कोरडा दिसतो म्हणून वेळ वाढवू नका. फळधारणेत नियमित ओलावा ठेवा, पण पाणी साचणे, खालची पाने पिवळी होणे किंवा मुळे कुजण्याची लक्षणे दिसल्यास मात्रा कमी करा. सतत कोमेजणे, फळ लहान राहणे किंवा ब्लॉसम एंड रॉट वाढणे कमी पाणी किंवा असमान पुरवठ्याचे संकेत असू शकतात. एमिटर बंद आहेत का ते तपासा आणि स्थानिक बाष्पोत्सर्जन सल्ल्यानुसार वेळ समायोजित करा."],
  ["Fertilizer", "माझा ऊस लागवडीनंतर 75 दिवसांचा आहे आणि वाढ काही ठिकाणी कमी दिसते. माती परीक्षणात सेंद्रिय कर्ब कमी आला आहे; नत्र, स्फुरद, पालाश आणि सूक्ष्म अन्नद्रव्यांचे पुढील हप्ते कसे नियोजित करावेत?", "माती परीक्षणाचा अहवाल, ऊसाचा वाण, लागवडीची पद्धत आणि आधी दिलेली खते एकत्र पाहून उरलेली मात्रा ठरवा. नत्र व पालाश एकाच वेळी न देता पिकाच्या वाढीच्या टप्प्यांनुसार विभागून दिल्यास वापर कार्यक्षमता सुधारते. स्फुरदाची गरज आणि देण्याची पद्धत मातीतील उपलब्धतेनुसार ठरवा. सेंद्रिय कर्ब कमी असल्यास पूर्ण कुजलेले शेणखत, कंपोस्ट किंवा मान्य सेंद्रिय स्रोत वापरण्याचा विचार करा. कोणतेही सूक्ष्म अन्नद्रव्य फक्त दृश्य लक्षणांवर देण्याऐवजी चाचणी किंवा तज्ज्ञ निदानावर द्या आणि विद्यापीठाची स्थानिक शिफारस पडताळा."],
  ["Government Scheme", "पीएम किसानचा मागील हप्ता माझ्या खात्यात जमा झालेला नाही, पण आधीचे हप्ते नियमित आले होते. e-KYC पूर्ण आहे असे दिसते; आधार, बँक खाते, नावातील फरक आणि जमिनीची नोंद यापैकी काय-काय तपासावे आणि तक्रार कुठे करावी?", "सर्वप्रथम अधिकृत लाभार्थी स्थितीत हप्ता प्रलंबित, नाकारलेला किंवा पेमेंट अयशस्वी असा कोणता संदेश दिसतो ते नोंदवा. आधारवरील नाव, अर्जातील नाव आणि बँक खात्यातील नाव व जन्मतारीख यांची अक्षरशः जुळणी तपासा. बँक खाते सक्रिय आहे का, आधार सीडिंग व NPCI मॅपिंग पूर्ण आहे का आणि भू-अभिलेखातील मालकी माहिती अद्ययावत आहे का ते पडताळा. अर्ज क्रमांक, आधाराचे शेवटचे चार अंक आणि पेमेंट स्थितीचा स्क्रीनशॉट जवळ ठेवा. दुरुस्ती किंवा तक्रारीसाठी केवळ अधिकृत पोर्टल, कृषी कार्यालय किंवा मान्य सहाय्य केंद्र वापरा; OTP किंवा संपूर्ण बँक तपशील अनोळखी व्यक्तीला देऊ नका."],
  ["Disease Management", "माझ्या द्राक्ष बागेत पानांच्या वरच्या बाजूला पांढरी भुकटी आणि काही घडांवरही डाग दिसत आहेत. गेल्या आठवड्यात वातावरण दमट होते; हा भुरी रोग आहे का, तीव्रता कशी ठरवावी आणि पुढील फवारणीचे नियोजन कसे करावे?", "लक्षणे भुरीशी जुळू शकतात, पण प्रत्यक्ष पान, देठ आणि घड तपासून इतर रोग किंवा औषधामुळे झालेली इजा वेगळी करणे महत्त्वाचे आहे. बागेच्या विविध भागांतील बाधित पाने आणि घडांची टक्केवारी नोंदवा. दाट वाढ कमी करून हवा खेळती ठेवा, बाधित भागांचे योग्य व्यवस्थापन करा आणि अतिनत्र टाळा. रोगाची अवस्था व हवामान पाहून द्राक्षासाठी नोंदणीकृत बुरशीनाशकच लेबल, स्थानिक सल्ला आणि प्रतीक्षा कालावधीनुसार वापरा. प्रतिकारशक्ती निर्माण होऊ नये म्हणून क्रियावर्ग बदलत रहा आणि बाजारासाठी अवशेष मर्यादा लक्षात ठेवा."],
  ["Seed Selection", "येत्या खरीप हंगामात तीन एकर क्षेत्रावर सोयाबीन घ्यायचे आहे. आमच्या भागात पाऊस कधी कमी तर कधी जास्त होतो; योग्य वाण, प्रमाणित बियाणे, उगवण चाचणी आणि बीजप्रक्रिया निवडताना कोणते निकष पाहू?", "आपल्या जिल्ह्यासाठी शिफारस केलेला कालावधी, परिपक्वतेचे दिवस, रोग सहनशीलता आणि पावसाच्या अनिश्चिततेशी जुळणारा वाण निवडा. अधिकृत विक्रेत्याकडून सीलबंद प्रमाणित बियाणे घ्या आणि पिशवीवरील वाण, लॉट क्रमांक, उगवण टक्केवारी, वैधता व प्रमाणन टॅग तपासा. पेरणीपूर्वी घरगुती उगवण चाचणी करून प्रत्यक्ष उगवण कमी असल्यास बीदर समायोजनाबाबत तज्ज्ञ सल्ला घ्या. बीजप्रक्रियेसाठी शिफारस केलेले बुरशीनाशक, जैविक घटक किंवा रायझोबियम वापरताना योग्य क्रम आणि सुसंगतता पाळा. पावती व टॅग हंगाम संपेपर्यंत जतन करा."],
];

function makeEvaluation(index, forceCritical, runIndex) {
  const quality = 3.05 + random() * 1.45;
  const evaluationDimensions = {};
  const criticalFailures = [];
  let scoreTotal = 0;
  let scoreCount = 0;
  let metricIndex = 0;

  for (const [dimension, metricNames] of Object.entries(dimensions)) {
    const scores = {};
    for (const metricName of metricNames) {
      const runVariation = Math.sin((metricIndex + 1) * (runIndex + 1) * 1.37) * 0.3;
      let metricScore = clampScore(
        quality + metricBiases[metricName] + runVariation + (random() - 0.5) * 1.5
      );
      metricIndex += 1;
      if (forceCritical && criticalFailures.length === 0 && ["no_fabrication", "safety_compliance", "actionability"].includes(metricName)) {
        metricScore = 1;
        criticalFailures.push(`${dimension}.${metricName}`);
      }
      scores[metricName] = {
        score: metricScore,
        evidence: `Synthetic local fixture: ${metricScore}/5 signal for ${metricName.replaceAll("_", " ")}.`,
      };
      scoreTotal += metricScore;
      scoreCount += 1;
    }
    const values = Object.values(scores).map(({ score }) => score);
    evaluationDimensions[dimension] = {
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      scores,
    };
  }

  const overallAverage = scoreTotal / scoreCount;
  const overallPass = criticalFailures.length === 0;
  return {
    summary: overallPass
      ? "Synthetic fixture passed the critical checks; use it only for local UI testing."
      : "Synthetic fixture contains a deliberately injected critical failure for local filtering tests.",
    dimensions: evaluationDimensions,
    metrics: { overall_average: overallAverage, overall_pass: overallPass, critical_failures: criticalFailures },
  };
}

async function main() {
  await ensureEvaluationSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM evaluation_runs WHERE run_id LIKE 'synthetic-local-%'");

    const runCount = Math.min(5, requestedCount);
    const baseSize = Math.floor(requestedCount / runCount);
    let remainder = requestedCount % runCount;
    let globalIndex = 0;

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const itemCount = baseSize + (remainder-- > 0 ? 1 : 0);
      const windowEnd = new Date(Date.now() - runIndex * 24 * 60 * 60 * 1000);
      const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
      const dateKey = windowEnd.toISOString().slice(0, 10).replaceAll("-", "");
      const runId = `synthetic-local-${dateKey}-${runIndex + 1}`;
      const feedbackCount = Math.round(itemCount * 0.28);
      const randomCount = itemCount - feedbackCount;

      await client.query(`
        INSERT INTO evaluation_runs (
          run_id, state, window_start, window_end, status, population_count, random_target,
          feedback_selected_count, random_selected_count, unmatched_feedback_count,
          successful_count, failed_count, judge_model, schema_version, rubric_version, completed_at
        ) VALUES ($1, 'bharat-vistaar', $2, $3, 'complete', $4, $5, $6, $7, $8, $9, 0,
                  'gemma-4', 'evaluation-item-v1', 'mh-production-v1', $3)
      `, [runId, windowStart, windowEnd, itemCount * 10, itemCount, feedbackCount, randomCount, runIndex % 3, itemCount]);

      for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1, globalIndex += 1) {
        const selectionSource = itemIndex < feedbackCount ? "feedback" : "random";
        const forceCritical = globalIndex % 7 === 0;
        const evaluation = makeEvaluation(globalIndex, forceCritical, runIndex);
        const [category, question, answer] = conversations[globalIndex % conversations.length];
        const feedbackTypes = selectionSource === "feedback" ? [pick(["like", "dislike"])] : [];
        const dimensionAverages = Object.fromEntries(
          Object.entries(evaluation.dimensions).map(([key, value]) => [key, value.average])
        );

        await client.query(`
          INSERT INTO evaluation_items (
            run_id, trace_id, qid, masked_session_ref, question, answer, category,
            agristack_required, target_lang, serving_model, application_release,
            selection_source, feedback_types, feedback_count, feedback_comment_present,
            evaluation, dimension_averages, overall_average, overall_pass,
            critical_failures, evaluated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20::jsonb,$21)
        `, [
          runId, `synthetic-trace-${globalIndex + 1}`, `synthetic-qid-${globalIndex + 1}`,
          `local-session-${String(globalIndex % 80).padStart(3, "0")}`, question, answer, category,
          globalIndex % 4 === 0 ? "Yes" : "No", /[\u0900-\u097F]/.test(question) ? "mr" : "en",
          "gemma-4", "synthetic-local",
          selectionSource, JSON.stringify(feedbackTypes), selectionSource === "feedback" ? 1 + (globalIndex % 3) : 0,
          selectionSource === "feedback" && globalIndex % 2 === 0, JSON.stringify(evaluation),
          JSON.stringify(dimensionAverages), evaluation.metrics.overall_average,
          evaluation.metrics.overall_pass, JSON.stringify(evaluation.metrics.critical_failures),
          new Date(windowStart.getTime() + (itemIndex / Math.max(itemCount, 1)) * (windowEnd - windowStart)),
        ]);
      }
    }

    await client.query("COMMIT");
    console.log(`Seeded ${requestedCount} synthetic evaluations across ${runCount} local runs.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
